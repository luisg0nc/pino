import { expect, it } from 'vitest'
import { toKicad } from '../../../shared/board/coords'
import { padPolygons } from '../../../shared/board/outlines'
import { arrow, point, region, stroke, tiny } from '../../../test/marks'
import { chipAnchor, chipBoxes, stackChips } from './chips'

it("puts a mark's chip on its point", () => {
  const near = (p: { x: number; y: number } | null, x: number, y: number) => expect([+p!.x.toFixed(3), +p!.y.toFixed(3)]).toEqual([toKicad({ x, y }).x, toKicad({ x, y }).y])
  near(chipAnchor(point(), tiny), 0.91, 0.46) // a part: the top right of its courtyard
  // a pad: the top right of its copper, so that the chip does not cover what was marked
  const copper = padPolygons(tiny.footprints.find((f) => f.ref === 'R1')!.pads.find((p) => p.number === '1')!).flat()
  expect(chipAnchor(point({ target: { kind: 'pad', ref: 'R1', number: '1' }, at: { x: -0.48, y: 0 } }), tiny)).toEqual({ x: Math.max(...copper.map((p) => p.x)), y: Math.min(...copper.map((p) => p.y)) })
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

it('boxes each mark just right of and above its point, leaving out what has none, and stacks them', () => {
  const marks = [point({ id: 'M1', label: 'M1' }), point({ id: 'M2', label: 'gap 0.83 mm' }), point({ id: 'M3', label: 'M3' })]
  const boxes = chipBoxes(marks, (m) => (m.id === 'M3' ? null : { x: 100, y: 100 }))
  expect(boxes.map((b) => [b.mark.id, b.x, b.y, b.w, b.h])).toEqual([
    ['M1', 104, 83, 24, 17],
    ['M2', 104, 65, 87, 17]
  ])
})
