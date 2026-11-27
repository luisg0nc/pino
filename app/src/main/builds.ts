// The build loop: the open project is built once for every settled save of its Python or its outline, one build at a
// time, and what came of it is told to whoever listens. The shape is torno's (`Builds`, `watchFolder`); a pino
// project is built whole by the engine, which writes only under .pino/.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import { APP } from '../shared/app'
import type { BuildCause, BuildEntry, BuildResult, BuildState, BuildTurn, EngineState, KeptCause, Verdict } from '../shared/build'
import { engineDidNotStart } from '../shared/fab'
import type { TurnBuilds } from '../shared/chat'
import type { ProjectInfo } from '../shared/project'
import { BUILD_HASH } from './artifacts'
import { readCauses as readCausesFile, writeCauses as writeCausesFile } from './buildCauses'
import { KernelError, type KernelClient, type Pong } from './kernel/client'
import { FOLDER, whyNotOwn } from './own'

export const DEBOUNCE_MS = 300
/** How many builds of an open project are remembered for `ranSince`: far more than one turn runs. */
const MOST_RAN = 500
/** The engine is started again at most this often: a start that fails at once must not become a loop. */
const RESTART_MS = 10_000
/** How long a new engine has to answer: its first run under uv may have its environment to make. */
const PING_TIMEOUT_MS = 120_000
/** Where the engine, tools and the person keep what is no part of the board. */
const IGNORED_FOLDERS = new Set([APP.folder, '__pycache__', '.venv', 'node_modules', '.git', 'fab', 'reference'])
/** The folders of .pino the engine writes: each must be the project's own before it is asked to build. */
const ENGINE_FOLDERS = ['build', 'routes', 'trials', 'release', 'kicad']

/**
 * The engine writes under .pino: it is asked to only while those folders are the project's own. Whoever asks says why
 * not; the window's one notice of the folder stays for what pino's main itself would write.
 */
export async function engineMayWrite(dir: string): Promise<void> {
  for (const folder of ENGINE_FOLDERS) {
    const why = await whyNotOwn(dir, folder)
    if (why) throw new Error(why)
  }
}

/** Told the files that changed in a burst, as absolute paths. */
export type OnChange = (paths: string[]) => void
/** Told one file as its save is heard. */
export type OnSeen = (path: string) => void

/**
 * Calls `onChange` once per burst of saves of the project's Python or outline, with what changed, and `onSeen` at each
 * save, as soon as it is heard of: a build is on its way from the first.
 */
export function watchProject(dir: string, onChange: OnChange, debounceMs: number = DEBOUNCE_MS, onSeen?: OnSeen): () => void {
  let timer: NodeJS.Timeout | undefined
  let changed = new Set<string>()
  // Only what lies under the project counts: the project's own folder may be named like an ignored one.
  const isIgnored = (path: string): boolean => relative(dir, path).split(sep).some((part) => part !== '' && (IGNORED_FOLDERS.has(part) || (part.startsWith('.') && part !== '..')))
  const watcher = chokidarWatch(dir, { ignoreInitial: true, ignored: (path) => isIgnored(path) })
  watcher.on('all', (event, path) => {
    if (event === 'addDir' || event === 'unlinkDir' || isIgnored(path)) return
    if (!path.endsWith('.py') && relative(dir, path) !== 'outline.json') return
    onSeen?.(path)
    changed.add(path)
    clearTimeout(timer)
    timer = setTimeout(() => {
      const paths = [...changed]
      changed = new Set()
      onChange(paths)
    }, debounceMs)
  })
  // A watch that fails (the folder became unreadable) just reports nothing more.
  watcher.on('error', () => {})
  return () => {
    clearTimeout(timer)
    void watcher.close()
  }
}

/** `.pino/builds.json` as the strip lists it, oldest first; empty when there is none to read. */
export async function readBuildHistory(dir: string): Promise<BuildEntry[]> {
  try {
    if (await whyNotOwn(dir, 'build')) return []
    const folder = join(dir, FOLDER)
    const file = JSON.parse(await readFile(join(folder, 'builds.json'), 'utf8')) as { schema?: unknown; builds?: unknown }
    if (file.schema !== 'pino.builds/1' || !Array.isArray(file.builds)) return []
    return file.builds.flatMap((entry: Record<string, unknown>) => {
      if (typeof entry?.number !== 'number' || !['ok', 'errors', 'failed'].includes(entry.verdict as string)) return []
      const hash = typeof entry.hash === 'string' && BUILD_HASH.test(entry.hash) ? entry.hash : null
      const kept = hash !== null && existsSync(join(folder, 'build', hash, 'result.json'))
      return [{ number: entry.number, hash, verdict: entry.verdict as Verdict, at: String(entry.at ?? ''), kept }]
    })
  } catch {
    return []
  }
}

