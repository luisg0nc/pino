import { useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import { usePrompts } from '../chat/usePrompts'
import { factsOf, stripNodes, type Facts, type StripNode } from './strip'

/** What the results of this run said of their builds, for each project: the history keeps only a verdict. */
const facts = new Map<string, Map<number, Facts>>()

/**
 * The builds timeline's nodes for the open project (`stripNodes`), with the prompts numbered across its conversations
 * (`chat.prompts`), asked again when the session moves on or a build names a prompt not numbered yet. `words`: each
 * prompt's own words, by number, for a group's title. `tell`: what a build's result said of it, once read.
 */
export function useStripNodes(): { nodes: StripNode[]; words: ReadonlyMap<number, string>; tell: (number: number, said: Facts) => void } {
  const projectId = useStore((s) => s.project?.id ?? null)
  const build = useStore((s) => s.build)
  const shown = useStore((s) => s.shown)
  const status = useStore((s) => s.session?.status ?? '')
  const [, setTold] = useState(0)
  const history = build?.history ?? []
  const newest = history.findLast((e) => e.turn)?.turn?.prompt ?? ''
  const rows = usePrompts(projectId !== null, `${status} ${newest}`)
  const numbering = useMemo(() => new Map((rows ?? []).map((r): [string, number] => [r.id, r.number])), [rows])
  const words = useMemo(() => new Map((rows ?? []).map((r): [number, string] => [r.number, r.text])), [rows])

  let known = projectId === null ? new Map<number, Facts>() : facts.get(projectId)
  if (!known) facts.set(projectId!, (known = new Map()))
  if (build?.latest) known.set(build.latest.number, factsOf(build.latest))
  const nodes = stripNodes(history, { latest: build?.lastGood?.number ?? null, shown, facts: known }, numbering)
  const tell = (number: number, said: Facts): void => {
    if (build?.latest?.number !== number && !known.has(number)) {
      known.set(number, said)
      setTold((n) => n + 1)
    }
  }
  return { nodes, words, tell }
}
