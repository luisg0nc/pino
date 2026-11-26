// Marks: what the person draws on the board and the sheet to point, and what Claude points back with. A mark is anchored
// by stable ids (refs, pins, nets, uuids), so that it is found again after a rebuild. All positions are in pino's
// board frame, or sheet millimetres for a point on the sheet.

import type { Pt } from './board/geom'
import type { Target } from './board/refs'

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
