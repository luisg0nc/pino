// pino's answers to a session (sessions/domain.ts): what Claude is told with each prompt (the newest build, what the
// person sees, their new marks), and when a turn may not end yet (a build Claude made in it still running, failed, or
// unseen).

import { verdictWords, type BuildResult, type BuildState, type Finding } from '../shared/build'
import { at } from '../shared/board/coords'
import type { Mark } from '../shared/marks'
import type { ProjectInfo } from '../shared/project'
import { TAB_NAMES, type BoardLook, type PaneTab, type Selection } from '../shared/view'
import { layerWords } from '../shared/board/refs'
import type { Builds } from './builds'
import type { CardStore } from './cards/store'
import { cardsLine } from './cards/text'
import type { PromptContext, SessionDomain } from './sessions/domain'

/** The most a prompt's added context may be, in characters, and the build's verdict within it. */
export const CONTEXT_LIMIT = 6000
export const VERDICT_LIMIT = 1200
/** The longest a Stop waits for a build that is nearly done (its hook has 25 s). */
export const STOP_WAIT_MS = 20_000
/** A turn is held back this many times at most. */
export const MOST_HOLDS = 2
const MOST_FINDINGS = 5
const STOP_LIMIT = 1200

export interface DomainDeps {
  builds: Pick<Builds, 'state' | 'whenSettled' | 'routedOn' | 'ranSince' | 'claudesComing' | 'claudesBuild'>
  marks: {
    /** The person's marks not yet sent, oldest first. */
    drafts(project: ProjectInfo): Promise<Mark[]>
    /** Marks sent and not resolved. */
    open(project: ProjectInfo): Promise<Mark[]>
    markSent(project: ProjectInfo, ids: string[]): Promise<void>
  }
  /** The cards of the project's Brief, and what Claude was last told of them. */
  cards: Pick<CardStore, 'read' | 'told' | 'markTold'>
  /** The words of the project's `brief.md`; undefined where there is none. */
  brief(project: ProjectInfo): Promise<string | undefined>
  /** What the person has on screen, as the window last said. */
  view(): { tab: PaneTab; look: BoardLook; selection: Selection | null } | null
  toolName: (tool: string) => string
  now?: () => number
}

const cut = (text: string, most: number): string => (text.length <= most ? text : `${text.slice(0, most - 6)} (cut)`)

function findingLine(f: Finding): string {
  const place = f.at?.space === 'board' && f.at.x !== undefined && f.at.y !== undefined ? ` at ${at({ x: f.at.x, y: f.at.y })} mm` : ''
  return `- [${f.severity}] ${f.source} ${f.code}: ${f.message}${place}`
}

function routingLine(r: BuildResult, state: BuildState, routedOn: number | undefined): string | null {
  const routing = r.routing
  if (state.route) return `Routing: running, ${state.route.index} of ${state.route.of} nets.`
  if (!routing || routing.state === 'none') return null
  if (routing.state === 'current') return `Routing: current, r${routing.number}.`
  if (routing.state === 'running') return 'Routing: running.'
  const from = routedOn !== undefined ? `copper from h${routedOn}` : `copper from r${routing.number}`
  return `Routing: stale (${routing.stale_because.join(', ')}), ${from}.`
}

/** A failed build in one line: why, where, and what the views still show. */
function failedLine(r: BuildResult, state: BuildState): string {
  const finding = r.findings.find((f) => f.severity === 'error')
  const source = finding?.at?.space === 'source' && finding.at.file ? `, ${finding.at.file}${finding.at.line ? ` line ${finding.at.line}` : ''}` : ''
  const why = finding ? `${finding.message}${source}` : verdictWords(r).rest
  const shows = state.lastGood ? ` The views still show h${state.lastGood.number}.` : ''
  return `h${r.number} failed: ${why}.${shows}`
}

