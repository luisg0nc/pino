// Marks drawn over the board (the design mocks' "pencil"): in the person's violet or Claude's orange, each cased in
// the paper so that it reads over copper of any tone. `ctx` is in board millimetres (drawTarget.toBoardSpace).

import type { Board } from '../../../shared/board/board'
import { toKicad } from '../../../shared/board/coords'
import type { Pt } from '../../../shared/board/geom'
import { findTarget } from '../../../shared/board/refs'
import type { Mark } from '../../../shared/marks'
import { drawTarget } from '../drawTarget'
import { mix, type BoardColours } from '../style'

export const markColour = (author: 'user' | 'agent', c: BoardColours): string => (author === 'agent' ? c.agentMark : c.userMark)

interface Pen {
  colour: string
  paper: string
  /** A stale mark: 40 % of its colour, dashed. */
  faint: boolean
}

const tone = (pen: Pen) => (pen.faint ? mix(pen.colour, pen.paper, 0.4) : pen.colour)

function polyline(points: Pt[], closed = false): Path2D {
  const path = new Path2D()
  points.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)))
  if (closed) path.closePath()
  return path
}

/** A line drawn by hand: a curve through the points (Catmull-Rom). */
function handDrawn(points: Pt[]): Path2D {
  const path = new Path2D()
  path.moveTo(points[0].x, points[0].y)
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[i - 1] ?? points[i], points[i], points[i + 1], points[i + 2] ?? points[i + 1]]
    path.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y)
  }
  return path
}

function line(ctx: CanvasRenderingContext2D, path: Path2D, pen: Pen, width: number, px: number, dash: number[] = []): void {
  ctx.setLineDash([])
  ctx.strokeStyle = pen.paper
  ctx.lineWidth = width + 2.4 * px
  ctx.stroke(path)
  ctx.setLineDash((pen.faint && !dash.length ? [5, 3] : dash).map((d) => d * px))
  ctx.strokeStyle = tone(pen)
  ctx.lineWidth = width
  ctx.stroke(path)
  ctx.setLineDash([])
}

function dot(ctx: CanvasRenderingContext2D, at: Pt, r: number, pen: Pen): void {
  ctx.beginPath()
  ctx.arc(at.x, at.y, r, 0, 2 * Math.PI)
  ctx.fillStyle = tone(pen)
  ctx.fill()
}

/** A soft pen line, as a stroke mark and a stroke being drawn are. */
export function drawPen(ctx: CanvasRenderingContext2D, points: Pt[], pen: Pen, px: number): void {
  if (points.length < 2) return
  const path = handDrawn(points)
  ctx.globalAlpha = 0.22
  ctx.strokeStyle = pen.colour
  ctx.lineWidth = 11 * px
  ctx.stroke(path)
  ctx.globalAlpha = 1
  line(ctx, path, pen, 3 * px, px)
}

/** "Move this here": from the item to where it should go, and where its outline would land. */
export function drawArrow(ctx: CanvasRenderingContext2D, from: Pt, to: Pt, ghost: Pt[] | null, pen: Pen, px: number): void {
  const a = Math.atan2(to.y - from.y, to.x - from.x)
  line(ctx, polyline([from, to]), pen, 2.2 * px, px)
  dot(ctx, from, 3.2 * px, pen)
  const head = 10 * px
  ctx.fillStyle = tone(pen)
  ctx.fill(polyline([to, { x: to.x - head * Math.cos(a - 0.42), y: to.y - head * Math.sin(a - 0.42) }, { x: to.x - head * Math.cos(a + 0.42), y: to.y - head * Math.sin(a + 0.42) }], true))
  if (ghost) {
    const moved = ghost.map((p) => ({ x: p.x + to.x - from.x, y: p.y + to.y - from.y }))
    line(ctx, polyline(moved, true), pen, 1.3 * px, px, [3, 3])
  }
}

export function drawRegion(ctx: CanvasRenderingContext2D, points: Pt[], pen: Pen, px: number): void {
  const path = polyline(points, true)
  ctx.globalAlpha = pen.faint ? 0.05 : 0.12
  ctx.fillStyle = pen.colour
  ctx.fill(path)
  ctx.globalAlpha = 1
  line(ctx, path, pen, 1.6 * px, px, [6, 4])
}

/** The outline a part would be moved with. */
export function outlineOfPart(board: Board, ref: string): Pt[] | null {
  const part = findTarget(board, { kind: 'part', ref })
  return part?.type === 'footprint' && part.outline.length ? part.outline : null
}

export function drawMark(ctx: CanvasRenderingContext2D, board: Board, mark: Mark, colours: BoardColours, px: number): void {
  const pen: Pen = { colour: markColour(mark.author, colours), paper: colours.paper, faint: mark.anchor === 'stale' }
  if (mark.kind === 'point') {
    if (pen.faint && mark.was) {
      const at = toKicad(mark.was.at)
      const ring = new Path2D()
      ring.arc(at.x, at.y, 9 * px, 0, 2 * Math.PI)
      line(ctx, ring, pen, 1.8 * px, px, [4, 3])
    } else drawTarget(ctx, board, mark.target, { colour: pen.colour, paper: pen.paper }, px)
  } else if (mark.kind === 'arrow') {
    const ghost = mark.author === 'user' && mark.from?.kind === 'part' && !pen.faint ? outlineOfPart(board, mark.from.ref) : null
    drawArrow(ctx, toKicad(mark.fromAt), toKicad(mark.to), ghost, pen, px)
  } else if (mark.kind === 'stroke') drawPen(ctx, mark.points.map(toKicad), pen, px)
  else drawRegion(ctx, mark.points.map(toKicad), pen, px)
}
