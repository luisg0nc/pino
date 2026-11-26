// Marks: what the person draws on the board and the sheet to point, and what Claude points back with. A mark is anchored
// by stable ids (refs, pins, nets, uuids), so that it is found again after a rebuild. All positions are in pino's
// board frame, or sheet millimetres for a point on the sheet.

import type { Board } from './board/board'
import { at, mm, toKicad } from './board/coords'
import { inPoly, type Pt } from './board/geom'
import { naturalCompare } from './board/nets'
import { crossings, describeTarget, layerWords, shortLabel, type Target } from './board/refs'
import type { Circuit } from './circuit'

export type MarkStatus = 'draft' | 'sent' | 'resolved'
export type AnchorState = 'ok' | 'moved' | 'stale'

export interface MarkBase {
  /** `M<n>`, never used again. */
  id: string
  author: 'user' | 'agent'
  status: MarkStatus
  anchor: AnchorState
  /** The build it was made on. */
  build: number
  /** The last build it was looked for in. */
  checkedBuild?: number
  note: string
  /** The exact line Claude gets. */
  payload: string
  /** The few words its chip shows. */
  label: string
  createdAt: string
  resolvedNote?: string
  resolvedBy?: 'user' | 'agent'
  /** Of a stale mark: where its target was, and what it was. */
  was?: { at: Pt; text: string }
}

export interface PointMark extends MarkBase {
  kind: 'point'
  space: 'board' | 'sheet'
  target: Target
  at: Pt
}

export interface ArrowMark extends MarkBase {
  kind: 'arrow'
  from: Target | null
  fromAt: Pt
  to: Pt
}

export interface StrokeMark extends MarkBase {
  kind: 'stroke'
  layer: string
  points: Pt[]
  crosses: { nets: string[]; parts: string[] }
}

export interface RegionMark extends MarkBase {
  kind: 'region'
  layers: string[]
  points: Pt[]
  intent: 'keep-clear' | 'put-here' | null
  holds: string[]
}

export type Mark = PointMark | ArrowMark | StrokeMark | RegionMark

/** Without the parts main works out: what the window or a tool asks to be marked. */
export type NewMark = Mark extends infer M
  ? M extends Mark
    ? Omit<M, 'id' | 'author' | 'status' | 'anchor' | 'build' | 'checkedBuild' | 'createdAt' | 'payload' | 'label' | 'resolvedNote' | 'resolvedBy' | 'was'>
    : never
  : never

export interface MarkPatch {
  note?: string
  intent?: 'keep-clear' | 'put-here' | null
  /** A stroke's or a region's layer; `all` puts a region on every copper layer. */
  layer?: string
  status?: 'draft'
}

export const MAX_NOTE = 300
export const MAX_STROKE_POINTS = 400
export const MOST_MARKS = 200
export const MOST_AGENT_TARGETS = 8
/** What a hand stroke is simplified to, mm (Ramer-Douglas-Peucker). */
export const STROKE_TOLERANCE = 0.1

/** A path longer than this is said by its ends. */
const MOST_PATH_POINTS = 24

export const pathLength = (points: readonly Pt[]): number => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0)

/** A stroke told what it crosses and a region what it holds, read off the board. Points are in the board frame. */
export function withCrossings<M extends Mark>(mark: M, board: Board): M {
  if (mark.kind === 'stroke') return { ...mark, crosses: crossings(board, mark.points.map(toKicad), mark.layer) }
  if (mark.kind !== 'region') return mark
  const outline = mark.points.map(toKicad)
  const holds = board.footprints
    .filter((f) => f.pads.length > 0 && inPoly(f.pos, outline))
    .map((f) => f.ref)
    .sort(naturalCompare)
  return { ...mark, holds }
}