/** The newest build as Claude is told it, at most VERDICT_LIMIT characters. */
export function verdictText(r: BuildResult, state: BuildState, routedOn: number | undefined): string {
  const running = state.building ? state.history.find((e) => e.verdict === 'running') : undefined
  const after = running ? `Building h${running.number} now.` : null
  if (r.verdict === 'failed') return cut([failedLine(r, state), after].filter(Boolean).join('\n'), VERDICT_LIMIT)
  const found = r.findings.filter((f) => f.severity !== 'info').slice(0, MOST_FINDINGS)
  const lines = [`${verdictWords(r).on}: ${verdictWords(r).rest}.`, ...found.map(findingLine), after, routingLine(r, state, routedOn)]
  return cut(lines.filter(Boolean).join('\n'), VERDICT_LIMIT)
}

function viewLine(view: NonNullable<ReturnType<DomainDeps['view']>>): string {
  // Nothing of a view is in front of them there, so what is selected in one is not said.
  if (view.tab === 'brief') return 'The person sees the Brief.'
  if (view.tab === 'usage') return 'The person sees the Usage page.'
  const what = view.tab === 'board' ? `${TAB_NAMES.board} tab, ${layerWords(view.look.active)}` : view.tab === '3d' ? '3D tab' : `${TAB_NAMES.schematic} tab`
  const held = view.selection ? ` Selected: ${view.selection.text}.` : ''
  return `The person sees the ${what}.${held}`
}

const markLine = (m: Mark): string => `${m.id} ${m.payload}${m.note ? ` · note: "${m.note}"` : ''}`

