// Marks and build models made for tests, on the hand-written tiny board.

import { readBoard, type Board } from '../shared/board/board'
import { toKicad } from '../shared/board/coords'
import type { BuildResult } from '../shared/build'
import type { ArrowMark, MarkBase, PointMark, RegionMark, StrokeMark } from '../shared/marks'
import type { BuildModel } from '../main/model'
import { fx, readJson, tinyBoard } from './fixtures'

export const tiny = readBoard(tinyBoard())

/** The tiny board with a piece of its file's text changed. */
export function tinyWith(from: string | RegExp, to: string): Board {
  const text = tinyBoard()
  const next = text.replace(from, to)
  if (next === text) throw new Error(`the tiny board has no ${String(from)}`)
  return readBoard(next)
}

export function modelOf(board: Board = tiny, over: Partial<BuildResult> = {}): BuildModel {
  const result = { ...readJson<BuildResult>(fx('result.json')), number: 2, hash: 'aaaaaaaa0002', ...over }
  return { result, board, routeBoard: null, circuit: null, placement: null, sheet: null }
}

const base = (id: string): MarkBase => ({ id, author: 'user', status: 'sent', anchor: 'ok', build: 1, note: '', payload: '', label: id, createdAt: '2026-11-26T08:00:00Z' })

export const point = (over: Partial<PointMark> = {}): PointMark => ({ ...base('M1'), kind: 'point', space: 'board', target: { kind: 'part', ref: 'R1' }, at: { x: 0, y: 0 }, ...over })
export const arrow = (over: Partial<ArrowMark> = {}): ArrowMark => ({ ...base('M2'), kind: 'arrow', from: { kind: 'part', ref: 'R1' }, fromAt: { x: 0, y: 0 }, to: { x: 0, y: -1.5 }, ...over })
export const stroke = (over: Partial<StrokeMark> = {}): StrokeMark => ({ ...base('M3'), kind: 'stroke', layer: 'F.Cu', points: [{ x: -2, y: 0 }, { x: 6, y: 0 }], crosses: { nets: [], parts: [] }, ...over })
export const region = (over: Partial<RegionMark> = {}): RegionMark => ({
  ...base('M4'), kind: 'region', layers: ['F.Cu', 'B.Cu'], intent: null, holds: [],
  points: [{ x: -2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: -2 }, { x: -2, y: -2 }], ...over
})

export { toKicad }
