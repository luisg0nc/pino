import type { ProjectInfo } from '../../shared/project'
import { useStore } from '../state/store'
import { useViewModel } from '../state/viewModel'
import { BlocksBlock } from './route/BlocksBlock'
import { BoardBlock } from './route/BoardBlock'
import { ChecksBlock } from './route/ChecksBlock'
import { Head } from './route/Head'
import { InHand } from './route/InHand'
import { NetBlock } from './route/NetBlock'
import { RoutingBlock } from './route/RoutingBlock'
import { Section } from './route/Section'

/**
 * The route card at the left of an open project: the project read top to bottom. Its head says the newest build; under
 * it what is in hand, how far the routing is, every check, the board in numbers and, over the sheet, its blocks and the
 * net in hand; and last the brief, which Claude keeps in `brief.md`. The Brief page and the fab limits come with later
 * stages.
 */
export function RouteCard({ project }: { project: ProjectInfo }) {
  const build = useStore((s) => s.build)
  const selection = useStore((s) => s.selection)
  const tab = useStore((s) => s.tab)
  const { model } = useViewModel()
  const target = selection?.target
  const net =
    target?.kind === 'net'
      ? target.name
      : target?.kind === 'pad'
        ? (model?.circuit?.nets.find((n) => n.pins.some(([ref, pin]) => ref === target.ref && pin === target.number))?.name ?? null)
        : null
  // What the checks say is of the newest build, which a failed one is; the board in numbers is of the one drawn.
  const result = useStore((s) => (s.shown === null ? (s.build?.latest ?? null) : null)) ?? model?.result ?? null
  return (
    <div className="route-card">
      <Head project={project} build={build} />
      {selection && <InHand selection={selection} />}
      {tab === 'schematic' && model?.circuit && <BlocksBlock circuit={model.circuit} />}
      {tab === 'schematic' && model && net && <NetBlock model={model} net={net} />}
      {model && build && tab !== 'schematic' && <RoutingBlock model={model} build={build} />}
      {result && result.verdict !== 'failed' && <ChecksBlock result={result} />}
      {result?.verdict === 'failed' && (
        <Section title="Checks" count="not run">
          <ul className="route-checks">
            {result.findings.map((f, i) => (
              <li key={i} className="route-failure selectable">
                {f.message}
                {f.at?.file && <span className="route-line">{`${f.at.file}${f.at.line ? ` line ${f.at.line}` : ''}`}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {model && tab !== 'schematic' && <BoardBlock model={model} />}
      <Section title="Brief">
        <p>No brief yet.</p>
        <p className="muted">
          Tell Claude what the board is for. It keeps the brief in <span className="num">brief.md</span>.
        </p>
      </Section>
    </div>
  )
}
