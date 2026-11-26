// Numbers from the board file, never from pixels: gaps, distances, a net's length, widths, copper area and vias, and
// how near the edge a thing comes.

import type { Board, Footprint, Pad, Track, Zone } from './board'
import { mm } from './coords'
import { arcPoints, dist, inPoly, segmentDistance, type Pt } from './geom'
import { netLength, trackLength } from './nets'
import { padPolygons, polygonArea } from './outlines'
import { centreOf, findTarget, hasTarget, layerWords, shortLabel, type Target } from './refs'

export type Measure =
  | { what: 'gap'; a: Target; b: Target }
  | { what: 'distance'; a: Target; b: Target }
  | { what: 'length'; net: string }
  | { what: 'width'; net: string }
  | { what: 'area'; net: string; layer?: string }
  | { what: 'vias'; net?: string }
  | { what: 'edge'; a: Target }

export interface Measured {
  value: number
  unit: 'mm' | 'mm²' | 'vias'
  said: string
}

/** A run of points with a width: a track's line, a via's dot (one point), or a filled outline (width 0, closed). */
interface Solid {
  pts: Pt[]
  r: number
  filled: boolean
}

const line = (t: Track): Solid => ({ pts: t.arc ? arcPoints(t.arc, 0.001) : [t.a, t.b], r: t.w / 2, filled: false })
const closed = (pts: Pt[]): Solid => ({ pts, r: 0, filled: true })

function edges(s: Solid): Array<[Pt, Pt]> {
  if (s.pts.length === 1) return [[s.pts[0], s.pts[0]]]
  const out = s.pts.slice(1).map((p, i): [Pt, Pt] => [s.pts[i], p])
  if (s.filled) out.push([s.pts[s.pts.length - 1], s.pts[0]])
  return out
}

function apart(a: Solid, b: Solid): number {
  if ((a.filled && b.pts.some((p) => inPoly(p, a.pts))) || (b.filled && a.pts.some((p) => inPoly(p, b.pts)))) return 0
  let least = Infinity
  for (const [p, q] of edges(a)) for (const [r, s] of edges(b)) least = Math.min(least, segmentDistance(p, q, r, s))
  return Math.max(0, least - a.r - b.r)
}

const nearest = (as: Solid[], bs: Solid[]): number => Math.min(Infinity, ...as.flatMap((a) => bs.map((b) => apart(a, b))))

type Copper = Map<string, Solid[]>

const padSolids = (p: Pad): Solid[] => padPolygons(p).map(closed)

/** A target's copper, by layer. */
function copperOf(board: Board, t: Target): Copper {
  const out: Copper = new Map()
  const put = (layers: string[], solids: Solid[]) => {
    for (const l of layers) out.set(l, [...(out.get(l) ?? []), ...solids])
  }
  const pad = (p: Pad) => p.kind !== 'np_thru_hole' && put(p.copper, padSolids(p))
  if (t.kind === 'net') {
    for (const f of board.footprints) for (const p of f.pads) if (p.net === t.name) pad(p)
    for (const x of board.tracks) if (x.net === t.name) put([x.layer], [line(x)])
    for (const v of board.vias) if (v.net === t.name) put(v.span, [{ pts: [v.pos], r: v.size / 2, filled: false }])
    for (const z of board.zones) if (z.net === t.name) for (const f of z.fills) put([f.layer], [closed(f.pts)])
    return out
  }
  const item = findTarget(board, t)!
  if (item.type === 'footprint') item.pads.forEach(pad)
  else if (item.type === 'pad') pad(item)
  else if (item.type === 'track') put([item.layer], [line(item)])
  else if (item.type === 'via') put(item.span, [{ pts: [item.pos], r: item.size / 2, filled: false }])
  else for (const f of (item as Zone).fills) put([f.layer], [closed(f.pts)])
  return out
}

/** A target's outline: a part's courtyard, else its copper on any layer. */
function outlineOf(board: Board, t: Target): Solid[] {
  const item = findTarget(board, t)
  if (item?.type === 'footprint' && item.outline.length) return [closed((item as Footprint).outline)]
  return [...copperOf(board, t).values()].flat()
}

function need(board: Board, t: Target): void {
  if (hasTarget(board, t)) return
  throw new Error(t.kind === 'net' ? `there is no net ${t.name}` : `${shortLabel(board, t)} is not on this board`)
}

const needNet = (board: Board, net: string) => need(board, { kind: 'net', name: net })

