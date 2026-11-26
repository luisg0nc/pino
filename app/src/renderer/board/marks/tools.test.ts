import { describe, expect, it } from 'vitest'
import { toKicad } from '../../../shared/board/coords'
import { hitTest, Index } from '../../../shared/board/hit'
import { pressed } from '../../../shared/keys'
import type { RegionMark, StrokeMark } from '../../../shared/marks'
import { tiny } from '../../../test/marks'
import { liveReadout, newMarkFrom, strokeOf, TOOL_KEYS, TOOL_NAMES, TOOL_VERBS } from './tools'

const layers = ['F.Cu', 'B.Cu']
const k = (x: number, y: number) => toKicad({ x, y })
const wiggle = (n: number) => Array.from({ length: n }, (_, i) => k(i / 40, 3 + (i % 2) * 0.02))
const hitAt = (x: number, y: number) => hitTest(new Index(tiny), k(x, y), { visible: new Set(layers), active: 'F.Cu', tol: 0.05 })[0]

describe('a mark made by hand', () => {
  it('simplifies a hand stroke and keeps it on its layer', () => {
    const made = newMarkFrom('stroke', { points: wiggle(300), layer: 'B.Cu', layers }, tiny) as StrokeMark
    expect(made.kind).toBe('stroke')
    expect(made.layer).toBe('B.Cu')
    expect(made.points.length).toBeLessThan(40)
    expect(made.points[0]).toEqual({ x: 0, y: 3 })
    expect(made.points.at(-1)!.x).toBe(7.48) // marks are kept to hundredths of a millimetre
  })

  it('never keeps more points than a stroke may have', () => {
    const zigzag = Array.from({ length: 3000 }, (_, i) => k(i / 100, (i % 2) * 3))
    expect((newMarkFrom('stroke', { points: zigzag, layer: 'F.Cu', layers }, tiny) as StrokeMark).points.length).toBeLessThanOrEqual(400)
  })

  it('makes nothing of a click with a drawing tool', () => {
    expect(newMarkFrom('stroke', { points: [k(0, 0), k(0.05, 0)], layer: 'F.Cu', layers }, tiny)).toBeNull()
    expect(newMarkFrom('region', { points: [k(1, 1), k(1, 1)], layer: 'F.Cu', layers }, tiny)).toBeNull()
    expect(newMarkFrom('region', { points: [k(0, 0), k(0.5, 0), k(0.5, 0.5)], layer: 'F.Cu', layers }, tiny)).toBeNull()
    expect(newMarkFrom('arrow', { points: [k(0, 0), k(0.1, 0)], layer: 'F.Cu', layers }, tiny)).toBeNull()
    expect(newMarkFrom('select', { points: [k(0, 0)], layer: 'F.Cu', layers }, tiny)).toBeNull()
  })

  it('makes a region of an area, on every copper layer, to keep clear until said otherwise', () => {
    const made = newMarkFrom('region', { points: [k(-2, 2), k(2, 2), k(2, -2), k(-2, -2)], layer: 'B.Cu', layers }, tiny) as RegionMark
    expect(made).toMatchObject({ kind: 'region', layers, intent: 'keep-clear', note: '' })
    expect(made.points).toHaveLength(4)
  })

  it('points at what is under the press, and at nothing on bare board', () => {
    expect(newMarkFrom('point', { hit: hitAt(-0.48, 0), points: [k(-0.48, 0)], layer: 'F.Cu', layers }, tiny)).toMatchObject({ kind: 'point', space: 'board', target: { kind: 'pad', ref: 'R1', number: '1' } })
    expect(newMarkFrom('point', { points: [k(-8, 4)], layer: 'F.Cu', layers }, tiny)).toBeNull()
  })

  it('starts an arrow at the part under the press, even when a pad of it was pressed', () => {
    const made = newMarkFrom('arrow', { hit: hitAt(-0.48, 0), points: [k(-0.48, 0), k(0, -1.5)], layer: 'F.Cu', layers }, tiny)
    expect(made).toEqual({ kind: 'arrow', from: { kind: 'part', ref: 'R1' }, fromAt: { x: 0, y: 0 }, to: { x: 0, y: -1.5 }, note: '' })
  })

  it('starts an arrow at a bare point where nothing is', () => {
    expect(newMarkFrom('arrow', { points: [k(-8, 4), k(-6, 4)], layer: 'F.Cu', layers }, tiny)).toMatchObject({ from: null, fromAt: { x: -8, y: 4 }, to: { x: -6, y: 4 } })
  })

  it("reads a stroke's length and crossings live", () => {
    expect(liveReadout([k(-2, 0), k(6, 0)], tiny, 'F.Cu')).toBe('8.00 mm · crosses A, GND')
    expect(liveReadout([k(-8, 4), k(-6, 4)], tiny, 'F.Cu')).toBe('2.00 mm · crosses nothing')
  })

  it('turns the pointer path into the board file frame', () => {
    const view = { scale: 10, tx: -900, ty: -900 }
    expect(strokeOf([{ x: 100, y: 100 }, { x: 150, y: 100 }, { x: 200, y: 100 }], view)).toEqual([{ x: 100, y: 100 }, { x: 110, y: 100 }])
  })
})

describe('the tools', () => {
  it('are named by what they ask for, and have a key each', () => {
    expect(TOOL_NAMES).toEqual({ select: 'Select', point: 'Point at a part, pad or track', arrow: 'Arrow: move this here', stroke: 'Stroke: route this way', region: 'Region: keep this clear' })
    expect(Object.keys(TOOL_KEYS)).toEqual(Object.keys(TOOL_NAMES))
    for (const [tool, id] of Object.entries(TOOL_KEYS)) expect([tool, pressed({ key: { select: 'v', point: 'p', arrow: 'a', stroke: 'd', region: 'r' }[tool]! }, id)]).toEqual([tool, true])
    expect(TOOL_VERBS).toEqual({ point: 'Point', arrow: 'Move this here', stroke: 'Route this way', region: 'Keep this clear' })
  })
})