/** What became of a stale mark's target, from its payload's last words. */
const staleWords = (m: Mark): string => / · stale: (.+?), it was at \(/.exec(m.payload)?.[1] ?? 'its target is gone'

interface Turn {
  startedAt: number
  /** The hash of the board there was when the turn began. */
  board: string | null
  holds: number
  held: Set<string>
}

export class PinoDomain implements SessionDomain {
  private readonly turns = new Map<string, Turn>()
  private readonly lookedAt = new Map<string, number>()
  /** The hash of the newest build when Claude last looked, by project. */
  private readonly lookedHash = new Map<string, string>()
  private readonly now: () => number

  constructor(private readonly deps: DomainDeps) {
    this.now = deps.now ?? Date.now
  }

  /** Claude saw the board (`look`) or its checks (`check`) just now. */
  looked(projectId: string): void {
    this.lookedAt.set(projectId, this.now())
    const hash = this.deps.builds.state(projectId)?.latest?.hash
    if (hash) this.lookedHash.set(projectId, hash)
  }

  async promptContext(project: ProjectInfo, _prompt: string): Promise<PromptContext> {
    const state = this.deps.builds.state(project.id)
    this.turns.set(project.id, { startedAt: this.now(), board: state?.lastGood?.hash ?? null, holds: 0, held: new Set() })
    const lines: string[] = []
    if (state?.engine.state === 'failed') lines.push(`The engine is not running: ${state.engine.reason.slice(state.engine.reason.indexOf(': ') + 2)}.`)
    else if (state?.latest) lines.push(verdictText(state.latest, state, this.routedOn(project.id, state.latest)))
    const brief = await this.briefNews(project)
    if (brief.line) lines.push(brief.line)

    const [drafts, open] = await Promise.all([this.deps.marks.drafts(project), this.deps.marks.open(project)])
    const view = this.deps.view()
    // With nothing built and nothing marked there is nothing to say of the view either.
    if (view && (state?.lastGood || drafts.length)) lines.push(viewLine(view))
    const openLine = open.length ? `Open marks: ${open.map((m) => (m.anchor === 'stale' ? `${m.id} (stale: ${staleWords(m)})` : m.id)).join(', ')}.` : ''

    // Room is kept for the line of open marks and for the count of what does not fit.
    const room = CONTEXT_LIMIT - cut(openLine, 600).length - 80
    const sent: string[] = []
    let length = lines.join('\n').length
    for (const mark of drafts) {
      const line = markLine(mark)
      if (length + line.length + 1 > room) break
      length += line.length + 1
      lines.push(line)
      sent.push(mark.id)
    }
    const left = drafts.length - sent.length
    if (left > 0) lines.push(`and ${left} more mark${left === 1 ? '' : 's'}: call ${this.deps.toolName('marks')}`)
    if (openLine) lines.push(cut(openLine, 600))

    const told = brief.told
    return {
      text: cut(lines.join('\n'), CONTEXT_LIMIT),
      sentMarkIds: sent,
      ...(sent.length || told
        ? {
            delivered: async () => {
              if (sent.length) await this.deps.marks.markSent(project, sent)
              if (told) await this.deps.cards.markTold(project.id, told)
            }
          }
        : {})
    }
  }

  /**
   * The Brief's line for a prompt, and what to keep as told once it is delivered, when that is not what was told
   * already. A Brief that cannot be read says nothing: the prompt goes without it.
   */
  private async briefNews(project: ProjectInfo): Promise<{ line: string; told?: Record<string, string> }> {
    try {
      const [file, before, words] = await Promise.all([this.deps.cards.read(project.id), this.deps.cards.told(project.id), this.deps.brief(project)])
      const { line, told } = cardsLine(file, before, words, this.deps.toolName)
      const same = Object.keys(told).length === Object.keys(before).length && Object.entries(told).every(([key, value]) => before[key] === value)
      return { line, ...(same ? {} : { told }) }
    } catch (e) {
      console.error(`cannot read the Brief of ${project.id}: ${(e as Error).message}`)
      return { line: '' }
    }
  }

  async stopAnswer(project: ProjectInfo, prompts: readonly string[]): Promise<{ decision: 'block'; reason: string } | null> {
    const turn = this.turns.get(project.id)
    if (!turn || turn.holds >= MOST_HOLDS) return null
    const coming = () => this.deps.builds.claudesComing(project.id, turn.startedAt, prompts)
    let state = this.deps.builds.state(project.id)
    if (!state) return null
    // A build of Claude's on its way is waited for, also a save of its that no build has started for yet. A build or a
    // save of the person's is not, and with nothing of Claude's the answer is given at once.
    if (coming() !== undefined) state = await this.deps.builds.whenSettled(project.id, this.now() + STOP_WAIT_MS)

    const hold = (kind: string, reason: string) => {
      if (turn.held.has(kind)) return null
      turn.held.add(kind)
      turn.holds += 1
      return { decision: 'block' as const, reason: cut(reason, STOP_LIMIT) }
    }
    const number = coming()
    if (number !== undefined) return hold('running', `h${number}, started in this turn, is still building. Wait for it, then call ${this.deps.toolName('check')}.`)
    const own = this.deps.builds.claudesBuild(project.id, turn.startedAt, prompts)
    if (!own) return null
    const { result } = own
    // A failure a later build has drawn past is no board of Claude's to mend any more.
    if (result.verdict === 'failed') return own.redrawn ? null : hold('failed', `${failedLine(result, state)} Fix board.py, or say it is still broken.`)
    // The engine numbers a build it has cached anew, and its `changes` are since the last build of another hash: the
    // hash says whether this is a board Claude has seen, or the one the turn began with.
    const seen = (this.lookedAt.get(project.id) ?? -Infinity) >= own.endedAt || this.lookedHash.get(project.id) === result.hash
    const changed = result.hash !== turn.board && result.changes.circuit.length + result.changes.layout.length > 0
    if (seen || !changed) return null
    return hold('unlooked', `h${result.number} was built in this turn and you have not looked at it. Call ${this.deps.toolName('look')} or ${this.deps.toolName('check')} before finishing.`)
  }

  turnBuilds(project: ProjectInfo, since: number, prompts: readonly string[]) {
    return this.deps.builds.ranSince(project.id, since, prompts)
  }

  private routedOn(projectId: string, r: BuildResult): number | undefined {
    return r.routing?.route_key ? this.deps.builds.routedOn(projectId, r.routing.route_key) : undefined
  }
}
