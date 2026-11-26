import { expect, it } from 'vitest'
import { hueOf, netColour, SIGNAL_COLOURS, SUPPLY_COLOURS } from './palette'

const outside = (h: number) => h < 235 || h > 285
const signals = SIGNAL_COLOURS.map((_, i) => `S${i}`)
const supplies = ['+3V3', 'VBUS', 'VBUS_IN']

it("keeps every net colour out of the marks' violet hues", () => {
  expect(hueOf('#6440C4')).toBeGreaterThan(250) // the person's violet itself, as a check of the measure
  expect(hueOf('#6440C4')).toBeLessThan(265)
  for (const c of [...SIGNAL_COLOURS, ...SUPPLY_COLOURS]) expect(outside(hueOf(c)), c).toBe(true)
  for (const n of signals) expect(outside(hueOf(netColour(n, 'signal', signals, true)!)), n).toBe(true)
  for (const n of supplies) expect(outside(hueOf(netColour(n, 'supply', signals, true, supplies)!)), n).toBe(true)
})

it('gives signals their colours in the order of their names, supplies theirs in turn, and ground none', () => {
  expect(signals.map((n) => netColour(n, 'signal', signals, false))).toEqual([...SIGNAL_COLOURS])
  expect(netColour('S10', 'signal', [...signals, 'S10'], false)).toBe(SIGNAL_COLOURS[0])
  expect(supplies.map((n) => netColour(n, 'supply', signals, false, supplies))).toEqual([...SUPPLY_COLOURS])
  expect(netColour('GND', 'gnd', signals, false)).toBeNull()
})

it('lightens a colour for the dark theme by mixing it with white', () => {
  expect(netColour('S0', 'signal', signals, true)).toBe('#7da4d1') // 62 % of #2E6DB4 (46, 109, 180), 38 % white
})
