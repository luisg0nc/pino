// Where a mark's chip sits: on the mark's own point, with no leader, moved up only to keep it off another chip.

import type { Board } from '../../../shared/board/board'
import { toKicad } from '../../../shared/board/coords'
import type { Pt } from '../../../shared/board/geom'
import { findTarget, hasTarget } from '../../../shared/board/refs'
import type { Mark } from '../../../shared/marks'

/** The top right of a set of points, y down. */
const corner = (points: Pt[]): Pt => ({ x: Math.max(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) })

/** The mark's point, in the board file's frame: null when what it is on is not on the board. */
export function chipAnchor(mark: Mark, board: Board): Pt | null {
  if (mark.anchor === 'stale' && mark.was) return toKicad(mark.was.at)
  if (mark.kind === 'arrow') return toKicad(mark.to)
  if (mark.kind === 'stroke') return toKicad(mark.points[mark.points.length - 1])
  if (mark.kind === 'region') return corner(mark.points.map(toKicad))
  if (!hasTarget(board, mark.target)) return null
  const item = findTarget(board, mark.target)
  if (item?.type === 'footprint') return corner(item.outline.length ? item.outline : [item.pos])
  if (item?.type === 'pad') return item.center
  return toKicad(mark.at)
}

export interface ChipBox {
  x: number
  y: number
  w: number
  h: number
}

const MOST_STEPS = 3
const covers = (a: ChipBox, b: ChipBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** The boxes, each moved up just clear of one placed before it that it would cover, three times at most. */
export function stackChips<T extends ChipBox>(boxes: readonly T[]): T[] {
  const placed: T[] = []
  for (const box of boxes) {
    let at = box
    for (let step = 0; step < MOST_STEPS; step++) {
      const under = placed.find((other) => covers(at, other))
      if (!under) break
      at = { ...at, y: under.y - at.h - 1 }
    }
    placed.push(at)
  }
  return placed
}
