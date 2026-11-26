import { expect, it } from 'vitest'
import { at, mm, ORIGIN, toBoard, toKicad } from './coords'

it('converts frames as the kernel does', () => {
  expect(ORIGIN).toEqual([100, 100])
  expect(toBoard({ x: 130, y: 90 })).toEqual({ x: 30, y: 10 })
  expect(toKicad(toBoard({ x: 101.5, y: 97.25 }))).toEqual({ x: 101.5, y: 97.25 })
})

it('says millimetres with two decimals and no negative zero', () => {
  expect(mm(-0.001)).toBe('0.00')
  expect(mm(12.345)).toBe('12.35')
  expect(mm(-3)).toBe('-3.00')
  expect(at({ x: -0.0004, y: 2.5 })).toBe('(0.00, 2.50)')
})
