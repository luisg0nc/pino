// Where the board stands on the screen: screen (CSS px) = scale * model (board file mm) + t. Pure.

import type { BBox, Pt } from '../../shared/board/geom'
import type { View } from './draw'

export const MIN_SCALE = 0.5
/** 400 px to the millimetre: a 0.1 mm gap fills 40 px. */
export const MAX_SCALE = 400
/** A pointer that moves further than this between press and release drags, and selects nothing. */
export const DRAG_SLOP = 4
/** The room the view's furniture takes: the reed at the left, the layer stack at the right, the tabs and the hint. */
export const INSET = { l: 64, r: 256, t: 56, b: 56 }

export interface Inset {
  l: number
  r: number
  t: number
  b: number
}

const clamp = (v: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, v))

export function fit(box: BBox, w: number, h: number, inset: Inset): View {
  const room = { w: w - inset.l - inset.r, h: h - inset.t - inset.b }
  const scale = clamp(Math.min(room.w / Math.max(box.x1 - box.x0, 1e-6), room.h / Math.max(box.y1 - box.y0, 1e-6)))
  return {
    scale,
    tx: inset.l + room.w / 2 - (scale * (box.x0 + box.x1)) / 2,
    ty: inset.t + room.h / 2 - (scale * (box.y0 + box.y1)) / 2
  }
}

export const toScreen = (v: View, p: Pt): Pt => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty })
export const toModel = (v: View, s: Pt): Pt => ({ x: (s.x - v.tx) / v.scale, y: (s.y - v.ty) / v.scale })

/** Zoomed by `factor` with the model point under the cursor held where it is. */
export function zoomAt(v: View, screen: Pt, factor: number): View {
  const scale = clamp(v.scale * factor)
  const held = toModel(v, screen)
  return { scale, tx: screen.x - held.x * scale, ty: screen.y - held.y * scale }
}

/** The scale bar as a drawing has it: a round number of millimetres, 120 px wide at most. */
export function scaleBar(scale: number): { mm: number; px: number } {
  const most = 120 / scale
  const decade = 10 ** Math.floor(Math.log10(most))
  const mm = [5, 2, 1].map((k) => k * decade).find((k) => k <= most * (1 + 1e-9)) ?? decade
  return { mm: Number(mm.toPrecision(1)), px: Math.round(mm * scale) }
}