export function measure(board: Board, m: Measure): Measured {
  switch (m.what) {
    case 'gap': {
      need(board, m.a)
      need(board, m.b)
      const names = `gap ${shortLabel(board, m.a)} to ${shortLabel(board, m.b)}`
      const [a, b] = [copperOf(board, m.a), copperOf(board, m.b)]
      const shared = [...a.keys()].filter((l) => b.has(l))
      if (shared.length) {
        const value = Math.min(...shared.map((l) => nearest(a.get(l)!, b.get(l)!)))
        return { value, unit: 'mm', said: `${names}: ${mm(value)} mm, ${value < 0.0005 ? 'they touch' : 'copper edge to copper edge'}` }
      }
      const value = nearest(outlineOf(board, m.a), outlineOf(board, m.b))
      return { value, unit: 'mm', said: `${names}: ${mm(value)} mm, outline to outline (they share no copper layer)` }
    }
    case 'distance': {
      need(board, m.a)
      need(board, m.b)
      const value = dist(centreOf(board, m.a)!, centreOf(board, m.b)!)
      return { value, unit: 'mm', said: `distance ${shortLabel(board, m.a)} to ${shortLabel(board, m.b)}: ${mm(value)} mm` }
    }
    case 'length': {
      needNet(board, m.net)
      const value = netLength(board, m.net)
      const pieces = board.tracks.filter((t) => t.net === m.net).length
      return { value, unit: 'mm', said: `length of ${m.net}: ${mm(value)} mm of track in ${pieces} piece${pieces === 1 ? '' : 's'}` }
    }
    case 'width': {
      needNet(board, m.net)
      const widths = board.tracks.filter((t) => t.net === m.net).map((t) => t.w)
      if (!widths.length) return { value: 0, unit: 'mm', said: `width of ${m.net}: it has no track yet` }
      const [least, most] = [Math.min(...widths), Math.max(...widths)]
      return { value: least, unit: 'mm', said: `width of ${m.net}: min ${mm(least)}, max ${mm(most)} mm over ${widths.length} segment${widths.length === 1 ? '' : 's'}` }
    }
    case 'area': {
      needNet(board, m.net)
      const on = (layers: string[]) => !m.layer || layers.includes(m.layer)
      const pour = board.zones.filter((z) => z.net === m.net && !z.keepout).flatMap((z) => z.fills).filter((f) => on([f.layer])).reduce((sum, f) => sum + polygonArea(f.pts), 0)
      const tracks = board.tracks.filter((t) => t.net === m.net && on([t.layer])).reduce((sum, t) => sum + trackLength(t) * t.w, 0)
      const pads = board.footprints.flatMap((f) => f.pads).filter((p) => p.net === m.net && on(p.copper)).reduce((sum, p) => sum + padPolygons(p).reduce((s, pts) => s + polygonArea(pts), 0), 0)
      const value = pour + tracks + pads
      const where = m.layer ? ` on ${layerWords(m.layer)}` : ''
      return { value, unit: 'mm²', said: `copper of ${m.net}${where}: ${value.toFixed(1)} mm² (pours ${pour.toFixed(1)}, tracks ${tracks.toFixed(1)}, pads ${pads.toFixed(1)}; where they overlap it is counted twice)` }
    }
    case 'vias': {
      if (m.net) needNet(board, m.net)
      const value = board.vias.filter((v) => !m.net || v.net === m.net).length
      return { value, unit: 'vias', said: `vias on ${m.net ?? 'the board'}: ${value}` }
    }
    case 'edge': {
      need(board, m.a)
      const cuts = [...board.graphics, ...board.footprints.flatMap((f) => f.graphics)].filter((g) => g.layer === 'Edge.Cuts')
      const outline = cuts.map(({ shape: s }): Solid => {
        if (s.k === 'line') return { pts: [s.a, s.b], r: 0, filled: false }
        if (s.k === 'arc') return { pts: arcPoints(s.arc, 0.001), r: 0, filled: false }
        const pts = s.k === 'poly' ? s.pts : Array.from({ length: 97 }, (_, i) => ({ x: s.c.x + s.r * Math.cos((i * Math.PI) / 48), y: s.c.y + s.r * Math.sin((i * Math.PI) / 48) }))
        return { pts: [...pts, pts[0]], r: 0, filled: false }
      })
      if (!outline.length) throw new Error('this board has no outline')
      const value = nearest(outlineOf(board, m.a), outline)
      return { value, unit: 'mm', said: `${shortLabel(board, m.a)} is ${mm(value)} mm from the board edge, at its nearest` }
    }
  }
}
