// The build loop: the open project is built once for every settled save of its Python or its outline, one build at a
// time, and what came of it is told to whoever listens. The shape is torno's (`Builds`, `watchFolder`); a pino
// project is built whole by the engine, which writes only under .pino/.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { watch as chokidarWatch } from 'chokidar'
import { APP } from '../shared/app'
import type { BuildEntry, BuildResult, BuildState, EngineState, Verdict } from '../shared/build'
import type { ProjectInfo } from '../shared/project'
import { BUILD_HASH } from './artifacts'
import { KernelError, type KernelClient, type Pong } from './kernel/client'
import { FOLDER, whyNotOwn } from './own'

export const DEBOUNCE_MS = 300
/** The engine is started again at most this often: a start that fails at once must not become a loop. */
const RESTART_MS = 10_000
/** How long a new engine has to answer: its first run under uv may have its environment to make. */
const PING_TIMEOUT_MS = 120_000
/** Where the engine, tools and the person keep what is no part of the board. */
const IGNORED_FOLDERS = new Set([APP.folder, '__pycache__', '.venv', 'node_modules', '.git', 'fab', 'reference'])
/** The folders of .pino the engine writes: each must be the project's own before it is asked to build. */
const ENGINE_FOLDERS = ['build', 'routes', 'trials', 'kicad']

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

/**
 * Calls `onChange` once per burst of saves of the project's Python or outline, with what changed, and `onSeen` at the
 * first save of a burst, as soon as it is heard of: a build is on its way from then.
 */
export function watchProject(dir: string, onChange: OnChange, debounceMs: number = DEBOUNCE_MS, onSeen?: () => void): () => void {
  let timer: NodeJS.Timeout | undefined
  let changed = new Set<string>()
  // Only what lies under the project counts: the project's own folder may be named like an ignored one.
  const isIgnored = (path: string): boolean => relative(dir, path).split(sep).some((part) => part !== '' && (IGNORED_FOLDERS.has(part) || (part.startsWith('.') && part !== '..')))
  const watcher = chokidarWatch(dir, { ignoreInitial: true, ignored: (path) => isIgnored(path) })
  watcher.on('all', (event, path) => {
    if (event === 'addDir' || event === 'unlinkDir' || isIgnored(path)) return
    if (!path.endsWith('.py') && relative(dir, path) !== 'outline.json') return
    if (!changed.size) onSeen?.()
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
  /** For each route seen current, the build it was first seen on. */
  routes: Map<string, number>
  settled: Array<() => void>
}

export class Builds {
  private readonly kernel: () => KernelClient
  private readonly watch: typeof watchProject
  private readonly readHistory: (dir: string) => Promise<BuildEntry[]>
  private readonly now: () => number
  private readonly pingTimeoutMs: number
  private readonly entries = new Map<string, Entry>()
  private readonly stateListeners = new Set<(s: BuildState) => void>()
  private readonly resultListeners = new Set<(projectId: string, r: BuildResult) => void>()
  /** What each engine answered to its first ping, and the engines whose exit is listened for. */
  private readonly pongs = new WeakMap<KernelClient, Promise<EngineState>>()
  private engineFailedAt: number | undefined

  constructor(deps: { kernel: () => KernelClient; watch?: typeof watchProject; readHistory?: (dir: string) => Promise<BuildEntry[]>; now?: () => number; pingTimeoutMs?: number }) {
    this.kernel = deps.kernel
    this.watch = deps.watch ?? watchProject
    this.readHistory = deps.readHistory ?? readBuildHistory
    this.now = deps.now ?? Date.now
    this.pingTimeoutMs = deps.pingTimeoutMs ?? PING_TIMEOUT_MS
  }

  open(project: ProjectInfo): BuildState {
    const held = this.entries.get(project.id)
    if (held) return held.state
    const entry: Entry = {
      project,
      state: { projectId: project.id, engine: { state: 'starting' }, building: false, latest: null, lastGood: null, history: [], route: null, problem: null },
      unwatch: () => {},
      wanted: false,
      seen: false,
      running: false,
      routes: new Map(),
      settled: []
    }
    this.entries.set(project.id, entry)
    entry.unwatch = this.watch(
      project.dir,
      () => {
        entry.seen = false
        this.want(entry)
      },
      DEBOUNCE_MS,
      () => (entry.seen = true)
    )
    void this.readHistory(project.dir).then((history) => {
      if (this.entries.get(project.id) === entry && !entry.running) this.say(entry, { history })
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

  rebuild(projectId: string): void {
    const entry = this.entries.get(projectId)
    if (entry) this.want(entry)
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
      entry.wanted = false
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
    this.say(entry, { building: true })
    void this.run(entry).finally(() => {
      entry.running = false
      if (this.entries.get(entry.project.id) !== entry) return
      if (entry.wanted) this.next(entry)
      else this.finish(entry)
    })
  }

  private finish(entry: Entry): void {
    if (this.busy(entry)) return
    if (entry.state.building) this.say(entry, { building: false })
    for (const done of entry.settled.splice(0)) done()
  }

  /** The engine that answers, pinged once; rejects with why it did not start. */
  private async engine(entry: Entry): Promise<KernelClient> {
    const client = this.kernel()
    let pong = this.pongs.get(client)
    if (!pong) {
      this.say(entry, { engine: { state: 'starting' } })
      pong = answered(client, this.pingTimeoutMs).then(
        (p): EngineState => ({ state: 'ready', kernel: p.kernel, serve: p.serve }),
        (e: Error): EngineState => ({ state: 'failed', reason: `The engine did not start: ${e.message}` })
      )
      this.pongs.set(client, pong)
    }
    const engine = await pong
    if (engine.state === 'failed') throw new EngineDown(engine.reason)
    if (this.entries.get(entry.project.id) === entry && entry.state.engine.state !== 'ready') this.say(entry, { engine })
    return client
  }

  private async run(entry: Entry): Promise<void> {
    const open = () => this.entries.get(entry.project.id) === entry
    try {
      await engineMayWrite(entry.project.dir)
      const client = await this.engine(entry)
      if (!open()) return
      entry.startedAt = this.now()
      const before = entry.state.history
      const number = Math.max(before.at(-1)?.number ?? 0, entry.state.latest?.number ?? 0) + 1
      this.say(entry, { history: [...before, { number, hash: null, verdict: 'running', at: new Date(entry.startedAt).toISOString(), kept: false }] })
      const result = await client.build(entry.project.dir)
      const history = await this.readHistory(entry.project.dir)
      if (!open()) return
      entry.endedAt = this.now()
      // A result older than the one shown never replaces it.
      if (result.number < (entry.state.latest?.number ?? 0)) {
        this.say(entry, { history })
        return
      }
      this.engineFailedAt = undefined
      const route = result.routing?.state === 'current' ? result.routing.route_key : null
      if (route && !entry.routes.has(route)) entry.routes.set(route, result.number)
      this.say(entry, {
        latest: result,
        lastGood: result.hash ? result : entry.state.lastGood,
        history,
        problem: result.verdict === 'failed' ? failure(result) : null
      })
      for (const cb of this.resultListeners) cb(entry.project.id, result)
    } catch (e) {
      if (!open()) return
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
 * The engine's first answer. One that has said nothing in `ms` is ended, so that nothing waits on it for ever and the
 * next build starts another.
 */
function answered(client: KernelClient, ms: number): Promise<Pong> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`it did not answer within ${Math.round(ms / 1000)} s`))
      client.kill()
    }, ms)
    client.ping().then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/** The engine never answered its first ping. */
class EngineDown extends Error {}
