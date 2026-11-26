// A pad's copper as polygons in the board file's frame, for what needs its edge: crossings, gaps and areas. Round
// corners are walked closely enough that the edge is within a micrometre of the true one at pad sizes.

import type { Pad } from './board'
import { add, rotate, type Pt } from './geom'

const STEPS = 12 // per quarter turn

/** A rounded rectangle's outline about the origin, clockwise on screen. */
function rounded(w: number, h: number, r: number): Pt[] {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  const corners: Array<[cx: number, cy: number, from: number]> = [
    [w / 2 - radius, -h / 2 + radius, -90],
    [w / 2 - radius, h / 2 - radius, 0],
    [-w / 2 + radius, h / 2 - radius, 90],
    [-w / 2 + radius, -h / 2 + radius, 180]
  ]
  return corners.flatMap(([cx, cy, from]) =>
    Array.from({ length: radius ? STEPS + 1 : 1 }, (_, i) => {
      const a = ((from + (90 * i) / STEPS) * Math.PI) / 180
      return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) }
    })
  )
}

function local(pad: Pad): Pt[] {
  const { w, h } = pad
  const shape = pad.shape === 'custom' ? pad.anchor : pad.shape
  if (shape === 'circle') return rounded(w, w, w / 2)
  if (shape === 'oval') return rounded(w, h, Math.min(w, h) / 2)
  if (shape === 'roundrect') {
    if (!pad.chamferCorners.length) return rounded(w, h, pad.rratio * Math.min(w, h))
    const c = pad.chamfer * Math.min(w, h)
    const corner = (name: string, x: number, y: number, before: Pt, after: Pt): Pt[] =>
      pad.chamferCorners.includes(name) && c > 0 ? [before, after] : [{ x, y }]
    const [x, y] = [w / 2, h / 2]
    return [
      ...corner('top_left', -x, -y, { x: -x, y: -y + c }, { x: -x + c, y: -y }),
      ...corner('top_right', x, -y, { x: x - c, y: -y }, { x, y: -y + c }),
      ...corner('bottom_right', x, y, { x, y: y - c }, { x: x - c, y }),
      ...corner('bottom_left', -x, y, { x: -x + c, y }, { x: -x, y: y - c })
    ]
  }
  if (shape === 'trapezoid') {
    const dx = pad.delta.y / 2
    const dy = pad.delta.x / 2
    return [
      { x: -w / 2 - dx, y: h / 2 + dy },
      { x: -w / 2 + dx, y: -h / 2 - dy },
      { x: w / 2 - dx, y: -h / 2 + dy },
      { x: w / 2 + dx, y: h / 2 - dy }
    ]
  }
  return rounded(w, h, 0)
}

/** The pad's anchor shape, and a custom pad's filled primitives. */
export function padPolygons(pad: Pad): Pt[][] {
  const anchor = local(pad).map((p) => add(pad.center, rotate(p, pad.angle)))
  return [anchor, ...pad.prims.flatMap((s) => (s.k === 'poly' && s.fill ? [s.pts] : []))]
}

/** A polygon's area, by the shoelace rule. KiCad's filled polygons express holes as slits, which this handles. */
export function polygonArea(pts: Pt[]): number {
  let twice = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) twice += pts[j].x * pts[i].y - pts[i].x * pts[j].y
  return Math.abs(twice) / 2
}
