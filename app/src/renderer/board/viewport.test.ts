import { expect, it } from 'vitest'
import { DRAG_SLOP, fit, MAX_SCALE, MIN_SCALE, scaleBar, toModel, toScreen, zoomAt } from './viewport'

const box = { x0: 72, y0: 78, x1: 128, y1: 122 }
const INSET = { l: 64, r: 240, t: 56, b: 56 }

it('fits the box in the room the furniture leaves, centred in it', () => {
  const v = fit(box, 1000, 700, INSET)
  expect(v.scale).toBeCloseTo(Math.min((1000 - 304) / 56, (700 - 112) / 44), 9)
  const middle = toScreen(v, { x: 100, y: 100 })
  expect(middle.x).toBeCloseTo(64 + (1000 - 304) / 2, 6)
  expect(middle.y).toBeCloseTo(56 + (700 - 112) / 2, 6)
})

it('fits in a view too small for its furniture without turning the board inside out', () => {
  expect(fit(box, 200, 80, INSET).scale).toBe(MIN_SCALE)
})

it('keeps the point under the cursor when zooming', () => {
  const v = fit(box, 800, 600, INSET)
  const s = { x: 300, y: 200 }
  const before = toModel(v, s)
  const after = toModel(zoomAt(v, s, 1.25), s)
  expect(after.x).toBeCloseTo(before.x, 9)
  expect(after.y).toBeCloseTo(before.y, 9)
})

it('stops zooming at its limits', () => {
  const v = fit(box, 800, 600, INSET)
  expect(zoomAt(v, { x: 0, y: 0 }, 1e6).scale).toBe(MAX_SCALE)
  expect(zoomAt(v, { x: 0, y: 0 }, 1e-9).scale).toBe(MIN_SCALE)
  expect([MAX_SCALE, DRAG_SLOP]).toEqual([400, 4])
})

it('draws a scale bar of a round length no wider than 120 px', () => {
  expect(scaleBar(12)).toEqual({ mm: 10, px: 120 })
  expect(scaleBar(13)).toEqual({ mm: 5, px: 65 })
  expect(scaleBar(50)).toEqual({ mm: 2, px: 100 })
  expect(scaleBar(400)).toEqual({ mm: 0.2, px: 80 })
})
