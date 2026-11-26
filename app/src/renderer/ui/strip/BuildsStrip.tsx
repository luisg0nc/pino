import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ProjectInfo } from '../../../shared/project'
import { actions, useStore } from '../../state/store'
import { numbered } from '../numbered'
import { factsOf, stripNodes, type Facts, type StripNode } from './strip'
import { useThumbs } from './thumbs'

/** What a node is told as to a screen reader and the pointer. */
const titleOf = (node: StripNode): string => [node.id, node.caption, node.onShow ? 'on show' : ''].filter(Boolean).join(', ')

/** What the results of this run said of their builds, for each project: the history keeps only a verdict. */
const facts = new Map<string, Map<number, Facts>>()

/**
 * The builds strip at the top of the dock (torno's, adapted): the project's builds, oldest at the left, each a picture
 * of its board. A press shows that build in the views; the one on show is ringed in the accent. A new build lands from
 * the right, once. A build the engine no longer keeps is greyed and says so.
 */
export function BuildsStrip({ project }: { project: ProjectInfo }) {
  const build = useStore((s) => s.build)
  const shown = useStore((s) => s.shown)
  const [, setTold] = useState(0)
  let known = facts.get(project.id)
  if (!known) facts.set(project.id, (known = new Map()))
  if (build?.latest) known.set(build.latest.number, factsOf(build.latest))

  const history = build?.history ?? []
  const nodes = stripNodes(history, { latest: build?.lastGood?.number ?? null, shown, facts: known })
  const thumbs = useThumbs(project.id, nodes.slice(-12), (number, said) => {
    if (build?.latest?.number !== number && !known.has(number)) {
      known.set(number, said)
      setTold((n) => n + 1)
    }
  })

  // A node that was not there when the strip was last drawn lands: not the ones the history was read as.
  const seen = useRef<{ of: string; numbers: Set<number> } | null>(null)
  const landing = new Set<number>()
  if (seen.current?.of === project.id) for (const node of nodes) if (node.kind !== 'running' && !seen.current.numbers.has(node.number)) landing.add(node.number)
  useEffect(() => {
    if (build) seen.current = { of: project.id, numbers: new Set(nodes.filter((n) => n.kind !== 'running').map((n) => n.number)) }
  }, [build, project.id])

  // The newest build in sight when one lands, and the build on show when another is chosen.
  const track = useRef<HTMLDivElement>(null)
  const newest = nodes.at(-1)?.number
  useLayoutEffect(() => {
    const element = track.current
    if (!element) return
    element.scrollLeft = element.scrollWidth
    const on = element.querySelector<HTMLElement>('[data-on-show]')
    if (on && on.offsetLeft < element.scrollLeft) element.scrollLeft = Math.max(0, on.offsetLeft - 14)
  }, [newest, shown])

  if (!nodes.length) return null
  const kept = nodes.filter((n) => n.kind === 'built').length
  return (
    <section className="strip" aria-label="Builds" data-region="builds">
      <p className="strip-head">
        <b>Builds of {project.name}</b>
        <span className="num">{kept}</span> kept
      </p>
      <div ref={track} className="strip-track">
        {nodes.map((node) => (
          <button
            key={node.number}
            type="button"
            className="strip-node"
            data-build={node.id}
            data-kind={node.kind}
            data-on-show={node.onShow || undefined}
            data-landing={landing.has(node.number) || undefined}
            aria-label={titleOf(node)}
            aria-current={node.onShow ? 'true' : undefined}
            title={titleOf(node)}
            disabled={!node.pick}
            onClick={() => actions.showBuild(node.number === build?.lastGood?.number ? null : node.number)}
          >
            <span className="strip-pic">{thumbs.has(node.id) ? <img src={thumbs.get(node.id)} alt="" /> : <span className="strip-pic-word">{node.kind === 'failed' ? 'failed' : node.kind === 'running' ? '…' : ''}</span>}</span>
            <span className="strip-id">{node.id}</span>
            <span className="strip-by">{numbered(node.caption)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
