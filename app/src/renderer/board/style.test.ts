import { expect, it } from 'vitest'
import { read } from '../../test/fixtures'
import { copperColour, mix, type BoardColours } from './style'

const css = read('src/renderer/styles/tokens.css')
const token = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css)![1].trim()
const LIGHT: BoardColours = {
  paper: token('--board-paper'),
  cu: token('--cu'),
  cuFar: token('--cu-far'),
  hatch: token('--hatch'),
  hatchFar: token('--hatch-far'),
  silk: token('--silk'),
  rat: token('--rat'),
  accent: token('--accent'),
  accentWash: token('--accent-wash'),
  warn: token('--warn'),
  fail: token('--fail'),
  muted: token('--muted'),
  userMark: token('--user-mark'),
  agentMark: token('--agent-mark')
}
const none = () => null
const plain = { active: true, throughHole: false, net: 'A', netColours: false, stale: false }

it('draws copper by the drafting rules', () => {
  expect(copperColour(plain, LIGHT, none)).toBe('#2A2F37')
  expect(copperColour({ ...plain, active: false }, LIGHT, none)).toBe('#CBC6BC')
  expect(copperColour({ ...plain, active: false, throughHole: true }, LIGHT, none)).toBe('#2A2F37')
  expect(copperColour({ ...plain, netColours: true }, LIGHT, () => '#2E6DB4')).toBe('#2E6DB4')
})

it('colours nets only on the layer being looked at, and only copper a net has a colour for', () => {
  expect(copperColour({ ...plain, active: false, netColours: true }, LIGHT, () => '#2E6DB4')).toBe('#CBC6BC')
  expect(copperColour({ ...plain, netColours: true }, LIGHT, none)).toBe('#2A2F37')
})

it('fades stale copper toward the paper, never by alpha', () => {
  expect(copperColour({ ...plain, stale: true }, LIGHT, none)).toBe(mix('#2A2F37', LIGHT.paper, 0.4))
  expect(mix('#000000', '#ffffff', 0.4)).toBe('color-mix(in srgb, #000000 40%, #ffffff)')
})
