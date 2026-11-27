import type { BuildCause, BuildEntry, BuildResult } from '../../../shared/build'

// The builds timeline's rules, pure: which nodes the project's history makes, how they are grouped by what made them, what a
// group is labelled and titled, and how the build on show is named. The timeline draws what these say (`BuildsTimeline`), and
// the route card's head names the build with `buildNamed`.

/** What a result said of its build that the history does not keep. */
export interface Facts {
  routing: 'current' | 'stale' | null
  errors: number
  verdict: BuildResult['verdict']
}

export const factsOf = (r: BuildResult): Facts => ({
  routing: r.routing?.state === 'current' || r.routing?.state === 'stale' ? r.routing.state : null,
  errors: r.counts.errors,
  verdict: r.verdict
})

/** One build of the project, as the timeline draws it. */
export interface StripNode {
  /** The history id (`h41`). */
  id: string
  number: number
  hash: string | null
  kind: 'built' | 'failed' | 'running' | 'gone'
  /** How it stands, under its picture: `ok`, `routed`, `stale`, `2 errors`, `failed`, `not kept`, `building`. */
  caption: string
  /** What made it, as its group is labelled (`byOf`): `Prompt 14`, `Saved by you`, `Routed by you`, `Earlier`; empty when nothing is known yet. */
  by: string
  /** What made it, as main kept it. */
  cause: BuildCause
  /** The person made it: their own save, or a route they started. */
  saved: boolean
  /** The build the views show. */
  onShow: boolean
  /** A press on it shows it: it drew something and its folder is still there. */
  pick: boolean
  /** The prompt it was made for, by number. */
  prompt?: number
}

export function captionOf(entry: BuildEntry, facts: Facts | undefined): string {
  if (entry.verdict === 'running') return 'building'
  if (entry.verdict === 'failed') return 'failed'
  if (!entry.kept) return 'not kept'
  if (facts?.routing === 'current') return 'routed'
  if (facts?.routing === 'stale') return 'stale'
  if (facts?.errors) return `${facts.errors} error${facts.errors === 1 ? '' : 's'}`
  return entry.verdict === 'errors' ? 'errors' : 'ok'
}

const promptBy = (n: number | undefined): string => (n === undefined ? '' : `Prompt ${n}`)

/** What made a build, as its group is labelled: `Prompt 14`, `Saved by you`, `Routed by you`, `Earlier`; `Claude Code` for a prompt with no number. */
function byOf(cause: BuildCause, number: number | undefined): string {
  if (number !== undefined) return promptBy(number)
  switch (cause) {
    case 'person':
      return 'Saved by you'
    case 'route':
      return 'Routed by you'
    case 'agent':
      return 'Claude Code'
    case 'unknown':
      return 'Earlier'
  }
}

const savedBy = (cause: BuildCause): boolean => cause === 'person' || cause === 'route'

/**
 * The nodes of the timeline, oldest to newest, one a build number (the later entry standing). `latest`: the number of the
 * newest build that drew something, which is on show unless `shown` names an older one. `numbering` is the project's prompts
 * by id (`chat.prompts`), for the labels. A build that runs with nothing known of what made it (an opening, a Rebuild) is
 * nobody's yet: its group is `Building`.
 */
export function stripNodes(
  history: readonly BuildEntry[],
  at: { latest: number | null; shown: number | null; facts: ReadonlyMap<number, Facts> },
  numbering: ReadonlyMap<string, number> = new Map()
): StripNode[] {
  const byNumber = new Map(history.map((entry) => [entry.number, entry]))
  const onShow = at.shown ?? at.latest
  return [...byNumber.values()]
    .sort((a, b) => a.number - b.number)
    .map((entry) => {
      const kind = entry.verdict === 'running' ? 'running' : entry.verdict === 'failed' ? 'failed' : entry.kept ? 'built' : 'gone'
      const cause = entry.cause ?? 'unknown'
      const prompt = cause === 'agent' && entry.turn ? numbering.get(entry.turn.prompt) : undefined
      return {
        id: `h${entry.number}`,
        number: entry.number,
        hash: entry.hash,
        kind,
        caption: captionOf(entry, at.facts.get(entry.number)),
        by: kind === 'running' && cause === 'unknown' ? '' : byOf(cause, prompt),
        cause,
        saved: savedBy(cause),
        onShow: entry.number === onShow,
        pick: kind === 'built' && entry.hash !== null,
        ...(prompt !== undefined ? { prompt } : {})
      }
    })
}

