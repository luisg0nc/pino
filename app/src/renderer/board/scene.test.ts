import { expect, it } from 'vitest'
import { readBoard } from '../../shared/board/board'
import { fx, read, tinyBoard } from '../../test/fixtures'
import { bakeBatches, edgeLoops, revealOrder } from './scene'

const reference = readBoard(read(fx('filled/board.kicad_pcb')))
const tiny = readBoard(tinyBoard())

it('bakes the reference board into batches by layer, net and width', () => {
  const batches = bakeBatches(reference)
  const layers = new Set(batches.map((b) => b.layer))
  for (const layer of ['F.Cu', 'B.Cu', 'F.SilkS', 'Edge.Cuts']) expect(layers).toContain(layer)
  expect([...layers].filter((l) => !['F.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'Edge.Cuts'].includes(l))).toEqual([])
  // every pad with copper is drawn once, whatever the number of layers it is on
  const withCopper = reference.footprints.flatMap((f) => f.pads).filter((p) => p.copper.length > 0 && p.kind !== 'np_thru_hole')
  expect(batches.filter((b) => b.kind === 'pad').reduce((n, b) => n + b.items.length, 0)).toBe(withCopper.length)
  const keys = batches.map((b) => `${b.layer}|${b.net}|${b.kind}|${b.width}|${b.through}|${b.stale}`)
  expect(new Set(keys).size).toBe(keys.length)
})

it('keeps through pads apart from the pads of one side, and drills every hole', () => {
  const batches = bakeBatches(reference)
  const through = batches.filter((b) => b.kind === 'pad' && b.through).flatMap((b) => b.items)
  expect(through.length).toBeGreaterThan(0)
  const drilled = reference.footprints.flatMap((f) => f.pads).filter((p) => p.drill).length
  expect(batches.filter((b) => b.kind === 'hole').reduce((n, b) => n + b.items.length, 0)).toBe(drilled + reference.vias.length)
})

it('puts copper named as stale in batches of its own', () => {
  const stale = new Set([tiny.tracks[0].uuid, tiny.vias[0].uuid])
  const batches = bakeBatches(tiny, stale)
  const count = (kind: string, isStale: boolean) => batches.filter((b) => b.kind === kind && b.stale === isStale).reduce((n, b) => n + b.items.length, 0)
  expect([count('track', true), count('track', false), count('via', true), count('via', false)]).toEqual([1, 2, 1, 0])
})

it('draws no teardrop as a pour, and no keep-out as copper', () => {
  expect(bakeBatches(tiny).filter((b) => b.kind === 'zone').map((b) => [b.layer, b.net])).toEqual([['B.Cu', 'GND']])
})

it('lets copper arrive net by net, the nearest to the middle of the board first', () => {
  expect(revealOrder(tiny)).toEqual(['A'])
  const order = revealOrder(readBoard(read(fx('filled/board.kicad_pcb'))))
  expect(order).toEqual([])
})

it('chains the edge cuts into the loops the board is filled by', () => {
  expect(edgeLoops(tiny)).toHaveLength(1)
  expect(edgeLoops(tiny)[0]).toHaveLength(4)
  const loops = edgeLoops(readBoard(read(fx('filled/board.kicad_pcb'))))
  expect(loops).toHaveLength(1)
  const xs = loops[0].map((p) => p.x)
  expect([Math.min(...xs), Math.max(...xs)].map((v) => Math.round(v))).toEqual([72, 128])
})
