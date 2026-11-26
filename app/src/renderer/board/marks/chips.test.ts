import { expect, it } from 'vitest'
import { toKicad } from '../../../shared/board/coords'
import { arrow, point, region, stroke, tiny } from '../../../test/marks'
import { chipAnchor, stackChips } from './chips'

it("puts a mark's chip on its point", () => {
  const near = (p: { x: number; y: number } | null, x: number, y: number) => expect([+p!.x.toFixed(3), +p!.y.toFixed(3)]).toEqual([toKicad({ x, y }).x, toKicad({ x, y }).y])
  near(chipAnchor(point(), tiny), 0.91, 0.46) // a part: the top right of its courtyard
  near(chipAnchor(point({ target: { kind: 'pad', ref: 'R1', number: '1' }, at: { x: -0.48, y: 0 } }), tiny), -0.48, 0)
  near(chipAnchor(arrow(), tiny), 0, -1.5)
  near(chipAnchor(stroke(), tiny), 6, 0)
  near(chipAnchor(region(), tiny), 2, 2)
  near(chipAnchor(point({ anchor: 'stale', target: { kind: 'part', ref: 'R9' }, was: { at: { x: 3, y: 1 }, text: 't' } }), tiny), 3, 1)
  expect(chipAnchor(point({ target: { kind: 'part', ref: 'R9' } }), tiny)).toBeNull()
})

it('moves a chip up while it would cover another, three steps at most', () => {
  const box = (x: number, y: number) => ({ x, y, w: 24, h: 17 })
  expect(stackChips([box(0, 100), box(100, 100)]).map((b) => b.y)).toEqual([100, 100])
  // each is put just above the chip it would cover, one pixel clear
  expect(stackChips([box(0, 100), box(4, 102), box(8, 98)]).map((b) => b.y)).toEqual([100, 82, 64])
  const heap = stackChips(Array.from({ length: 6 }, () => box(0, 100)))
  expect(Math.min(...heap.map((b) => b.y))).toBe(100 - 3 * 18)
})
