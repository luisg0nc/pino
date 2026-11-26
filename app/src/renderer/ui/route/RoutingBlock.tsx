import type { BuildState } from '../../../shared/build'
import { cellsRouted, netGauge, openNets } from '../../../shared/checks'
import type { ViewModel } from '../../state/viewModel'
import { numbered } from '../numbered'
import { Row, Section } from './Section'

const MOST_OPEN = 8

/** How far the routing is: a cell for each net, the router and its time, whose copper is on the board, the open nets. */
export function RoutingBlock({ model, build }: { model: ViewModel; build: BuildState }) {
  const { result } = model
  const routing = result.routing ?? null
  const open = model.open ? openNets(result, null, [...model.open].map((net) => ({ source: 'route', code: 'net_unrouted', severity: 'info' as const, message: '', nets: [net] }))) : openNets(result, model.placement, null)
  const gauge = netGauge(model.circuit, open, routing)
  const routed = routing?.state === 'current'
  const stale = routing?.state === 'stale'
  const running = build.route
  const through = running ? cellsRouted(running, gauge.total) : 0
  const count = running ? (running.of ? `${running.index} of ${running.of} nets` : 'routing') : stale ? 'stale' : routed ? `${gauge.done} of ${gauge.total} nets` : `0 of ${gauge.total} nets`
  const madeOn = build.history.find((e) => e.hash !== null && e.hash === model.routedBuild)?.number
  const copperFrom = routed ? `h${result.number}` : madeOn !== undefined ? `h${madeOn}` : routing?.number !== null && routing ? `r${routing.number}` : ''
  return (
    <Section title="Routing" count={count} lit={routed || running !== null}>
      <div className="route-gauge" role="img" aria-label={`${gauge.done} of ${gauge.total} nets routed`}>
        {Array.from({ length: gauge.total }, (_, i) => (
          <i key={i} data-cell={running ? (i < through ? 'done' : 'open') : gauge.state === 'stale' ? (i < gauge.done ? 'stale' : 'open') : i < gauge.done ? 'done' : 'open'} />
        ))}
      </div>
      {!running && (routed || stale) && (
        <>
          <Row name="KiCadRoutingTools" value={routing!.router_seconds !== null ? numbered(`${routing!.router_seconds} s`) : ''} />
          <Row name={routed ? 'Copper is from this build' : 'Copper is from an older build'} value={<span className="num">{copperFrom}</span>} tone={stale ? 'warn' : undefined} />
          {stale && routing!.stale_because.length > 0 && <p className="route-note">{`Stale because ${routing!.stale_because.join(', ')}.`}</p>}
        </>
      )}
      {running && <p className="route-note">{numbered(running.net ? `In the background, at ${running.net}.` : `In the background: ${running.step}.`)}</p>}
      {!routed && !stale && !running && <p className="route-note">{numbered(result.counts.unrouted ? `Not routed: ${result.counts.unrouted} connections to make.` : 'Not routed.')}</p>}
      {!running && open.length > 0 && (routed || stale) && (
        <p className="route-line">
          Open: {open.slice(0, MOST_OPEN).join(' · ')}
          {open.length > MOST_OPEN && ` and ${open.length - MOST_OPEN} more`}
        </p>
      )}
    </Section>
  )
}
