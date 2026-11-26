import { useRef } from 'react'
import { buildSeconds, clock, netGauge, openNets } from '../../shared/checks'
import type { ProjectInfo } from '../../shared/project'
import { actions, useStore } from '../state/store'
import { useViewModel } from '../state/viewModel'
import { FabPopover } from './FabPopover'
import { numbered } from './numbered'
import { sessionWord } from './sessionWords'
import { useNow } from './useNow'

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The foot of the window: the project's folder, how its build stands and how to build it again, the routing, what the
 * checks hold against it, what there is to say once, its session and KiCad's version.
 */
export function StatusLine({ project }: { project: ProjectInfo }) {
  const session = useStore((s) => s.session)
  const notice = useStore((s) => s.notice)
  const build = useStore((s) => s.build)
  const { model } = useViewModel()
  const fab = useStore((s) => s.fab)
  const fabOpen = useStore((s) => s.fabOpen)
  const fabButton = useRef<HTMLButtonElement>(null)
  // Only an engine of protocol 3 makes fab files.
  const makesFab = build?.engine.state === 'ready' && build.engine.serve >= 3
  const latest = build?.latest ?? null
  const good = build?.lastGood ?? null
  const words = build?.building
    ? `Building h${(latest?.number ?? 0) + 1}`
    : latest?.verdict === 'failed'
      ? `h${latest.number} failed`
      : good
        ? `h${good.number} built in ${buildSeconds(good)} s`
        : 'No build yet'

  const route = build?.route ?? null
  const now = useNow(route !== null)
  let routed: string | null = null
  if (route) routed = `routing ${route.of ? `${route.index}/${route.of}` : route.step}, ${clock(now - route.startedAt)}`
  else if (model) {
    const routing = model.result.routing
    if (routing?.state === 'current' || routing?.state === 'stale') {
      const gauge = netGauge(model.circuit, model.open ? [...model.open] : openNets(model.result, model.placement, null), routing)
      routed = `routed ${gauge.done}/${gauge.total}${routing.state === 'stale' ? ', stale' : ''}`
    } else routed = 'not routed'
  }

  /** A press on a count goes to the first such finding with a place, and lights it. */
  const first = (severity: 'error' | 'warning') => {
    if (!latest) return
    const at = latest.findings.findIndex((f) => f.severity === severity && (f.at?.space === 'board' || f.at?.space === 'sheet'))
    if (at < 0) return
    actions.setTab(latest.findings[at].at!.space === 'sheet' ? 'schematic' : 'board')
    actions.hoverFinding(at)
  }
  const found = (severity: 'error' | 'warning', n: number) =>
    n > 0 && (
      <button type="button" className="status-found" data-severity={severity} onClick={() => first(severity)} onPointerLeave={() => actions.hoverFinding(null)}>
        {numbered(count(n, severity))}
      </button>
    )

  return (
    <footer className="status" data-region="status">
      <span className="status-name num" title={project.dir}>
        {project.name}
      </span>
      <span className="status-build">{numbered(words)}</span>
      {(latest || build?.problem) && (
        <button type="button" className="status-rebuild" disabled={build?.building} onClick={() => void window.pino.build.rebuild(project.id)}>
          Rebuild
        </button>
      )}
      {routed && <span className="status-routed">{numbered(routed)}</span>}
      {latest && found('error', latest.counts.errors)}
      {latest && latest.verdict !== 'failed' && found('warning', latest.counts.warnings)}
      {good && <span>{numbered(count(good.counts.parts, 'part'))}</span>}
      {makesFab && (
        <button ref={fabButton} type="button" className="status-fab" aria-haspopup="dialog" aria-expanded={fabOpen} onClick={() => (fabOpen ? actions.closeFab() : actions.openFab())}>
          {fab?.running ? numbered(`Fab files: ${fab.step}`) : 'Fab files…'}
        </button>
      )}
      {makesFab && fabOpen && <FabPopover project={project} anchor={fabButton.current} />}
      {/* There before anything is said, so that what is said later is announced. */}
      <span className="status-notice" role="status" title={notice ?? undefined}>
        {notice}
      </span>
      <span className="status-session" data-status={session?.status}>
        {sessionWord(session?.status)}
      </span>
      {good?.kicad_cli && <span className="status-kicad num">kicad {good.kicad_cli}</span>}
    </footer>
  )
}
