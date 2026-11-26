import { hint } from '../../../shared/keys'
import type { ViewName } from '../../../shared/view'
import { ViewCube } from './ViewCube'

/**
 * The compass at the top right of the 3D tab: the cube for the standard views, Perspective and Ortho, and Fit. The
 * view's tags and the band keep clear of it (`data-tag-avoid`).
 */
export function Compass({ on, go, ortho, setOrtho, fit }: { on: ViewName | null; go: (view: ViewName) => void; ortho: boolean; setOrtho: (ortho: boolean) => void; fit: () => void }) {
  return (
    <div className="compass" role="toolbar" aria-label="View" data-tag-avoid="">
      <div className="cube">
        <ViewCube on={on} go={go} />
      </div>
      <div className="pill pill-seg" role="group" aria-label="Projection">
        <button type="button" className="seg" aria-pressed={!ortho} onClick={() => setOrtho(false)}>
          Perspective
        </button>
        <button type="button" className="seg" aria-pressed={ortho} onClick={() => setOrtho(true)}>
          Ortho
        </button>
      </div>
      <div className="compass-row">
        <button type="button" className="pill" title={`Fit the board in view (${hint('board.fit')})`} onClick={fit}>
          Fit <kbd className="num" aria-hidden="true">{hint('board.fit')}</kbd>
        </button>
      </div>
    </div>
  )
}