/** Why a failed build failed, in one line that names the place in the source when the engine gave one. */
function failure(r: BuildResult): string {
  const finding = r.findings.find((f) => f.severity === 'error')
  if (!finding) return `h${r.number} failed: ${r.headline.slice(r.headline.indexOf(': ') + 2)}`
  const at = finding.at?.space === 'source' && finding.at.file ? `, ${finding.at.file}${finding.at.line ? ` line ${finding.at.line}` : ''}` : ''
  return `h${r.number} failed: ${finding.message}${at}`
}

/** When triggers fold into one build, the one that ranks highest is what made it, whole, with its turn. */
const CAUSE_RANK: Record<BuildCause, number> = { agent: 3, route: 2, person: 1, unknown: 0 }

/** `held` and `more` as one: the higher cause, and the earlier one of two equal. */
function merged(held: KeptCause | undefined, more: KeptCause): KeptCause {
  return held && CAUSE_RANK[held.cause] >= CAUSE_RANK[more.cause] ? held : more
}

/** What made a save: Claude, when one of its tool calls accounts for it (`Sessions.wroteBy`), else the person. */
export function causeOfSave(claude: { turn?: BuildTurn } | undefined): KeptCause {
  if (!claude) return { cause: 'person' }
  return { cause: 'agent', ...(claude.turn ? { turn: { ...claude.turn } } : {}) }
}

interface Entry {
  project: ProjectInfo
  state: BuildState
  unwatch: () => void
  /** A save came that no build has started for yet. */
  wanted: boolean
  /** A save has been heard of whose burst has not settled. */
  seen: boolean
  running: boolean
  /** Waiting out the rest of RESTART_MS before another start of the engine. */
  retry?: NodeJS.Timeout
  startedAt?: number
  endedAt?: number
  /** The builds that came back, oldest first, the last `MOST_RAN`: when each began, what made it, and whether it drew something. */
  ran: Array<{ number: number; startedAt: number; drew: boolean; made: KeptCause }>
  /** For each route seen current, the build it was first seen on. */
  routes: Map<string, number>
  /** What made each build, by number: loaded with the history, and written to `.pino/build-causes.json` as it grows. */
  causes: Map<number, KeptCause>
  /** The causes on file have been read: nothing is written before, or the file would lose them. */
  loaded: Promise<void>
  /** What wants the next build, folded: taken by the build that starts (`next`), and then none. */
  pending?: KeptCause
  /** What made the burst of saves heard and not settled yet: it joins `pending` when the burst settles, never before. */
  burst?: KeptCause
  settled: Array<() => void>
}

export class Builds {
  private readonly kernel: () => KernelClient
  private readonly watch: typeof watchProject
  private readonly readHistory: (dir: string) => Promise<BuildEntry[]>
  private readonly causeNow: (projectId: string, path: string) => KeptCause
  private readonly readCauses: (dir: string) => Promise<Map<number, KeptCause>>
  private readonly writeCauses: (dir: string, causes: ReadonlyMap<number, KeptCause>) => Promise<void>
  private readonly now: () => number
  private readonly pingTimeoutMs: number
  private readonly entries = new Map<string, Entry>()
  /** The writes of `.pino/build-causes.json` under way (`keepCauses`). */
  private readonly writesUnderWay = new Set<Promise<void>>()
  private readonly stateListeners = new Set<(s: BuildState) => void>()
  private readonly resultListeners = new Set<(projectId: string, r: BuildResult) => void>()
  /** Each engine's answer to its one ping, whoever asked first. */
  private readonly pongs = new WeakMap<KernelClient, Promise<Pong>>()
  /** The last start that failed, until an engine answers. */
  private startFailed: { at: number; reason: string } | undefined
  private engineFailedAt: number | undefined

  constructor(deps: {
    kernel: () => KernelClient
    watch?: typeof watchProject
    readHistory?: (dir: string) => Promise<BuildEntry[]>
    /** What made the save of `path`: Claude, by its tool calls, or the person. Asked of each save as it is heard. */
    causeNow?: (projectId: string, path: string) => KeptCause
    readCauses?: (dir: string) => Promise<Map<number, KeptCause>>
    writeCauses?: (dir: string, causes: ReadonlyMap<number, KeptCause>) => Promise<void>
    now?: () => number
    pingTimeoutMs?: number
  }) {
    this.kernel = deps.kernel
    this.watch = deps.watch ?? watchProject
    this.readHistory = deps.readHistory ?? readBuildHistory
    this.causeNow = deps.causeNow ?? (() => ({ cause: 'person' }))
    this.readCauses = deps.readCauses ?? readCausesFile
    this.writeCauses = deps.writeCauses ?? writeCausesFile
    this.now = deps.now ?? Date.now
    this.pingTimeoutMs = deps.pingTimeoutMs ?? PING_TIMEOUT_MS
  }

