// What pino sends to Claude for a mark or a selection: exact references, never pictures. A `Target` names a thing on
// the board by its stable ids, so it can be found again in a later build; `describeTarget` is its line of text, in
// the board frame. From the board-view spike's references and stroke crossings.

import type { Circuit } from '../circuit'
import type { Board, Footprint, Pad, Track, Via, Zone } from './board'
import { at, mm, toBoard } from './coords'
import { boxOf, dist, emptyBox, grow, meetArc, meetCircle, meetPoly, meetSegment, type Pt } from './geom'
import type { Hit, HitItem } from './hit'
import { naturalCompare } from './nets'
import { padPolygons } from './outlines'

/** A thing on the board, by what stays the same from build to build. `at` (a zone's) is in the board frame. */
export type Target =
  | { kind: 'part'; ref: string }
  | { kind: 'pad'; ref: string; number: string }
  | { kind: 'net'; name: string }
  | { kind: 'track'; uuid: string }
  | { kind: 'via'; uuid: string }
  | { kind: 'zone'; uuid: string; at: Pt }

const MOST_NET_PINS = 24

export function layerWords(layer: string): string {
  if (layer === 'F.Cu') return 'top copper'
  if (layer === 'B.Cu') return 'bottom copper'
  const inner = /^In(\d+)\.Cu$/.exec(layer)
  return inner ? `inner copper ${inner[1]}` : layer
}

const netWords = (net: string): string => (net ? `net ${net}` : 'no net')

const fourPlaces = (p: Pt): Pt => ({ x: Math.round(p.x * 1e4) / 1e4 || 0, y: Math.round(p.y * 1e4) / 1e4 || 0 })

/** The target a hit is. `click` is where it was hit, in the board file's frame. */
export function targetOf(hit: Hit, click: Pt): Target {
  const t = hit.target
  switch (t.type) {
    case 'footprint':
      return { kind: 'part', ref: t.ref }
    case 'pad':
      return { kind: 'pad', ref: t.fp.ref, number: t.number }
    case 'track':
      return { kind: 'track', uuid: t.uuid }
    case 'via':
      return { kind: 'via', uuid: t.uuid }
    case 'zone':
      return { kind: 'zone', uuid: t.uuid, at: fourPlaces(toBoard(click)) }
  }
}

const partOf = (board: Board, ref: string): Footprint | undefined => board.footprints.find((f) => f.ref === ref)

/** The pad of a part by its number: of several with one number (shields, thermal pads), the first with copper. */
function padOf(board: Board, ref: string, number: string): Pad | undefined {
  const same = partOf(board, ref)?.pads.filter((p) => p.number === number) ?? []
  return same.find((p) => p.copper.length > 0 && p.kind !== 'np_thru_hole') ?? same[0]
}

const netPads = (board: Board, name: string): Pad[] => board.footprints.flatMap((f) => f.pads.filter((p) => p.net === name))

/** The item on the board, or null: when it is gone, and for a net, which is no one item. */
export function findTarget(board: Board, t: Target): HitItem | null {
  switch (t.kind) {
    case 'part':
      return partOf(board, t.ref) ?? null
    case 'pad':
      return padOf(board, t.ref, t.number) ?? null
    case 'track':
      return board.tracks.find((x) => x.uuid === t.uuid) ?? null
    case 'via':
      return board.vias.find((x) => x.uuid === t.uuid) ?? null
    case 'zone':
      return board.zones.find((x) => x.uuid === t.uuid) ?? null
    case 'net':
      return null
  }
}

/** Whether the board still has what the target names. */
export const hasTarget = (board: Board, t: Target): boolean => (t.kind === 'net' ? board.nets.includes(t.name) : findTarget(board, t) !== null)

/** The item's place in the board frame: a part's own origin, the middle of a track, a net's pads. Null when it is gone. */
export function centreOf(board: Board, t: Target): Pt | null {
  if (t.kind === 'net') {
    const pads = netPads(board, t.name)
    if (!pads.length) return null
    const box = boxOf(pads.map((p) => p.center))
    return toBoard({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 })
  }
  const item = findTarget(board, t)
  if (!item) return null
  switch (item.type) {
    case 'footprint':
    case 'via':
      return toBoard(item.pos)
    case 'pad':
      return toBoard(item.center)
    case 'track':
      return toBoard(item.mid ?? { x: (item.a.x + item.b.x) / 2, y: (item.a.y + item.b.y) / 2 })
    case 'zone':
      return (t as Extract<Target, { kind: 'zone' }>).at
  }
}

/** A pin's name where the symbol gives one: not `~`, and not its number again. */
function pinName(circuit: Circuit | null, ref: string, number: string, fromFile = ''): string {
  const named = circuit?.parts.find((p) => p.ref === ref)?.pins.find((p) => p.number === number)?.name ?? fromFile
  return named === '~' || named === number ? '' : named
}

/** The pins of a net as [ref, number], in the circuit's order, else as the board file has them. */
export function netMembers(board: Board, circuit: Circuit | null, name: string): Array<{ ref: string; number: string; pin: string }> {
  const listed = circuit?.nets.find((n) => n.name === name)?.pins
  if (listed) return listed.map(([ref, number]) => ({ ref, number, pin: pinName(circuit, ref, number) }))
  const seen = new Set<string>()
  return netPads(board, name)
    .filter((p) => p.copper.length > 0 && !seen.has(`${p.fp.ref}.${p.number}`) && seen.add(`${p.fp.ref}.${p.number}`))
    .map((p) => ({ ref: p.fp.ref, number: p.number, pin: pinName(circuit, p.fp.ref, p.number, p.pinName) }))
}

const joined = (parts: Array<string | null | false>): string => parts.filter(Boolean).join(' · ')

