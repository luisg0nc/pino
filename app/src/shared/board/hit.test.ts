import { expect, it } from 'vitest'
import { tinyBoard } from '../../test/fixtures'
import { readBoard } from './board'
import { hitTest, Index, nextHit, type HitOpts } from './hit'

const board = readBoard(tinyBoard())
const index = new Index(board)
const opts: HitOpts = { visible: new Set(['F.Cu', 'B.Cu']), active: 'F.Cu', tol: 0.1 }
const kinds = (p: { x: number; y: number }, o = opts) => hitTest(index, p, o).map((h) => h.target.type)

it('hits a pad before the track under it, and cycles on a repeat', () => {
  const hits = hitTest(index, { x: 99.52, y: 100 }, opts)
  expect(hits.map((h) => h.target.type)).toEqual(['pad', 'track', 'footprint'])
  expect(nextHit(hits, null)).toBe(hits[0])
  expect(nextHit(hits, hits[0].target)).toBe(hits[1])
  expect(nextHit(hits, hits[2].target)).toBe(hits[0])
  expect(nextHit([], null)).toBeNull()
})

it('prefers copper on the layer being looked at', () => {
  const at = { x: 104.0625, y: 100.95 } // U1.1 on the back, over the zone
  expect(hitTest(index, at, { ...opts, active: 'B.Cu' })[0].target).toMatchObject({ type: 'pad', number: '1' })
  expect(kinds(at, { ...opts, visible: new Set(['F.Cu']) })).toEqual([])
})

it('finds a near miss within the tolerance, after what is exactly there', () => {
  expect(kinds({ x: 101.9, y: 97.36 })).toEqual(['track'])
  expect(kinds({ x: 101.9, y: 97.7 })).toEqual([])
})

it('never hits a teardrop', () => {
  const text = tinyBoard().replace('(name "GND_B.Cu")', '(name "GND_B.Cu") (attr (teardrop (type padvia)))')
  const drops = new Index(readBoard(text))
  expect(hitTest(drops, { x: 95, y: 103 }, { ...opts, active: 'B.Cu' })).toEqual([])
  expect(hitTest(index, { x: 95, y: 103 }, { ...opts, active: 'B.Cu' })[0].target.type).toBe('zone')
})
