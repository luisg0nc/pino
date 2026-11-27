import { expect, it } from 'vitest'
import { dollars, tokens } from './format'

it('writes a count of tokens to three digits, in k and M', () => {
  expect(tokens(742)).toBe('742')
  expect(tokens(14_200)).toBe('14.2 k')
  expect(tokens(742_000)).toBe('742 k')
  expect(tokens(999_900)).toBe('1 M')
  expect(tokens(1_180_000)).toBe('1.18 M')
  expect(tokens(26_300_000)).toBe('26.3 M')
})

it('writes dollars to the cent, and a cost under a cent as under one', () => {
  expect(dollars(0.64)).toBe('$0.64')
  expect(dollars(10.8)).toBe('$10.80')
  expect(dollars(0)).toBe('$0')
  expect(dollars(0.004)).toBe('under $0.01')
  expect(dollars(123.456)).toBe('$123')
})