function describePart(t: Footprint): string {
  const footprint = t.lib.slice(t.lib.indexOf(':') + 1)
  return joined([`part ${t.ref}`, t.value, footprint, `at ${at(toBoard(t.pos))} mm`, `rot ${Number((((t.angle % 360) + 360) % 360).toFixed(2))}°`, t.side === 'F' ? 'top' : 'bottom'])
}

function describePad(circuit: Circuit | null, t: Pad): string {
  const layer = t.kind === 'thru_hole' ? 'through' : layerWords(t.copper[0] ?? '')
  return joined([`pad ${t.fp.ref}.${t.number}`, pinName(circuit, t.fp.ref, t.number, t.pinName), netWords(t.net), layer, `at ${at(toBoard(t.center))} mm`])
}

function describeTrack(t: Track): string {
  const through = t.mid ? ` through ${at(toBoard(t.mid))}` : ''
  return joined(['track', layerWords(t.layer), netWords(t.net), `${mm(t.w)} mm wide`, `from ${at(toBoard(t.a))} to ${at(toBoard(t.b))}${through} mm`, `uuid ${t.uuid}`])
}

function describeVia(t: Via): string {
  const span = `${layerWords(t.layers[0]).replace(' copper', '')} to ${layerWords(t.layers[1])}`
  return joined(['via', netWords(t.net), span, `at ${at(toBoard(t.pos))} mm`, `${mm(t.size)} mm, drill ${mm(t.drill)}`, `uuid ${t.uuid}`])
}

function describeZone(t: Zone, click: Pt): string {
  const lo = toBoard({ x: t.box.x0, y: t.box.y1 })
  const hi = toBoard({ x: t.box.x1, y: t.box.y0 })
  return joined(['zone', netWords(t.net), t.layers.map(layerWords).join(' and '), `x ${mm(lo.x)} to ${mm(hi.x)}, y ${mm(lo.y)} to ${mm(hi.y)} mm`, `clicked ${at(click)} mm`, `uuid ${t.uuid}`])
}

/** The line Claude gets for a target. */
export function describeTarget(board: Board, circuit: Circuit | null, t: Target): string {
  if (!hasTarget(board, t)) return `${t.kind} ${shortLabel(board, t)} · not on this board`
  if (t.kind === 'net') {
    const members = netMembers(board, circuit, t.name)
    const said = members.slice(0, MOST_NET_PINS).map((m) => `${m.ref}.${m.number}${m.pin ? ` ${m.pin}` : ''}`)
    if (members.length > MOST_NET_PINS) said.push(`and ${members.length - MOST_NET_PINS} more`)
    return joined([`net ${t.name}`, `${members.length} pin${members.length === 1 ? '' : 's'}: ${said.join(', ')}`])
  }
  const item = findTarget(board, t)!
  switch (item.type) {
    case 'footprint':
      return describePart(item)
    case 'pad':
      return describePad(circuit, item)
    case 'track':
      return describeTrack(item)
    case 'via':
      return describeVia(item)
    case 'zone':
      return describeZone(item, (t as Extract<Target, { kind: 'zone' }>).at)
  }
}

/** The few words a chip or a tab shows for a target. */
export function shortLabel(board: Board, t: Target): string {
  switch (t.kind) {
    case 'part':
      return t.ref
    case 'pad':
      return `${t.ref}.${t.number}`
    case 'net':
      return t.name
    default: {
      const item = findTarget(board, t) as Track | Via | Zone | null
      return item?.net ? `${t.kind} ${item.net}` : t.kind
    }
  }
}

/**
 * What a path crosses on one copper layer: the nets of the pads, vias, tracks (arcs as arcs) and zone fills it meets,
 * and the parts whose outline it passes, on either side. Each list is in the order they are first met. `path` is in
 * the board file's frame.
 */
export function crossings(board: Board, path: Pt[], layer: string): { nets: string[]; parts: string[] } {
  const nets = new Map<string, number>()
  const parts = new Map<string, number>()
  const met = (into: Map<string, number>, name: string, along: number) => {
    if (name && along < (into.get(name) ?? Infinity)) into.set(name, along)
  }
  const reach = emptyBox()
  for (const p of path) grow(reach, p)
  let walked = 0
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const length = dist(a, b)
    const take = (into: Map<string, number>, name: string, t: number | null) => t !== null && met(into, name, walked + t * length)
    for (const t of board.tracks) {
      if (t.layer === layer) take(nets, t.net, t.arc ? meetArc(a, b, t.arc) : meetSegment(a, b, t.a, t.b))
    }
    for (const v of board.vias) {
      if (!v.span.includes(layer)) continue
      take(nets, v.net, dist(a, v.pos) <= v.size / 2 ? 0 : (meetCircle(a, b, v.pos, v.size / 2)[0] ?? null))
    }
    for (const z of board.zones) {
      if (z.keepout || z.teardrop) continue
      for (const f of z.fills) if (f.layer === layer) take(nets, z.net, meetPoly(a, b, f.pts))
    }
    for (const fp of board.footprints) {
      for (const pad of fp.pads) {
        if (!pad.copper.includes(layer) || pad.kind === 'np_thru_hole') continue
        for (const outline of padPolygons(pad)) take(nets, pad.net, meetPoly(a, b, outline))
      }
      // A footprint with no pads is a drawing (a logo), not a part.
      if (fp.pads.length && fp.outline.length) take(parts, fp.ref, meetPoly(a, b, fp.outline))
    }
    walked += length
  }
  const inOrder = (found: Map<string, number>) => [...found].sort((x, y) => x[1] - y[1] || naturalCompare(x[0], y[0])).map(([name]) => name)
  return { nets: inOrder(nets), parts: inOrder(parts) }
}