/** A run of builds made by one thing: a prompt, the person's saves, their routes, an earlier run. */
export interface StripGroup {
  /** The id of its first build: what the timeline keeps it open by. */
  id: string
  /** `Prompt 4`, `Saved by you`, `Routed by you`, `Earlier`, `Claude Code`; `Building` for one nobody can say yet. */
  label: string
  /** Its builds, oldest first. */
  nodes: StripNode[]
  /** Its last build: the one a folded group shows. */
  last: StripNode
  prompt?: number
  /** The person's own: their saves or their routes. */
  saved: boolean
  /** How its last build went. */
  state: StripNode['kind']
  /** One of its builds is on show. */
  onShow: boolean
}

/** What puts two nodes side by side in one group: the same prompt, or the same cause that is not a prompt's. */
function groupOf(node: StripNode): string {
  if (node.prompt !== undefined) return `prompt ${node.prompt}`
  if (node.by === '') return `now ${node.id}`
  return node.cause
}

/**
 * The groups of the timeline, oldest to newest: the builds of one prompt are one group, and so are consecutive saves of the
 * person's, consecutive routes of theirs and an earlier run. A group shows its last build and a count.
 */
export function stripGroups(nodes: readonly StripNode[]): StripGroup[] {
  const groups: StripGroup[] = []
  let at: string | undefined
  for (const node of nodes) {
    const of = groupOf(node)
    const open = groups.at(-1)
    if (open && of === at) {
      open.nodes.push(node)
      open.last = node
      open.state = node.kind
      open.onShow ||= node.onShow
    } else {
      const label = node.by !== '' ? node.by : 'Building'
      groups.push({ id: node.id, label, nodes: [node], last: node, ...(node.prompt !== undefined ? { prompt: node.prompt } : {}), saved: node.saved, state: node.kind, onShow: node.onShow })
    }
    at = of
  }
  return groups
}

export const groupCount = (group: StripGroup): number => group.nodes.length

/**
 * What a group says in its title, two lines: what made it in words (the prompt's own, `words` by prompt number), then its
 * builds and how they stand. The label never carries the prompt's words.
 */
export function groupTitle(group: StripGroup, words: ReadonlyMap<number, string> = new Map()): string {
  const text = group.prompt !== undefined ? words.get(group.prompt) : undefined
  const head = text ? `${group.label}: ${text}` : group.label
  const ids = group.nodes.filter((node) => node.kind !== 'running')
  const span = ids.length === 0 ? '' : ids.length === 1 ? ids[0]!.id : `${ids[0]!.id} to ${ids.at(-1)!.id}`
  const facts = [
    group.nodes.length > 1 ? `${group.nodes.length} builds, ${span}` : group.last.kind === 'running' ? 'building' : span,
    ...group.nodes.filter((node) => node.onShow).map((node) => `${node.id} on show`),
    group.state === 'failed' ? (group.nodes.length > 1 ? 'the last failed' : 'failed') : ''
  ].filter((part) => part !== '')
  return `${head}\n${facts.join(', ')}`
}

/** A build named in words, as the head of the route card says it (torno #335). */
export interface BuildNamed {
  /** Its history id: said in the title only. */
  id: string
  /** `Latest build · prompt 5`, `Latest build · saved by you`, or `Prompt 3 · older build`. */
  head: string
  /** It is the newest build there is (one that runs after it does not count). */
  latest: boolean
}

/** What made a build, inside a line: `prompt 5`, `saved by you`; `Claude Code` keeps its capitals. */
const byInLine = (by: string): string => (by === 'Claude Code' ? by : by.charAt(0).toLowerCase() + by.slice(1))

/**
 * A build of the timeline named with the timeline's own words: the newest one by what made it (a failed one too: the head
 * says it failed), an older one as older. An earlier run's latest build is the latest build alone. Null when the timeline
 * does not have it.
 */
export function buildNamed(nodes: readonly StripNode[], number: number): BuildNamed | null {
  const node = nodes.find((n) => n.number === number && n.kind !== 'running')
  if (!node) return null
  const latest = nodes.findLast((n) => n.kind !== 'running') === node
  const by = node.by !== '' ? node.by : 'Earlier'
  return { id: node.id, head: latest ? (by === 'Earlier' ? 'Latest build' : `Latest build · ${byInLine(by)}`) : `${by} · older build`, latest }
}

/** What a pick does now, at the right of the drawer's head line. */
export function stripSays(nodes: readonly StripNode[]): string {
  if (nodes.some((node) => node.kind === 'running')) return 'A build is running'
  const shown = nodes.find((node) => node.onShow)
  if (shown && nodes.findLast((node) => node.kind === 'built') !== shown) return `${shown.id} is on show: pick the newest to go back`
  return 'Pick one to show it in the views'
}
