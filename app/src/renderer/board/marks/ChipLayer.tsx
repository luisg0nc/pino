import type { Pt } from '../../../shared/board/geom'
import type { Mark } from '../../../shared/marks'
import { chipOf, MarkChip } from '../../ui/MarkChip'
import { stackChips } from './chips'

const HEIGHT = 17
/** A chip is as wide as its label in the number face, near enough to keep chips off one another. */
const widthOf = (label: string) => 10 + label.length * 7

/** Each mark's chip on its point. `place` puts the mark's point in the view's pixels, or says it has none here. */
export function ChipLayer({ marks, place }: { marks: readonly Mark[]; place: (mark: Mark) => Pt | null }) {
  const boxes = marks.flatMap((mark) => {
    const at = place(mark)
    return at ? [{ mark, x: at.x + 4, y: at.y - HEIGHT, w: widthOf(mark.label), h: HEIGHT }] : []
  })
  return (
    <div className="mark-chips">
      {stackChips(boxes).map(({ mark, x, y }) => (
        <MarkChip key={mark.id} chip={chipOf(mark)} style={{ transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)` }} />
      ))}
    </div>
  )
}