  open(project: ProjectInfo): BuildState {
    const held = this.entries.get(project.id)
    if (held) return held.state
    const entry: Entry = {
      project,
      state: { projectId: project.id, engine: { state: 'starting' }, building: false, latest: null, lastGood: null, history: [], route: null, copperFrom: null, problem: null },
      unwatch: () => {},
      wanted: false,
      seen: false,
      running: false,
      ran: [],
      routes: new Map(),
      causes: new Map(),
      loaded: Promise.resolve(),
      settled: []
    }
    // Rows the build loop made itself before the file was read are newer than any on file.
    entry.loaded = this.readCauses(project.dir).then(
      (kept) => {
        for (const [number, cause] of kept) if (!entry.causes.has(number)) entry.causes.set(number, cause)
      },
      () => {}
    )
    this.entries.set(project.id, entry)
    entry.unwatch = this.watch(
      project.dir,
      (paths) => {
        entry.seen = false
        // The burst has settled: what made it wants the next build, not one already on its way. A watch that told no
        // save as it heard it has the whole burst asked of now.
        const burst = entry.burst ?? paths.reduce<KeptCause | undefined>((held, path) => merged(held, this.causeNow(project.id, path)), undefined)
        if (burst) entry.pending = merged(entry.pending, burst)
        entry.burst = undefined
        this.want(entry)
      },
      DEBOUNCE_MS,
      (path) => {
        entry.seen = true
        entry.burst = merged(entry.burst, this.causeNow(project.id, path))
      }
    )
    void Promise.all([this.readHistory(project.dir), entry.loaded]).then(([history]) => {
      if (this.entries.get(project.id) === entry && !entry.running) this.say(entry, { history: this.withCauses(entry, history) })
    })
    this.want(entry)
    return entry.state
  }

  close(projectId: string): void {
    const entry = this.entries.get(projectId)
    if (!entry) return
    this.entries.delete(projectId)
    clearTimeout(entry.retry)
    entry.unwatch()
    for (const done of entry.settled.splice(0)) done()
  }

  /** Asks for a build, made by `cause` (what a Rebuild is: unknown). It is folded into the build already on its way. */
  rebuild(projectId: string, cause: KeptCause = { cause: 'unknown' }): void {
    const entry = this.entries.get(projectId)
    if (!entry) return
    entry.pending = merged(entry.pending, cause)
    this.want(entry)
  }

  state(projectId: string): BuildState | undefined {
    return this.entries.get(projectId)?.state
  }

  latest(projectId: string): BuildResult | null {
    return this.entries.get(projectId)?.state.latest ?? null
  }

  lastGood(projectId: string): BuildResult | null {
    return this.entries.get(projectId)?.state.lastGood ?? null
  }

  /** Whether a save has been heard of that no build has started for yet. */
  pending(projectId: string): boolean {
    const entry = this.entries.get(projectId)
    return entry !== undefined && (entry.seen || (entry.wanted && entry.retry === undefined && !entry.running))
  }

  /** When the newest build began, and when the newest one ended. */
  startedAt(projectId: string): number | undefined {
    return this.entries.get(projectId)?.startedAt
  }

  endedAt(projectId: string): number | undefined {
    return this.entries.get(projectId)?.endedAt
  }

  /**
   * Claude's builds of a turn: those it made that began at `since` or later and came back, for one of the turn's
   * `prompts` or for none that could be named. How many, ok or failed; the newest build before them that drew
   * something, whoever made it, and the newest of them that did. Undefined when there were none.
   */
  ranSince(projectId: string, since: number, prompts: readonly string[]): TurnBuilds | undefined {
    const ran = this.entries.get(projectId)?.ran ?? []
    const during = ran.filter((b) => b.startedAt >= since && b.made.cause === 'agent' && (!b.made.turn || prompts.includes(b.made.turn.prompt)))
    if (during.length === 0) return undefined
    const from = ran.findLast((b) => b.drew && b.startedAt < since)?.number
    const to = during.findLast((b) => b.drew)?.number
    return { count: during.length, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }
  }

  /** The number of the build a route's copper was made for: the first one seen with it current. */
  routedOn(projectId: string, routeKey: string): number | undefined {
    return this.entries.get(projectId)?.routes.get(routeKey)
  }

