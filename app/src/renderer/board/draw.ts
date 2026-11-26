// The board on a canvas, as a technical drawing (the design mocks' "drafting" direction): the paper, the pours as
// section hatching, copper layer by layer with the one looked at on top, through pads and vias, holes, the silk of the
// side in front, the edge, and the ratsnest over all of it.

import type { Board, Shape, Track } from '../../shared/board/board'
import type { Pt } from '../../shared/board/geom'
import { padPolygons } from '../../shared/board/outlines'
import { arrivalTracks, bakeBatches, edgeLoops, type Batch, type Prim } from './scene'
import { copperColour, mix, type BoardColours } from './style'

/** Screen CSS px = scale * (board file mm) + t. */
export interface View {
  scale: number
  tx: number
  ty: number
}

export interface DrawOpts {
  /** The copper layer looked at. */
  active: string
  /** The copper layers on show. */
  layers: string[]
  pours: boolean
  silk: boolean
  ratsnest: boolean
  netColours: boolean
  /** The copper of a route that no longer fits, which the scene was baked with. */
  stale: { tracks: Set<string> } | null
  /** Nets drawn back, toward the paper. */
  quiet?: (item: string) => boolean
  /** How much of the copper has arrived, 0 to 1, while a route is drawn in. */
  reveal?: number
  dark: boolean
  /** The colour a net takes while net colours are on. */
  netColourOf?: (net: string) => string | null
}

export interface BoardScene {
  board: Board
  batches: Batch[]
  paths: Map<Batch, Path2D>
  outline: Path2D
  arrival: Track[]
}

function addShape(path: Path2D, shape: Shape): void {
  if (shape.k === 'line') {
    path.moveTo(shape.a.x, shape.a.y)
    path.lineTo(shape.b.x, shape.b.y)
  } else if (shape.k === 'arc') {
    path.moveTo(shape.s.x, shape.s.y)
    path.arc(shape.arc.c.x, shape.arc.c.y, shape.arc.r, shape.arc.a0, shape.arc.a0 + shape.arc.sweep, shape.arc.sweep < 0)
  } else if (shape.k === 'circle') {
    path.moveTo(shape.c.x + shape.r, shape.c.y)
    path.arc(shape.c.x, shape.c.y, shape.r, 0, 2 * Math.PI)
  } else addPoly(path, shape.pts)
}

function addPoly(path: Path2D, pts: Pt[]): void {
  pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)))
  path.closePath()
}

/** A track's line, `part` of the way along it. */
export function addTrack(path: Path2D, t: Track, part = 1): void {
  path.moveTo(t.a.x, t.a.y)
  if (t.arc) path.arc(t.arc.c.x, t.arc.c.y, t.arc.r, t.arc.a0, t.arc.a0 + t.arc.sweep * part, t.arc.sweep < 0)
  else path.lineTo(t.a.x + (t.b.x - t.a.x) * part, t.a.y + (t.b.y - t.a.y) * part)
}

function addPrim(path: Path2D, prim: Prim): void {
  if (prim.p === 'pad') for (const pts of padPolygons(prim.pad)) addPoly(path, pts)
  else if (prim.p === 'track') addTrack(path, prim.track)
  else if (prim.p === 'shape') addShape(path, prim.shape)
  else if (prim.p === 'poly') addPoly(path, prim.pts)
  else if (prim.p === 'circle') {
    path.moveTo(prim.c.x + prim.r, prim.c.y)
    path.arc(prim.c.x, prim.c.y, prim.r, 0, 2 * Math.PI)
  } else {
    const { pos, angle, drill } = prim.pad
    const hole = new Path2D()
    hole.roundRect(-drill!.w / 2, -drill!.h / 2, drill!.w, drill!.h, Math.min(drill!.w, drill!.h) / 2)
    path.addPath(hole, new DOMMatrix().translate(pos.x, pos.y).rotate(-angle))
  }
}

/** The board's batches as paths, baked once for a build. */
export function toPaths(board: Board, stale: ReadonlySet<string> = new Set()): BoardScene {
  const batches = bakeBatches(board, stale)
  const paths = new Map<Batch, Path2D>()
  for (const batch of batches) {
    const path = new Path2D()
    for (const item of batch.items) addPrim(path, item)
    paths.set(batch, path)
  }
  const outline = new Path2D()
  for (const loop of edgeLoops(board)) addPoly(outline, loop)
  return { board, batches, paths, outline, arrival: arrivalTracks(board) }
}

const HATCH_GAP = 6 // px on screen, whatever the zoom
const patterns = new Map<string, CanvasPattern>()

