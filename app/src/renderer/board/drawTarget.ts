// One thing picked out on the board in one colour: the selection in the accent, a mark in its maker's colour. Drawn on
// the canvas over the board, so that the board is not drawn again. Every line is cased in the paper, so that it reads
// over copper of any tone.

import type { Board, Pad } from '../../shared/board/board'
import type { Pt } from '../../shared/board/geom'
import { padPolygons } from '../../shared/board/outlines'
import { findTarget, type Target } from '../../shared/board/refs'
import { addTrack, type View } from './draw'
import { mix } from './style'

export interface Ink {
  colour: string
  paper: string
  /** A stale mark: drawn in 40 % of its colour with a dashed edge. */
  faint?: boolean
}

const polygon = (pts: Pt[], grow = 0): Path2D => {
  const path = new Path2D()
  const middle = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, y: s.y + p.y / pts.length }), { x: 0, y: 0 })
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - middle.x, p.y - middle.y) || 1
    const q = { x: p.x + ((p.x - middle.x) / d) * grow, y: p.y + ((p.y - middle.y) / d) * grow }
    if (i) path.lineTo(q.x, q.y)
    else path.moveTo(q.x, q.y)
  })
  path.closePath()
  return path
}

/** A line cased in the paper: `px` is one screen pixel in board mm. */
function cased(ctx: CanvasRenderingContext2D, path: Path2D, ink: Ink, width: number, px: number): void {
  const colour = ink.faint ? mix(ink.colour, ink.paper, 0.4) : ink.colour
  ctx.setLineDash([])
  ctx.strokeStyle = ink.paper
  ctx.lineWidth = width + 2.4 * px
  ctx.stroke(path)
  ctx.setLineDash(ink.faint ? [5 * px, 3 * px] : [])
  ctx.strokeStyle = colour
  ctx.lineWidth = width
  ctx.stroke(path)
  ctx.setLineDash([])
}

function wash(ctx: CanvasRenderingContext2D, path: Path2D, colour: string, alpha: number): void {
  ctx.globalAlpha = alpha
  ctx.fillStyle = colour
  ctx.fill(path)
  ctx.globalAlpha = 1
}

function pad(ctx: CanvasRenderingContext2D, p: Pad, ink: Ink, px: number): void {
  for (const pts of padPolygons(p)) {
    const path = polygon(pts, 2 * px)
    wash(ctx, path, ink.colour, ink.faint ? 0.15 : 0.3)
    cased(ctx, path, ink, 2 * px, px)
  }
}

/** Sets the canvas to the board's own millimetres. */
export function toBoardSpace(ctx: CanvasRenderingContext2D, view: View, dpr: number): number {
  ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.tx * dpr, view.ty * dpr)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  return 1 / view.scale
}

/** Draws the thing the target names; `ctx` must be in board mm (`toBoardSpace`), `px` one screen pixel. */
export function drawTarget(ctx: CanvasRenderingContext2D, board: Board, target: Target, ink: Ink, px: number): void {
  if (target.kind === 'net') {
    for (const track of board.tracks) {
      if (track.net !== target.name) continue
      const path = new Path2D()
      addTrack(path, track)
      cased(ctx, path, ink, Math.max(track.w, 2 * px), px)
    }
    for (const footprint of board.footprints) for (const p of footprint.pads) if (p.net === target.name && p.copper.length) pad(ctx, p, ink, px)
    return
  }
  const item = findTarget(board, target)
  if (!item) return
  if (item.type === 'footprint') {
    if (!item.outline.length) return
    const path = polygon(item.outline)
    wash(ctx, path, ink.colour, ink.faint ? 0.05 : 0.1)
    cased(ctx, path, ink, 1.8 * px, px)
  } else if (item.type === 'pad') pad(ctx, item, ink, px)
  else if (item.type === 'track') {
    // A track is cased: its own width in the colour with a paper edge, wider than the copper so it is seen round it.
    const path = new Path2D()
    addTrack(path, item)
    cased(ctx, path, ink, item.w + 3 * px, px)
  } else if (item.type === 'via') {
    const path = new Path2D()
    path.arc(item.pos.x, item.pos.y, item.size / 2 + 2.5 * px, 0, 2 * Math.PI)
    cased(ctx, path, ink, 2 * px, px)
  } else {
    for (const fill of item.fills) {
      const path = polygon(fill.pts)
      wash(ctx, path, ink.colour, ink.faint ? 0.06 : 0.12)
      cased(ctx, path, ink, 1.4 * px, px)
    }
  }
}