function direction(from: Pt, to: Pt): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const across = dx > 0 ? 'right' : 'left'
  const up = dy > 0 ? 'up' : 'down'
  if (Math.abs(dy) < 0.005) return `${mm(Math.abs(dx))} mm ${across}`
  if (Math.abs(dx) < 0.005) return `${mm(Math.abs(dy))} mm ${up}`
  return `${mm(Math.hypot(dx, dy))} mm, ${mm(Math.abs(dx))} ${across} and ${mm(Math.abs(dy))} ${up}`
}

const targetWords = (board: Board, t: Target): string => (t.kind === 'part' || t.kind === 'pad' || t.kind === 'net' ? `${t.kind} ${shortLabel(board, t)}` : shortLabel(board, t))

/** What is gone, for a stale mark. */
function gone(mark: Mark): string {
  const target = mark.kind === 'point' ? mark.target : mark.kind === 'arrow' ? mark.from : null
  if (!target) return 'its target is gone'
  if (target.kind === 'part') return `part ${target.ref} is gone`
  if (target.kind === 'pad') return `pad ${target.ref}.${target.number} is gone`
  if (target.kind === 'net') return `net ${target.name} is gone`
  return `its ${target.kind} is gone`
}

function pathWords(points: readonly Pt[]): string {
  if (points.length <= MOST_PATH_POINTS) return points.map(at).join(' ')
  const half = MOST_PATH_POINTS / 2
  return `${points.slice(0, half).map(at).join(' ')} … ${points.slice(-half).map(at).join(' ')}`
}

/** The exact line Claude gets for a mark, from the board as it is now. */
export function markPayload(mark: Mark, board: Board, circuit: Circuit | null): string {
  if (mark.anchor === 'stale' && mark.was) return `${mark.was.text} · stale: ${gone(mark)}, it was at ${at(mark.was.at)} mm`
  if (mark.kind === 'point') return describeTarget(board, circuit, mark.target)
  if (mark.kind === 'arrow') {
    const from = mark.from ? `${targetWords(board, mark.from)} ` : ''
    return `arrow · from ${from}${at(mark.fromAt)} to ${at(mark.to)} mm · ${direction(mark.fromAt, mark.to)}`
  }
  if (mark.kind === 'stroke') {
    const { nets, parts } = mark.crosses
    const met = [nets.length ? `crosses nets ${nets.join(', ')}` : '', parts.length ? `passes parts ${parts.join(', ')}` : ''].filter(Boolean)
    return ['stroke', layerWords(mark.layer), `${mm(pathLength(mark.points))} mm`, `path ${pathWords(mark.points)} mm`, ...(met.length ? met : ['crosses nothing on that layer'])].join(' · ')
  }
  const xs = mark.points.map((p) => p.x)
  const ys = mark.points.map((p) => p.y)
  const every = board.copper.every((l) => mark.layers.includes(l))
  const layers = every && board.copper.length > 1 ? `${board.copper.length === 2 ? 'both' : 'all'} copper layers` : mark.layers.map(layerWords).join(' and ')
  const intent = mark.intent === 'keep-clear' ? 'keep this clear: ' : mark.intent === 'put-here' ? 'put these here: ' : ''
  return `${intent}${[
    'region',
    layers,
    `x ${mm(Math.min(...xs))} to ${mm(Math.max(...xs))}, y ${mm(Math.min(...ys))} to ${mm(Math.max(...ys))} mm`,
    `${mark.points.length} points`,
    mark.holds.length ? `holds ${mark.holds.join(', ')}` : 'holds no part'
  ].join(' · ')}`
}

/** What a mark's chip shows: the id for the person's marks, what it points at for Claude's. */
export function markLabel(mark: Mark): string {
  if (mark.author === 'user') return mark.id
  // Claude's arrow spans the gap it measured, from one item's nearest copper to the other's.
  if (mark.kind === 'arrow') return `gap ${mm(pathLength([mark.fromAt, mark.to]))} mm`
  if (mark.kind !== 'point') return mark.kind
  const t = mark.target
  return t.kind === 'part' ? t.ref : t.kind === 'pad' ? `${t.ref}.${t.number}` : t.kind === 'net' ? t.name : t.kind
}
