// The marking tools, pure: what a press or a drag on the board makes with the tool in hand. Points come in the board
// file's frame (as the view has them) and leave in pino's board frame (as marks keep them).

import type { Board } from '../../../shared/board/board'
import { mm, toBoard } from '../../../shared/board/coords'
import { dist, simplify, type Pt } from '../../../shared/board/geom'
import type { Hit } from '../../../shared/board/hit'
import { centreOf, crossings, targetOf, type Target } from '../../../shared/board/refs'
import type { KeyId } from '../../../shared/keys'
import { MAX_STROKE_POINTS, pathLength, STROKE_TOLERANCE, type NewMark } from '../../../shared/marks'
import { polygonArea } from '../../../shared/board/outlines'
import type { View } from '../draw'
import { toModel } from '../viewport'

export type MarkTool = 'select' | 'point' | 'arrow' | 'stroke' | 'region'

/** What each tool is called: by what it asks for (the design picks). */
export const TOOL_NAMES: Record<MarkTool, string> = {
  select: 'Select',
  point: 'Point at a part, pad or track',
  arrow: 'Arrow: move this here',
  stroke: 'Stroke: route this way',
  region: 'Region: keep this clear'
}

/** What a mark asks, in a verb, where it has no note. */
export const TOOL_VERBS = { point: 'Point', arrow: 'Move this here', stroke: 'Route this way', region: 'Keep this clear' } as const

export const TOOL_KEYS: Record<MarkTool, KeyId> = { select: 'mark.select', point: 'mark.point', arrow: 'mark.arrow', stroke: 'mark.stroke', region: 'mark.region' }

/** The shortest drag that is a stroke or an arrow, mm, and the smallest area that is a region, mm². */
const SHORTEST = 0.3
const SMALLEST = 0.5

/** Simplified until it fits: the tolerance grows only for a path with more corners than a mark keeps. */
function fitted(points: Pt[], tolerance: number): Pt[] {
  let out = simplify(points, tolerance)
  for (let t = tolerance * 2; out.length > MAX_STROKE_POINTS; t *= 2) out = simplify(points, t)
  return out
}

/** A pointer's path on screen as a short path on the board, in the board file's frame. */
export function strokeOf(screen: Pt[], view: View): Pt[] {
  const model = screen.map((p) => {
    const m = toModel(view, p)
    return { x: Math.round(m.x * 1e4) / 1e4, y: Math.round(m.y * 1e4) / 1e4 }
  })
  return fitted(model, Math.max(STROKE_TOLERANCE, 1.5 / view.scale))
}

const hundredths = (p: Pt): Pt => ({ x: Math.round(p.x * 100) / 100 || 0, y: Math.round(p.y * 100) / 100 || 0 })
const onBoard = (p: Pt): Pt => hundredths(toBoard(p))

export interface Gesture {
  /** What lay under the press. */
  hit?: Hit
  /** The path of the pointer, in the board file's frame. */
  points: Pt[]
  /** The layer looked at, and the board's copper layers. */
  layer: string
  layers: string[]
}

/** The mark a gesture makes with the tool in hand, or null when it makes none. */
export function newMarkFrom(tool: MarkTool, input: Gesture, board: Board): NewMark | null {
  const { hit, points, layer, layers } = input
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || tool === 'select') return null
  if (tool === 'point') {
    if (!hit) return null
    const target = targetOf(hit, first)
    return { kind: 'point', space: 'board', target, at: centreOf(board, target)!, note: '' }
  }
  if (tool === 'arrow') {
    if (dist(first, last) < SHORTEST) return null
    // What is moved is the part, whichever of its pads was pressed.
    const under = hit ? targetOf(hit, first) : null
    const from: Target | null = under?.kind === 'pad' ? { kind: 'part', ref: under.ref } : under?.kind === 'zone' ? null : under
    return { kind: 'arrow', from, fromAt: from ? hundredths(centreOf(board, from)!) : onBoard(first), to: onBoard(last), note: '' }
  }
  if (tool === 'stroke') {
    const path = fitted(points, STROKE_TOLERANCE)
    if (pathLength(path) < SHORTEST) return null
    return { kind: 'stroke', layer, points: path.map(onBoard), crosses: { nets: [], parts: [] }, note: '' }
  }
  // A region closes on its first point: a last point back on it is not a corner.
  const outline = fitted(points, STROKE_TOLERANCE * 2)
  if (outline.length > 3 && dist(outline[0], outline[outline.length - 1]) < SHORTEST) outline.pop()
  if (outline.length < 3 || polygonArea(outline) < SMALLEST) return null
  return { kind: 'region', layers: [...layers], intent: 'keep-clear', holds: [], points: outline.map(onBoard), note: '' }
}

/** What a stroke being drawn crosses, said by the pen. `points` in the board file's frame. */
export function liveReadout(points: Pt[], board: Board, layer: string): string {
  const { nets } = crossings(board, points, layer)
  return `${mm(pathLength(points))} mm · crosses ${nets.length ? nets.join(', ') : 'nothing'}`
}
