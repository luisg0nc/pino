import { expect, it } from 'vitest'
import { fx, read, tinyBoard } from '../../test/fixtures'
import { readBoard } from './board'
import { copperGroups, naturalCompare, netLength } from './nets'

const tiny = readBoard(tinyBoard())
const quarter = Math.PI / 2
const long = Math.hypot(104.0625 - 100.52, 99.05 - 96)

it('groups connected copper and measures length', () => {
  expect(copperGroups(tiny, 'A')).toEqual([{ pads: ['R1.1', 'U1.2'], tracks: 3, vias: 1, length: expect.closeTo(3 + quarter + long, 4) }])
  expect(netLength(tiny, 'A')).toBeCloseTo(3 + quarter + long, 4)
  expect(netLength(tiny, 'GND')).toBe(0)
})

it('keeps copper that does not touch apart, and joins what a zone joins', () => {
  // R1.2 is on the front, the zone and U1.1 on the back
  expect(copperGroups(tiny, 'GND').map((g) => g.pads)).toEqual([['R1.2'], ['U1.1']])
})

it('breaks a net where a track is gone', () => {
  const cut = { ...tiny, tracks: tiny.tracks.filter((t) => !t.arc) }
  expect(copperGroups(cut, 'A').map((g) => [g.pads, g.tracks, g.vias])).toEqual([
    [['R1.1'], 1, 0],
    [['U1.2'], 1, 1]
  ])
})

it('finds no copper joining the pins of the unrouted reference board but through its pour', () => {
  const board = readBoard(read(fx('filled/board.kicad_pcb')))
  expect(copperGroups(board, 'VBUS').length).toBeGreaterThan(1)
  expect(copperGroups(board, 'VBUS').every((g) => g.tracks === 0)).toBe(true)
})

it('sorts names the way a person counts', () => {
  expect(['R10', 'R2', 'C1', 'R1'].sort(naturalCompare)).toEqual(['C1', 'R1', 'R2', 'R10'])
})