/** Section hatching: 1 px lines at 45 degrees, 6 px apart on the screen. */
function hatching(ctx: CanvasRenderingContext2D, colour: string, view: View, dpr: number): CanvasPattern | string {
  const key = `${colour}|${dpr}`
  let pattern = patterns.get(key)
  if (!pattern) {
    const gap = Math.round(HATCH_GAP * dpr)
    const size = gap * 4
    const tile = new OffscreenCanvas(size, size)
    const g = tile.getContext('2d')!
    g.strokeStyle = colour
    g.lineWidth = dpr
    for (let k = -size; k <= 2 * size; k += gap) {
      g.beginPath()
      g.moveTo(k, size)
      g.lineTo(k + size, 0)
      g.stroke()
    }
    const made = ctx.createPattern(tile, 'repeat')
    if (!made) return 'transparent'
    patterns.set(key, (pattern = made))
  }
  pattern.setTransform(new DOMMatrix().scale(1 / (view.scale * dpr)))
  return pattern
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  scene: BoardScene,
  view: View,
  dpr: number,
  opts: DrawOpts,
  colours: BoardColours,
  rats: Array<[Pt, Pt, string]>
): void {
  const px = 1 / view.scale // one CSS px in board mm
  const netColourOf = opts.netColourOf ?? (() => null)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.tx * dpr, view.ty * dpr)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.fillStyle = colours.paper
  ctx.fill(scene.outline, 'evenodd')
  ctx.save()
  ctx.clip(scene.outline, 'evenodd')

  const quiet = (colour: string, net: string) => (opts.quiet?.(net) ? mix(colour, colours.paper, 0.4) : colour)
  const toneOf = (batch: Batch, active: boolean) =>
    quiet(copperColour({ active, throughHole: batch.through, net: batch.net, netColours: opts.netColours, stale: batch.stale }, colours, netColourOf), batch.net)
  const paint = (batch: Batch, colour: string | CanvasPattern, least = 0) => {
    const path = scene.paths.get(batch)!
    if (batch.width > 0) {
      ctx.strokeStyle = colour
      ctx.lineWidth = Math.max(batch.width, least)
      ctx.stroke(path)
    } else {
      ctx.fillStyle = colour
      ctx.fill(path, 'nonzero')
    }
  }
  const revealing = opts.reveal !== undefined && opts.reveal < 1

  // Bottom-most first, the layer looked at last.
  const order = [...scene.board.copper].reverse().filter((l) => opts.layers.includes(l) && l !== opts.active)
  if (opts.layers.includes(opts.active)) order.push(opts.active)
  for (const layer of order) {
    const active = layer === opts.active
    if (opts.pours) {
      for (const batch of scene.batches) {
        if (batch.kind !== 'zone' || batch.layer !== layer) continue
        paint(batch, hatching(ctx, active && !batch.stale ? colours.hatch : colours.hatchFar, view, dpr))
        if (active && !batch.stale) {
          ctx.strokeStyle = quiet(mix(colours.cu, colours.paper, 0.35), batch.net)
          ctx.lineWidth = px
          ctx.stroke(scene.paths.get(batch)!)
        }
      }
    }
    if (revealing) {
      const arrived = opts.reveal! * scene.arrival.length
      scene.arrival.forEach((track, i) => {
        const part = Math.min(1, arrived - i)
        if (track.layer !== layer || part <= 0) return
        const path = new Path2D()
        addTrack(path, track, part)
        ctx.strokeStyle = quiet(copperColour({ active, throughHole: false, net: track.net, netColours: opts.netColours, stale: false }, colours, netColourOf), track.net)
        ctx.lineWidth = Math.max(track.w, 0.8 * px)
        ctx.stroke(path)
      })
    }
    for (const batch of scene.batches) {
      if (batch.layer !== layer || batch.through) continue
      if (batch.kind === 'track' && !(revealing && batch.width > 0)) paint(batch, toneOf(batch, active), 0.8 * px)
    }
    // Pads over the tracks of their layer, and always in ink on it: stale copper fades, pads do not.
    for (const batch of scene.batches) {
      if (batch.layer === layer && !batch.through && batch.kind === 'pad') paint(batch, toneOf(batch, active))
    }
  }
  for (const batch of scene.batches) {
    if (batch.kind === 'pad' && batch.through) paint(batch, toneOf(batch, true))
  }
  // A via is a paper disc with a ring, and its hole a dot of ink.
  for (const batch of scene.batches) {
    if (batch.kind !== 'via' || revealing) continue
    const path = scene.paths.get(batch)!
    ctx.fillStyle = colours.paper
    ctx.fill(path)
    ctx.strokeStyle = toneOf(batch, true)
    ctx.lineWidth = 1.3 * px
    ctx.stroke(path)
  }
  for (const batch of scene.batches) {
    if (batch.kind !== 'hole') continue
    const path = scene.paths.get(batch)!
    // A via's hole is the dot in its disc (its batch carries the via's size as a width, to tell it by).
    if (batch.width > 0) {
      if (revealing) continue
      ctx.fillStyle = batch.stale ? mix(colours.cu, colours.paper, 0.4) : colours.cu
      ctx.fill(path)
    } else {
      ctx.fillStyle = colours.paper
      ctx.fill(path)
      if (!batch.through) {
        ctx.strokeStyle = colours.cu
        ctx.lineWidth = px
        ctx.stroke(path)
      }
    }
  }
  // The silk of the side in front: the top's while a layer other than the bottom is looked at.
  if (opts.silk) {
    const side = opts.active === 'B.Cu' ? 'B.SilkS' : 'F.SilkS'
    for (const batch of scene.batches) {
      if (batch.kind !== 'silk' || batch.layer !== side) continue
      const path = scene.paths.get(batch)!
      if (batch.width > 0) {
        ctx.strokeStyle = colours.silk
        ctx.lineWidth = Math.max(batch.width, px)
        ctx.stroke(path)
      } else {
        ctx.fillStyle = colours.silk
        ctx.fill(path)
      }
    }
  }
  ctx.restore()

  ctx.strokeStyle = colours.cu
  ctx.lineWidth = 1.4 * px
  ctx.stroke(scene.outline)

  if (opts.ratsnest) {
    ctx.strokeStyle = colours.rat
    ctx.fillStyle = colours.rat
    ctx.lineWidth = 1.3 * px
    for (const [a, b] of rats) {
      ctx.setLineDash([4 * px, 3 * px])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.setLineDash([])
      for (const end of [a, b]) {
        ctx.beginPath()
        ctx.arc(end.x, end.y, 2 * px, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
  }
}
