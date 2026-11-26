import type { Circuit } from '../../../shared/circuit'
import { actions, useStore } from '../../state/store'
import { Section } from './Section'

/** The sheet's blocks, as the board file names them. Pointing at one washes its frame on the sheet. */
export function BlocksBlock({ circuit }: { circuit: Circuit }) {
  const hot = useStore((s) => s.hotBlock)
  const held = useStore((s) => (s.selection?.target.kind === 'part' || s.selection?.target.kind === 'pad' ? s.selection.target.ref : null))
  const own = circuit.parts.find((p) => p.ref === held)?.block
  return (
    <Section title="Blocks" count={String(circuit.blocks.length)} lit>
      <ul className="route-checks">
        {circuit.blocks.map((block) => (
          <li key={block.key}>
            <button
              type="button"
              className="route-check"
              data-hot={(hot ?? own) === block.key || undefined}
              onPointerEnter={() => actions.hoverBlock(block.key)}
              onPointerLeave={() => actions.hoverBlock(null)}
              onFocus={() => actions.hoverBlock(block.key)}
              onBlur={() => actions.hoverBlock(null)}
            >
              <span className="route-grow">{block.title}</span>
              <span className="num route-times">{`${block.parts.length} part${block.parts.length === 1 ? '' : 's'}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}
