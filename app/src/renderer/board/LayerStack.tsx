import type { Board } from '../../shared/board/board'
import { layerWords } from '../../shared/board/refs'
import type { BoardLook } from '../../shared/view'
import { actions } from '../state/store'

/** A layer seen edge on: copper as the bars a section through it shows, silk as a dashed line. */
function EdgeOn({ kind, on }: { kind: 'copper' | 'silk'; on: boolean }) {
  return (
    <svg className="stack-edge" viewBox="0 0 74 12" width="74" height="12" aria-hidden="true" data-on={on || undefined}>
      {kind === 'silk' ? <path d="M2 6h70" /> : [[2, 14], [18, 8], [30, 20], [54, 6], [64, 8]].map(([x, w]) => <rect key={x} x={x} y="3" width={w} height="6" rx="1" />)}
    </svg>
  )
}

/** The laminate between two copper layers, in section. */
const Core = () => <span className="stack-core" aria-hidden="true" />

const TOGGLES: ReadonlyArray<{ key: 'pours' | 'ratsnest' | 'silk' | 'netColours'; label: string }> = [
  { key: 'pours', label: 'Pours' },
  { key: 'ratsnest', label: 'Ratsnest' },
  { key: 'silk', label: 'Silk' },
  { key: 'netColours', label: 'Net colours' }
]

/**
 * The layer control, drawn as the board's stack seen edge on: from the top silk to the bottom silk, the copper layers
 * chosen by a click or their number, and the four switches of the drawing under them.
 */
export function LayerStack({ board, look }: { board: Board; look: BoardLook }) {
  const ounces = Math.round((board.copperUm / 35) * 10) / 10
  const bottom = look.active === 'B.Cu'
  return (
    <section className="stack" aria-label="Layers" data-tag-avoid="">
      <h3 className="stack-head">
        Layers
        <span className="num">
          {board.thickness} mm, {ounces} oz
        </span>
      </h3>
      <div className="stack-silk">
        <span className="stack-name">top silk</span>
        <EdgeOn kind="silk" on={false} />
      </div>
      {board.copper.map((layer, i) => (
        <div key={layer} className="stack-copper">
          {i > 0 && <Core />}
          <button type="button" className="stack-layer" aria-pressed={look.active === layer} data-layer={layer} onClick={() => actions.setLook({ active: layer })}>
            <span className="stack-name">{layerWords(layer)}</span>
            <EdgeOn kind="copper" on={look.active === layer} />
            <kbd>{i + 1}</kbd>
          </button>
        </div>
      ))}
      <div className="stack-silk">
        <span className="stack-name">bottom silk</span>
        <EdgeOn kind="silk" on={false} />
      </div>
      <p className="stack-seen">{bottom ? 'seen through, from the top' : 'seen from the top'}</p>
      <div className="stack-toggles">
        {TOGGLES.map(({ key, label }) => (
          <button key={key} type="button" className="stack-toggle" aria-pressed={look[key]} onClick={() => actions.setLook({ [key]: !look[key] })}>
            {label}
          </button>
        ))}
      </div>
    </section>
  )
}