  /** The state once no build runs or waits, or as it stands at `deadline` (a time of `now`). */
  whenSettled(projectId: string, deadline: number): Promise<BuildState> {
    const entry = this.entries.get(projectId)
    if (!entry) return Promise.reject(new Error('That project is not open'))
    if (!this.busy(entry)) return Promise.resolve(entry.state)
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        entry.settled = entry.settled.filter((one) => one !== done)
        resolve(entry.state)
      }
      const timer = setTimeout(done, Math.max(0, deadline - this.now()))
      entry.settled.push(done)
    })
  }

  onState(cb: (s: BuildState) => void): () => void {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  onResult(cb: (projectId: string, r: BuildResult) => void): () => void {
    this.resultListeners.add(cb)
    return () => this.resultListeners.delete(cb)
  }

  /** Changes part of an open project's state and tells it, for the build loop and the router. */
  patch(projectId: string, change: Partial<BuildState>): void {
    const entry = this.entries.get(projectId)
    if (entry) this.say(entry, change)
  }

  private busy(entry: Entry): boolean {
    return entry.running || entry.seen || (entry.wanted && entry.retry === undefined)
  }

  /** The history with what made each build, for the numbers whose cause is kept; one with none has neither field. */
  private withCauses(entry: Entry, history: BuildEntry[]): BuildEntry[] {
    return history.map((one) => {
      const kept = entry.causes.get(one.number)
      return kept ? { ...one, cause: kept.cause, ...(kept.turn ? { turn: kept.turn } : {}) } : one
    })
  }

  private say(entry: Entry, change: Partial<BuildState>): void {
    entry.state = { ...entry.state, ...change }
    for (const cb of this.stateListeners) cb(entry.state)
  }

  private want(entry: Entry): void {
    entry.wanted = true
    this.next(entry)
  }

  private next(entry: Entry): void {
    if (entry.running || !entry.wanted || this.entries.get(entry.project.id) !== entry) return
    // A folder with no board yet is not built, and nothing is written into it.
    if (!existsSync(join(entry.project.dir, 'board.py'))) {
      // What wanted it made nothing: a later build is not its.
      entry.wanted = false
      entry.pending = undefined
      this.finish(entry)
      return
    }
    if (entry.state.engine.state === 'failed' && this.engineFailedAt !== undefined) {
      const wait = this.engineFailedAt + RESTART_MS - this.now()
      if (wait > 0) {
        entry.retry ??= setTimeout(() => {
          entry.retry = undefined
          this.engineFailedAt = undefined
          this.next(entry)
        }, wait)
        this.finish(entry)
        return
      }
    }
    clearTimeout(entry.retry)
    entry.retry = undefined
    entry.wanted = false
    entry.running = true
    // Whatever wanted this build is taken as it starts: a save heard from now on, even while the engine is asked, is for the next one.
    const cause = entry.pending ?? { cause: 'unknown' }
    entry.pending = undefined
    this.say(entry, { building: true })
    void this.run(entry, cause).finally(() => {
      entry.running = false
      if (this.entries.get(entry.project.id) !== entry) return
      if (entry.wanted) this.next(entry)
      else this.finish(entry)
    })
  }

  /** Writes the causes on file, without holding up a build: a write that fails is let go. It is counted in `writing`. */
  private keepCauses(entry: Entry): void {
    const write: Promise<void> = entry.loaded.then(() => this.writeCauses(entry.project.dir, new Map(entry.causes))).catch(() => {})
    this.writesUnderWay.add(write)
    void write.finally(() => this.writesUnderWay.delete(write))
  }

  /** How many writes of the causes are under way. */
  get writes(): number {
    return this.writesUnderWay.size
  }

  /**
   * Once every write of the causes under way has landed or failed: what closes a project and then removes or leaves its
   * folder (a quit, a test) waits for this, so that nothing is written into `.pino` after.
   */
  async writing(): Promise<void> {
    while (this.writesUnderWay.size > 0) await Promise.all([...this.writesUnderWay])
  }

  private finish(entry: Entry): void {
    if (this.busy(entry)) return
    if (entry.state.building) this.say(entry, { building: false })
    for (const done of entry.settled.splice(0)) done()
  }

  /**
   * The engine's answer to its ping, asked once of each engine, for the build loop and for what asks the engine without
   * a build. A ping is answered in turn: a second one sent during a long build would time out on a healthy engine.
   * Whoever asks first says how long it has, and whether it started this engine (`own`): only then is a silent one
   * ended, and its failure a start that failed. Rejects with why the engine did not start.
   */
  pong(client: KernelClient, { ms = this.pingTimeoutMs, own = true }: { ms?: number; own?: boolean } = {}): Promise<Pong> {
    const held = this.pongs.get(client)
    if (held) return held
    const pong = answered(client, ms, own).then(
      (p) => {
        this.startFailed = undefined
        return p
      },
      (e: Error) => {
        const reason = engineDidNotStart(e.message)
        if (own) this.startFailed = { at: this.now(), reason }
        // One that was already running is asked again the next time.
        else this.pongs.delete(client)
        throw new Error(reason)
      }
    )
    this.pongs.set(client, pong)
    return pong
  }

  /** Why the last start failed, while it is too soon (RESTART_MS) to start another engine; else null. */
  startFailure(): string | null {
    const failed = this.startFailed
    return failed && this.now() - failed.at < RESTART_MS ? failed.reason : null
  }

  /** The engine that answers; rejects with why it did not start. */
  private async engine(entry: Entry): Promise<KernelClient> {
    const client = this.kernel()
    if (!this.pongs.has(client)) this.say(entry, { engine: { state: 'starting' } })
    const pong = await this.pong(client).catch((e: Error) => {
      throw new EngineDown(e.message)
    })
    const engine: EngineState = { state: 'ready', kernel: pong.kernel, serve: pong.serve }
    if (this.entries.get(entry.project.id) === entry && entry.state.engine.state !== 'ready') this.say(entry, { engine })
    return client
  }

  private async run(entry: Entry, cause: KeptCause): Promise<void> {
    const open = () => this.entries.get(entry.project.id) === entry
    // Until the engine is asked to build, a failure leaves the cause for the next attempt.
    let asked = false
    try {
      await engineMayWrite(entry.project.dir)
      const client = await this.engine(entry)
      await entry.loaded
      if (!open()) return
      entry.startedAt = this.now()
      const before = entry.state.history
      const number = Math.max(before.at(-1)?.number ?? 0, entry.state.latest?.number ?? 0) + 1
      asked = true
      this.say(entry, { history: [...before, { number, hash: null, verdict: 'running', at: new Date(entry.startedAt).toISOString(), kept: false, cause: cause.cause, ...(cause.turn ? { turn: cause.turn } : {}) }] })
      const result = await client.build(entry.project.dir)
      const history = await this.readHistory(entry.project.dir)
      if (!open()) return
      // The engine numbers its builds, and its number is the one the cause belongs to.
      entry.causes.set(result.number, cause)
      this.keepCauses(entry)
      entry.endedAt = this.now()
      entry.ran.push({ number: result.number, startedAt: entry.startedAt, drew: result.hash !== null, made: cause })
      if (entry.ran.length > MOST_RAN) entry.ran.shift()
      // A result older than the one shown never replaces it.
      if (result.number < (entry.state.latest?.number ?? 0)) {
        this.say(entry, { history: this.withCauses(entry, history) })
        return
      }
      this.engineFailedAt = undefined
      const route = result.routing?.state === 'current' ? result.routing.route_key : null
      if (route && !entry.routes.has(route)) entry.routes.set(route, result.number)
      const routing = result.routing
      const copper = routing?.state === 'current' || routing?.state === 'stale' ? routing.route_key : null
      this.say(entry, {
        ...(result.hash ? { copperFrom: (copper && entry.routes.get(copper)) || null } : {}),
        latest: result,
        lastGood: result.hash ? result : entry.state.lastGood,
        history: this.withCauses(entry, history),
        problem: result.verdict === 'failed' ? failure(result) : null
      })
      for (const cb of this.resultListeners) cb(entry.project.id, result)
    } catch (e) {
      if (!open()) return
      if (!asked) entry.pending = entry.pending ? merged(cause, entry.pending) : cause
      entry.endedAt = this.now()
      const history = entry.state.history.filter((one) => one.verdict !== 'running')
      if (e instanceof EngineDown || (e instanceof KernelError && e.kind === 'stopped')) {
        const reason = e instanceof EngineDown ? e.message : `The engine stopped: ${e.message}`
        this.engineFailedAt = this.now()
        this.say(entry, { engine: { state: 'failed', reason }, problem: reason, history })
      } else {
        this.say(entry, { problem: (e as Error).message, history })
      }
    }
  }
}

/**
 * The engine's first answer. Nothing waits for it past `ms`; with `end`, one that has said nothing by then is ended, so
 * that the next build starts another.
 */
function answered(client: KernelClient, ms: number, end: boolean): Promise<Pong> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`it did not answer within ${Math.round(ms / 1000)} s`))
      if (end) client.kill()
    }, ms)
    client.ping().then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/** The engine never answered its first ping. */
class EngineDown extends Error {}
