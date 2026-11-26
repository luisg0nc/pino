// Where a point of the board file is in KiCad's GLB. The export is in metres with y up: the file's x is the GLB's x,
// the file's y (down the page) its z, and the board's top is the highest y of the board mesh. The scale is measured
// off the board itself, so a change of units in an export would be followed.

import type { BBox, Pt } from '../../shared/board/geom'

export interface GlbBox {
  min: [number, number, number]
  max: [number, number, number]
}

export interface GlbFrame {
  /** GLB units to a millimetre. */
  scale: number
  /** The point on top of the board over `p`, a point of the board file. */
  toGlb(p: Pt): [number, number, number]
}

export function glbFrame(boardBox: BBox, glbBox: GlbBox): GlbFrame {
  const scale = (glbBox.max[0] - glbBox.min[0]) / (boardBox.x1 - boardBox.x0)
  const x = (glbBox.min[0] + glbBox.max[0]) / 2 - ((boardBox.x0 + boardBox.x1) / 2) * scale
  const z = (glbBox.min[2] + glbBox.max[2]) / 2 - ((boardBox.y0 + boardBox.y1) / 2) * scale
  return { scale, toGlb: (p) => [x + p.x * scale, glbBox.max[1], z + p.y * scale] }
}
