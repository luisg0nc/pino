import type { Pt } from '../../../shared/board/geom'
import type { Mark } from '../../../shared/marks'
import { chipOf, MarkChip } from '../../ui/MarkChip'
import { chipBoxes } from './chips'

/** Each mark's chip on its point. `place` puts the mark's point in the view's pixels, or says it has none here. */
export function ChipLayer({ marks, place }: { marks: readonly Mark[]; place: (mark: Mark) => Pt | null }) {
  return (
    <div className="mark-chips">
      {chipBoxes(marks, place).map(({ mark, x, y }) => (
        <MarkChip key={mark.id} chip={chipOf(mark)} style={{ transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` }} />
      ))}
    </div>
  )
}
