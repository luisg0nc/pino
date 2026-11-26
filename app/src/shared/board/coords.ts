// The one converter between the board file's frame (KiCad's page millimetres, y down) and pino's board frame, which
// everything a person or Claude reads is in: millimetres, origin at the outline centre, x right, y up. The same
// ORIGIN as kernel/src/pino_kernel/coords.py. Angles are the same number in both frames.

import type { Pt } from './geom'

export const ORIGIN = [100, 100] as const

// Rounded to a nanometre, far below what the file holds, so that a conversion and back gives the same numbers.
const exact = (v: number): number => Math.round(v * 1e6) / 1e6 || 0

export const toBoard = (p: Pt): Pt => ({ x: exact(p.x - ORIGIN[0]), y: exact(ORIGIN[1] - p.y) })
export const toKicad = (p: Pt): Pt => ({ x: exact(p.x + ORIGIN[0]), y: exact(ORIGIN[1] - p.y) })

/** Millimetres as pino says them: two decimals, and never `-0.00`. */
export function mm(v: number): string {
  const text = v.toFixed(2)
  return text === '-0.00' ? '0.00' : text
}

/** A place in the board frame, as pino says it. */
export const at = (p: Pt): string => `(${mm(p.x)}, ${mm(p.y)})`
