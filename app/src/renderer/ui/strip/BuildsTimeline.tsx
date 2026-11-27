import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { hint } from '../../../shared/keys'
import { actions, useStore } from '../../state/store'
import { timelineActions, useTimeline } from '../../state/timeline'
import { useProjectUsage } from '../../state/usage'
import { Chevron } from '../Chevron'
import { numbered } from '../numbered'
import { useNow } from '../useNow'
import { chipCost, groupCount, groupTitle, stripGroups, stripSays, type StripGroup, type StripNode } from './strip'
import { useThumbs } from './thumbs'
import { useStripNodes } from './useStripNodes'

/** What a node is told as to a screen reader and the pointer. */
function nodeTitle(node: StripNode): string {
  return [node.kind === 'running' ? 'Running build' : node.id, node.by, node.caption, node.onShow ? 'on show' : ''].filter((part) => part !== '').join(', ')
}

/** The picture of a build: its board drawn small, its id alone while none is; `failed` on a hatch; the seconds of the one that runs. */
function Pic({ node, url, seconds }: { node: StripNode; url: string | undefined; seconds: number }) {
  if (node.kind === 'failed') return <span className="strip-pic">failed</span>
  if (node.kind === 'running') {
    return (
      <span className="strip-pic">
        <span className="num">{seconds} s</span>
      </span>
    )
  }
  return <span className="strip-pic">{url ? <img src={url} alt="" /> : <span className="strip-pic-id num">{node.id}</span>}</span>
}

/** A press on a build shows it in the views: the newest that drew is the live one. */
const show = (node: StripNode, latest: number | null): void => actions.showBuild(node.number === latest ? null : node.number)

/** A build in the drawer: its picture, its id, and how it stands (`ok`, `routed`, `stale`, `not kept`...). */
function Node({ node, url, seconds, index, landing, latest }: { node: StripNode; url: string | undefined; seconds: number; index: number; landing: boolean; latest: number | null }) {
  return (
    <button
      type="button"
      className="strip-node"
      style={{ '--i': index } as React.CSSProperties}
      data-build={node.id}
      data-kind={node.kind}
      data-on-show={node.onShow ? '' : undefined}
      data-saved={node.saved ? '' : undefined}
      data-landing={landing ? '' : undefined}
      aria-label={nodeTitle(node)}
      aria-current={node.onShow ? 'true' : undefined}
      title={nodeTitle(node)}
      disabled={!node.pick}
      onClick={() => show(node, latest)}
    >
      <Pic node={node} url={url} seconds={seconds} />
      <span className="strip-id num">{node.kind === 'running' ? 'building' : node.id}</span>
      <span className="strip-by">{numbered(node.caption)}</span>
    </button>
  )
}

/** A group of several builds, folded: its last build's picture on a pile of the others. A click shows them all. */
function Pile({ group, url, seconds, title }: { group: StripGroup; url: string | undefined; seconds: number; title: string }) {
  const shown = group.nodes.find((node) => node.onShow)
  const under = shown ? (shown === group.last ? 'on show' : `${shown.id} on show`) : group.last.caption
  return (
    <button
      type="button"
      className="strip-node tl-pile"
      data-kind={group.last.kind}
      data-on-show={group.onShow ? '' : undefined}
      aria-expanded={false}
      aria-label={`${group.label}, ${groupCount(group)} builds: show them all`}
      title={title}
      onClick={() => timelineActions.toggleGroup(group.id)}
    >
      <Pic node={group.last} url={url} seconds={seconds} />
      <span className="strip-id num">{group.last.kind === 'running' ? 'building' : group.last.id}</span>
      <span className="strip-by">{numbered(under)}</span>
    </button>
  )
}

/**
 * The builds timeline (torno #332, adapted): a slim bar across the foot of the views, above the status line, with one chip for
 * each group of builds (`stripGroups`: a prompt's builds, the person's saves, their routes, an earlier run), and a drawer that
 * opens upward from it with the pictures. A group of several builds shows its last one on a pile and a count; a click on it
 * shows every build in it. A build is a button: a press shows it in the views, as the strip's did. A chip opens the drawer at
 * its group. Open or shut is the window's (`state/timeline`), by the toggle at the left of the bar or the key. `ViewPane`
 * draws it under the three views, never on the Brief.
 */
