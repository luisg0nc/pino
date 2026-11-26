// The copper of a net: what is joined to what by the shapes touching, and how long it runs.

import type { Board, Pad, Track, Via, Zone } from './board'
import { arcPoints, dist, inPoly, type Pt } from './geom'
import { padDistance, trackDistance } from './hit'

/** Names in the order a person counts them: R2 before R10. */
export const naturalCompare = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true })

export const trackLength = (t: Track): number => (t.arc ? Math.abs(t.arc.sweep) * t.arc.r : dist(t.a, t.b))

export const netLength = (board: Board, net: string): number => board.tracks.filter((t) => t.net === net).reduce((sum, t) => sum + trackLength(t), 0)

export interface CopperGroup {
  /** `R1.1`, in natural order. */
  pads: string[]
  tracks: number
  vias: number
  /** Of its tracks and arcs, mm. */
  length: number
}

type Piece =
  | { kind: 'pad'; pad: Pad; layers: string[] }
  | { kind: 'track'; track: Track; layers: string[] }
  | { kind: 'via'; via: Via; layers: string[] }
  | { kind: 'fill'; zone: Zone; pts: Pt[]; layers: string[] }

const TOUCH = 0.001

/** The points of a piece that, inside another, show the two joined. */
function probes(p: Piece): Array<{ at: Pt; r: number }> {
  if (p.kind === 'pad') return [{ at: p.pad.center, r: 0 }]
  if (p.kind === 'via') return [{ at: p.via.pos, r: p.via.size / 2 }]
  if (p.kind === 'track') {
    const ends = p.track.arc ? arcPoints(p.track.arc, 0.01) : [p.track.a, p.track.b]
    return [ends[0], ends[ends.length - 1]].map((at) => ({ at, r: p.track.w / 2 }))
  }
  return []
}

function contains(p: Piece, at: Pt, r: number): boolean {
  if (p.kind === 'pad') return padDistance(p.pad, at) <= r + TOUCH
  if (p.kind === 'via') return dist(p.via.pos, at) <= p.via.size / 2 + r + TOUCH
  if (p.kind === 'track') return trackDistance(p.track, at) <= r + TOUCH
  return inPoly(at, p.pts)
}

function touching(a: Piece, b: Piece): boolean {
  if (!a.layers.some((l) => b.layers.includes(l))) return false
  if (probes(a).some((q) => contains(b, q.at, q.r)) || probes(b).some((q) => contains(a, q.at, q.r))) return true
  // A pad joins a pour by thermal spokes that end on the pad's copper, with the pad's centre outside the fill.
  const [fill, other] = a.kind === 'fill' ? [a, b] : b.kind === 'fill' ? [b, a] : [null, a]
  return fill !== null && other.kind === 'pad' && fill.pts.some((pt) => padDistance(other.pad, pt) <= TOUCH)
}

export function copperGroups(board: Board, net: string): CopperGroup[] {
  const pieces: Piece[] = [
    ...board.footprints.flatMap((f) => f.pads.filter((p) => p.net === net && p.copper.length > 0 && p.kind !== 'np_thru_hole').map((pad): Piece => ({ kind: 'pad', pad, layers: pad.copper }))),
    ...board.tracks.filter((t) => t.net === net).map((track): Piece => ({ kind: 'track', track, layers: [track.layer] })),
    ...board.vias.filter((v) => v.net === net).map((via): Piece => ({ kind: 'via', via, layers: via.span })),
    ...board.zones.filter((z) => z.net === net && !z.keepout).flatMap((zone) => zone.fills.map((f): Piece => ({ kind: 'fill', zone, pts: f.pts, layers: [f.layer] })))
  ]
  const root = pieces.map((_, i) => i)
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])))
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) if (find(i) !== find(j) && touching(pieces[i], pieces[j])) root[find(i)] = find(j)
  }
  const groups = new Map<number, Piece[]>()
  pieces.forEach((piece, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), piece]))
  return [...groups.values()]
    .filter((group) => group.some((p) => p.kind !== 'fill'))
    .map((group) => {
      const tracks = group.flatMap((p) => (p.kind === 'track' ? [p.track] : []))
      return {
        pads: [...new Set(group.flatMap((p) => (p.kind === 'pad' ? [`${p.pad.fp.ref}.${p.pad.number}`] : [])))].sort(naturalCompare),
        tracks: tracks.length,
        vias: group.filter((p) => p.kind === 'via').length,
        length: tracks.reduce((sum, t) => sum + trackLength(t), 0)
      }
    })
    .sort((a, b) => naturalCompare(a.pads[0] ?? '~', b.pads[0] ?? '~'))
}
