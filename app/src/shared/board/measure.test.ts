import { expect, it } from 'vitest'
import { tinyBoard } from '../../test/fixtures'
import { readBoard } from './board'
import { measure } from './measure'
import type { Target } from './refs'

const tiny = readBoard(tinyBoard())
const pad = (ref: string, number: string): Target => ({ kind: 'pad', ref, number })
const part = (ref: string): Target => ({ kind: 'part', ref })

it('measures a gap between two pads from copper edge to copper edge', () => {
  const gap = measure(tiny, { what: 'gap', a: pad('R1', '1'), b: pad('R1', '2') })
  expect(gap.value).toBeCloseTo(0.4, 4)
  expect(gap).toMatchObject({ unit: 'mm', said: 'gap R1.1 to R1.2: 0.40 mm, copper edge to copper edge' })
})

it('says touching copper touches', () => {
  const gap = measure(tiny, { what: 'gap', a: pad('R1', '1'), b: { kind: 'track', uuid: tiny.tracks[0].uuid } })
  expect(gap.value).toBe(0)
  expect(gap.said).toContain('they touch')
})

it('measures outline to outline when no copper layer is shared', () => {
  const gap = measure(tiny, { what: 'gap', a: part('R1'), b: part('U1') })
  // courtyards: R1 ends at x 0.91, U1 begins at x 3.08
  expect(gap.value).toBeCloseTo(2.17, 4)
  expect(gap.said).toBe('gap R1 to U1: 2.17 mm, outline to outline (they share no copper layer)')
})

it('measures the distance between centres', () => {
  expect(measure(tiny, { what: 'distance', a: part('R1'), b: part('U1') })).toEqual({ value: 5, unit: 'mm', said: 'distance R1 to U1: 5.00 mm' })
})

it('measures a net: length, widths, area and vias', () => {
  expect(measure(tiny, { what: 'length', net: 'A' }).said).toBe('length of A: 9.25 mm of track in 3 pieces')
  expect(measure(tiny, { what: 'width', net: 'A' }).said).toBe('width of A: min 0.25, max 0.25 mm over 3 segments')
  expect(measure(tiny, { what: 'width', net: 'GND' })).toEqual({ value: 0, unit: 'mm', said: 'width of GND: it has no track yet' })
  const area = measure(tiny, { what: 'area', net: 'GND', layer: 'B.Cu' })
  expect(area.unit).toBe('mm²')
  expect(area.value).toBeCloseTo(19 * 4 + 1.475 * 0.6, 1)
  expect(area.said).toContain('copper of GND on bottom copper: ')
  expect(measure(tiny, { what: 'vias', net: 'A' })).toEqual({ value: 1, unit: 'vias', said: 'vias on A: 1' })
  expect(measure(tiny, { what: 'vias' }).said).toBe('vias on the board: 1')
})

it('measures how near the board edge a thing comes', () => {
  const edge = measure(tiny, { what: 'edge', a: part('R1') })
  expect(edge.value).toBeCloseTo(100 - 0.46 - 95, 4)
  expect(edge.said).toBe('R1 is 4.54 mm from the board edge, at its nearest')
})

it('refuses what is not on the board, in words', () => {
  expect(() => measure(tiny, { what: 'distance', a: part('R9'), b: part('U1') })).toThrow('R9 is not on this board')
  expect(() => measure(tiny, { what: 'length', net: 'NOPE' })).toThrow('there is no net NOPE')
})
