// The board sorted into what is drawn in one go: batches by layer, net, kind and width, with no DOM, so that a frame
// is a transform and a few hundred fills and strokes (draw.ts). From the board-view spike's batching.

import type { Board, Pad, Shape, Track, Zone } from '../../shared/board/board'
import { shapePoints } from '../../shared/board/board'
import { dist, type Pt } from '../../shared/board/geom'
import { naturalCompare } from '../../shared/board/nets'

export type Prim =
  | { p: 'pad'; pad: Pad }
  | { p: 'track'; track: Track }
  | { p: 'circle'; c: Pt; r: number }
  | { p: 'poly'; pts: Pt[] }
  | { p: 'shape'; shape: Shape }
  | { p: 'hole'; pad: Pad }

export interface Batch {
  layer: string
  net: string
  kind: 'pad' | 'track' | 'via' | 'zone' | 'silk' | 'edge' | 'hole'
  /** The stroke's width in mm, or 0 for what is filled. */
  width: number
  /** A pad that goes through the board: drawn once, over the layers. */
  through: boolean
  /** Copper of a route that no longer fits the board. */
  stale: boolean
  items: Prim[]
}

/**
 * The board's batches. `stale` names the tracks, vias and zones (by uuid) of a route that no longer fits: they are
 * batched apart, to be drawn faded.
 */
export function bakeBatches(board: Board, stale: ReadonlySet<string> = new Set()): Batch[] {
  const batches = new Map<string, Batch>()
  const add = (item: Prim, at: Pick<Batch, 'layer' | 'kind'> & Partial<Batch>) => {
    const batch = { net: '', width: 0, through: false, stale: false, ...at }
    const key = `${batch.layer}|${batch.net}|${batch.kind}|${batch.width}|${batch.through}|${batch.stale}`
    const held = batches.get(key)
    if (held) held.items.push(item)
    else batches.set(key, { ...batch, items: [item] })
  }

  for (const zone of board.zones) {
    if (zone.keepout) continue
    // A teardrop is copper like the track it eases into its pad, not a pour to hatch.
    const kind = zone.teardrop ? 'track' : 'zone'
    for (const fill of zone.fills) add({ p: 'poly', pts: fill.pts }, { layer: fill.layer, net: zone.net, kind, stale: stale.has(zone.uuid) })
  }
  for (const track of board.tracks) {
    add({ p: 'track', track }, { layer: track.layer, net: track.net, kind: 'track', width: track.w, stale: stale.has(track.uuid) })
  }
  for (const footprint of board.footprints) {
    for (const pad of footprint.pads) {
      if (pad.drill) add({ p: 'hole', pad }, { layer: 'Edge.Cuts', kind: 'hole', through: pad.kind !== 'np_thru_hole' })
      if (pad.kind === 'np_thru_hole' || !pad.copper.length) continue
      const through = pad.copper.length > 1
      add({ p: 'pad', pad }, { layer: pad.copper[0], net: pad.net, kind: 'pad', through })
      for (const shape of pad.prims) {
        if (shape.w > 0) add({ p: 'shape', shape }, { layer: pad.copper[0], net: pad.net, kind: 'track', width: shape.w })
      }
    }
  }
  for (const via of board.vias) {
    const at = { layer: via.span[0] ?? 'F.Cu', net: via.net, stale: stale.has(via.uuid) }
    add({ p: 'circle', c: via.pos, r: via.size / 2 }, { ...at, kind: 'via' })
    add({ p: 'circle', c: via.pos, r: via.drill / 2 }, { layer: 'Edge.Cuts', kind: 'hole', width: via.size, stale: stale.has(via.uuid) })
  }
  for (const { layer, shape } of [...board.graphics, ...board.footprints.flatMap((f) => f.graphics)]) {
    const filled = (shape.k === 'poly' || shape.k === 'circle') && shape.fill
    if (layer.endsWith('.SilkS')) {
      if (filled) add({ p: 'shape', shape }, { layer, kind: 'silk' })
      if (shape.w > 0) add({ p: 'shape', shape }, { layer, kind: 'silk', width: shape.w })
    } else if (layer === 'Edge.Cuts') {
      add({ p: 'shape', shape }, { layer, kind: 'edge', width: shape.w || 0.1 })
    }
  }
  return [...batches.values()]
}

/** The edge cuts chained into closed loops: the outline, and any slot cut inside it. */
export function edgeLoops(board: Board): Pt[][] {
  const runs: Pt[][] = []
  const loops: Pt[][] = []
  for (const { layer, shape } of [...board.graphics, ...board.footprints.flatMap((f) => f.graphics)]) {
    if (layer !== 'Edge.Cuts') continue
    if (shape.k === 'poly') loops.push(shape.pts)
    else if (shape.k === 'circle') {
      loops.push(Array.from({ length: 64 }, (_, i) => ({ x: shape.c.x + shape.r * Math.cos((i * Math.PI) / 32), y: shape.c.y + shape.r * Math.sin((i * Math.PI) / 32) })))
    } else runs.push(shapePoints(shape))
  }
  while (runs.length) {
    const loop = [...runs.shift()!]
    while (runs.length) {
      const end = loop[loop.length - 1]
      if (dist(end, loop[0]) < 0.005) break
      let best = { i: 0, d: Infinity, reversed: false }
      runs.forEach((run, i) => {
        const head = dist(run[0], end)
        const tail = dist(run[run.length - 1], end)
        if (head < best.d) best = { i, d: head, reversed: false }
        if (tail < best.d) best = { i, d: tail, reversed: true }
      })
      const [run] = runs.splice(best.i, 1)
      loop.push(...(best.reversed ? [...run].reverse() : run).slice(best.d < 0.005 ? 1 : 0))
    }
    if (loop.length > 2 && dist(loop[0], loop[loop.length - 1]) < 0.005) loop.pop()
    loops.push(loop)
  }
  return loops
}

/** The order a route's copper arrives in: net by net, those whose first pad is nearest the board's middle first. */
export function revealOrder(board: Board): string[] {
  const middle = { x: (board.box.x0 + board.box.x1) / 2, y: (board.box.y0 + board.box.y1) / 2 }
  const pads = board.footprints.flatMap((f) => f.pads)
  const from = (net: string) => Math.min(...pads.filter((p) => p.net === net).map((p) => dist(p.center, middle)), Infinity)
  const routed = [...new Set(board.tracks.map((t) => t.net))].filter(Boolean)
  return routed.sort((a, b) => from(a) - from(b) || naturalCompare(a, b))
}

/** The tracks in the order they arrive, each net's from its pads outwards. */
export function arrivalTracks(board: Board): Track[] {
  return revealOrder(board).flatMap((net) => {
    const pads = board.footprints.flatMap((f) => f.pads).filter((p) => p.net === net)
    const near = (t: Track) => Math.min(...pads.map((p) => Math.min(dist(t.a, p.center), dist(t.b, p.center))), Infinity)
    return board.tracks.filter((t) => t.net === net).sort((a, b) => near(a) - near(b))
  })
}

export const isPour = (zone: Zone): boolean => !zone.keepout && !zone.teardrop
