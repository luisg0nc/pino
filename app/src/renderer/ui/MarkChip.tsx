import type { Mark } from '../../shared/marks'
import { actions, useStore } from '../state/store'

export interface Chip {
  id: string
  label: string
  author: 'user' | 'agent'
  /** It has gone with a prompt: drawn as an outline. */
  hollow?: boolean
  stale?: boolean
  /** The exact line Claude gets. */
  title: string
}

export const chipOf = (mark: Mark, hollow = false): Chip => ({ id: mark.id, label: mark.label, author: mark.author, hollow, stale: mark.anchor === 'stale', title: mark.payload })

/** A mark's chip: pointing at it lights the mark in the view, a press takes it in hand. */
export function MarkChip({ chip, style }: { chip: Chip; style?: React.CSSProperties }) {
  const lit = useStore((s) => s.hotMark === chip.id || s.heldMark === chip.id)
  return (
    <button
      type="button"
      className="mark-chip"
      data-mark={chip.id}
      data-author={chip.author}
      data-hollow={chip.hollow || undefined}
      data-stale={chip.stale || undefined}
      data-lit={lit || undefined}
      title={chip.title}
      aria-label={`${chip.author === 'agent' ? "Claude's mark" : 'Mark'} ${chip.id}: ${chip.title}`}
      style={style}
      onPointerEnter={() => actions.hoverMark(chip.id)}
      onPointerLeave={() => actions.hoverMark(null)}
      onClick={() => actions.holdMark(chip.id)}
    >
      {chip.label}
    </button>
  )
}