export function BuildsTimeline() {
  const project = useStore((s) => s.project)
  const build = useStore((s) => s.build)
  const open = useTimeline((s) => s.open)
  const expanded = useTimeline((s) => s.expanded)
  const { nodes, words, tell } = useStripNodes()
  const groups = useMemo(() => stripGroups(nodes), [nodes])
  const usage = useProjectUsage()
  const latest = build?.lastGood?.number ?? null
  const projectId = project?.id ?? null
  const thumbs = useThumbs(projectId, nodes.slice(-24), tell)
  const running = build?.history.find((e) => e.verdict === 'running')
  const now = useNow(running !== undefined)
  const seconds = running ? Math.max(0, Math.round((now - Date.parse(running.at)) / 1000)) : 0

  const drawer = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const chips = useRef<HTMLDivElement>(null)

  // What was not there when the timeline was last drawn lands: not what the history was read as, and not another project's.
  const seen = useRef<{ of: string | null; ids: Set<string> } | null>(null)
  const loaded = build !== null && build.projectId === projectId
  const landing = new Set<string>()
  if (loaded && seen.current && seen.current.of === projectId) for (const node of nodes) if (node.kind !== 'running' && !seen.current.ids.has(node.id)) landing.add(node.id)
  const ids = nodes.map((n) => n.id).join(',')
  useEffect(() => {
    if (loaded) seen.current = { of: projectId, ids: new Set(ids.split(',')) }
  }, [loaded, projectId, ids])

  // The wheel turns the track and the chips sideways. Not passive: a row that scrolls takes the wheel from the view.
  useEffect(() => {
    const rows = [track.current, chips.current].filter((el): el is HTMLDivElement => el !== null)
    const wheel = (e: WheelEvent): void => {
      const el = e.currentTarget as HTMLElement
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    for (const el of rows) el.addEventListener('wheel', wheel, { passive: false })
    return () => rows.forEach((el) => el.removeEventListener('wheel', wheel))
  }, [projectId])

  // The newest in sight when one lands, and the build on show in sight whatever else is: it wins where both cannot be.
  const onShowKey = groups.find((g) => g.onShow)?.id
  const newest = nodes.at(-1)?.id
  useLayoutEffect(() => {
    for (const [el, selector] of [
      [track.current, '[data-on-show]'],
      [chips.current, '.tl-chip[data-on-show]']
    ] as const) {
      if (!el) continue
      el.scrollLeft = el.scrollWidth
      const shown = el.querySelector<HTMLElement>(selector)
      if (!shown) continue
      const box = el.getBoundingClientRect()
      const at = shown.getBoundingClientRect()
      const [left, right] = [at.left - box.left + el.scrollLeft, at.right - box.left + el.scrollLeft]
      if (left < el.scrollLeft + 16) el.scrollLeft = left - 16
      else if (right > el.scrollLeft + el.clientWidth - 16) el.scrollLeft = right - el.clientWidth + 16
    }
  }, [onShowKey, newest, open, expanded.length, groups.length === 0])

  if (!project) return null

  const says = stripSays(nodes)
  const kept = nodes.filter((n) => n.kind === 'built').length
  const reveal = (id: string): void => {
    timelineActions.reveal(id)
    requestAnimationFrame(() => drawer.current?.querySelector<HTMLElement>(`.tl-group[data-group="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  }

  return (
    <section className="timeline" data-open={open ? '' : undefined} aria-label="Builds" data-region="builds">
      <div ref={drawer} id="timeline-drawer" className="timeline-drawer" inert={!open} aria-hidden={!open}>
        <div className="timeline-sheet">
          <div className="timeline-head">
            <b>Builds of {project.name}</b>
            <span className="num">{kept}</span> kept
            <span className="timeline-says" aria-live="polite">
              {numbered(says)}
            </span>
          </div>
          <div ref={track} className="timeline-track">
            {groups.length === 0 ? (
              <p className="timeline-empty">No build yet</p>
            ) : (
              groups.map((group) => {
                const many = group.nodes.length > 1
                const all = !many || expanded.includes(group.id)
                const title = groupTitle(group, words)
                return (
                  <div key={group.id} className="tl-group" role="group" aria-label={group.label} data-group={group.id} data-expanded={many && all ? '' : undefined} data-saved={group.saved ? '' : undefined}>
                    {many ? (
                      <button type="button" className="tl-group-head" aria-expanded={all} title={title} onClick={() => timelineActions.toggleGroup(group.id)}>
                        <span className="tl-group-label">{group.label}</span>
                        <span className="num">({groupCount(group)})</span>
                      </button>
                    ) : (
                      <span className="tl-group-head" title={title}>
                        <span className="tl-group-label">{group.label}</span>
                      </span>
                    )}
                    <div className="tl-group-builds">
                      {all ? (
                        group.nodes.map((node, i) => <Node key={node.id} node={node} url={thumbs.get(node.id)} seconds={seconds} index={i} landing={landing.has(node.id)} latest={latest} />)
                      ) : (
                        <Pile group={group} url={thumbs.get(group.last.id)} seconds={seconds} title={title} />
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
      <div className="timeline-bar">
        <button type="button" className="timeline-toggle" aria-expanded={open} aria-controls="timeline-drawer" aria-keyshortcuts={hint('builds.toggle')} title={`${open ? 'Fold the builds' : 'Show the builds'} (${hint('builds.toggle')})`} onClick={() => timelineActions.toggle()}>
          <span className="timeline-chevron" data-open={open ? '' : undefined}>
            <Chevron />
          </span>
          Builds
          <span className="num">{kept}</span>
        </button>
        <div ref={chips} className="timeline-chips" role="list" aria-label="Builds by what made them, newest at the right">
          {groups.length === 0 ? (
            <span className="timeline-empty">No build yet</span>
          ) : (
            groups.map((group) => (
              <span key={group.id} role="listitem" className="tl-chip-item">
                <button
                  type="button"
                  className="tl-chip"
                  data-group={group.id}
                  data-state={group.state}
                  data-on-show={group.onShow ? '' : undefined}
                  data-saved={group.saved ? '' : undefined}
                  data-landing={group.nodes.some((n) => landing.has(n.id)) && group.nodes.every((n) => landing.has(n.id) || n.kind === 'running') ? '' : undefined}
                  title={groupTitle(group, words)}
                  onClick={() => reveal(group.id)}
                >
                  {group.saved && <span className="tl-chip-dot" aria-hidden="true" />}
                  <span className="tl-chip-label">{group.label}</span>
                  {groupCount(group) > 1 && <span className="num tl-chip-count">({groupCount(group)})</span>}
                  {group.state === 'running' && <span className="num tl-chip-count">{seconds} s</span>}
                  {(() => {
                    const cost = chipCost(group, usage)
                    return cost && <span className="num tl-chip-cost" data-large={cost.large ? '' : undefined} title={cost.large ? "What the prompt cost: a large turn, 3 times this project's usual one or more" : 'What the prompt cost'}>{cost.text}</span>
                  })()}
                </button>
              </span>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
