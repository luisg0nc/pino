// The builds strip's rules, pure: one node for each build of the project's history, what it is captioned, which is on
// show and which can be picked. The strip draws what these say (`BuildsStrip`).

import type { BuildEntry, BuildResult } from '../../../shared/build'

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

export interface StripNode {
  /** `h7`. */
  id: string
  number: number
  hash: string | null
  kind: 'built' | 'failed' | 'running' | 'gone'
  caption: string
  /** The build the views show. */
  onShow: boolean
  /** A press on it shows it: it drew something and its folder is still there. */
  pick: boolean
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

/**
 * The strip's nodes, oldest first. `latest`: the number of the newest build that drew something, which is on show
 * unless `shown` names an older one.
 */
export function stripNodes(history: readonly BuildEntry[], at: { latest: number | null; shown: number | null; facts: ReadonlyMap<number, Facts> }): StripNode[] {
  const byNumber = new Map(history.map((entry) => [entry.number, entry]))
  const onShow = at.shown ?? at.latest
  return [...byNumber.values()]
    .sort((a, b) => a.number - b.number)
    .map((entry) => {
      const kind = entry.verdict === 'running' ? 'running' : entry.verdict === 'failed' ? 'failed' : entry.kept ? 'built' : 'gone'
      return {
        id: `h${entry.number}`,
        number: entry.number,
        hash: entry.hash,
        kind,
        caption: captionOf(entry, at.facts.get(entry.number)),
        onShow: entry.number === onShow,
        pick: kind === 'built' && entry.hash !== null
      }
    })
}
