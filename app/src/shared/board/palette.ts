// The net colours, off unless the person turns them on. No hue lies from 235 to 285 degrees: that is the violet of
// the person's marks, which must stay apart from any copper (palette.test.ts).

import type { NetKind } from '../circuit'
import { naturalCompare } from './nets'

export const SIGNAL_COLOURS = ['#2E6DB4', '#5F7F1F', '#B0478C', '#1F8F86', '#7C6A0E', '#3E5FA8', '#4E8A2E', '#A44C7E', '#2A7FA8', '#6B7A16'] as const
export const SUPPLY_COLOURS = ['#1E7F8C', '#8A6D12', '#9A3F86'] as const

/** In the dark each colour is mixed 62 % with 38 % white. */
const DARK_KEEP = 0.62

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const hex = (values: number[]): string => `#${values.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

/** The hue of a `#rrggbb` colour, degrees. */
export function hueOf(colour: string): number {
  const [r, g, b] = channels(colour)
  const most = Math.max(r, g, b)
  const span = most - Math.min(r, g, b)
  if (!span) return 0
  const sixth = most === r ? ((g - b) / span + 6) % 6 : most === g ? (b - r) / span + 2 : (r - g) / span + 4
  return sixth * 60
}

/**
 * A net's colour, or null for ground, which is drawn as the ratsnest is. `signals` and `supplies` are the board's
 * nets of those kinds: each net takes the colour of its place among them in natural order.
 */
export function netColour(net: string, kind: NetKind, signals: readonly string[], dark: boolean, supplies: readonly string[] = []): string | null {
  if (kind === 'gnd') return null
  const [names, colours] = kind === 'supply' ? [supplies, SUPPLY_COLOURS] : [signals, SIGNAL_COLOURS]
  const place = Math.max(0, [...names].sort(naturalCompare).indexOf(net))
  const colour = colours[place % colours.length]
  return dark ? hex(channels(colour).map((c) => c * DARK_KEEP + 255 * (1 - DARK_KEEP))) : colour
}
