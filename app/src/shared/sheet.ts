// The schematic as data (pino.sheet/1, kernel/schema/sheet-1.schema.json): sheet millimetres, origin top left, y
// down, which are the units of the schematic's SVG. It is the views' hit-test layer over that picture.

import type { Pt } from './board/geom'
import type { Target } from './board/refs'
import { isRecord } from './build'

export interface SheetPin {
  number: string
  name: string
  /** Null for a pin left open. */
  net: string | null
  x: number
  y: number
}

export interface SheetSymbol {
  ref: string
  x0: number
  y0: number
  x1: number
  y1: number
  pins: SheetPin[]
}

export interface SheetSpot {
  net: string
  x: number
  y: number
}

export interface SheetFrame {
  key: string
  title: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Sheet {
  schema: 'pino.sheet/1'
  paper: { name: string; width: number; height: number }
  symbols: SheetSymbol[]
  power: SheetSpot[]
  wires: Array<{ net: string; a: [number, number]; b: [number, number] }>
  labels: Array<SheetSpot & { global: boolean }>
  frames: SheetFrame[]
}

const numbers = (v: unknown, keys: string[]) => isRecord(v) && keys.every((k) => typeof v[k] === 'number')
const box = ['x0', 'y0', 'x1', 'y1']

export function sheetOf(value: unknown): Sheet | null {
  if (!isRecord(value) || value.schema !== 'pino.sheet/1' || !isRecord(value.paper)) return null
  const { symbols, power, wires, labels, frames } = value
  const lists = [symbols, power, wires, labels, frames]
  if (!lists.every(Array.isArray)) return null
  const ok =
    (symbols as unknown[]).every((s) => numbers(s, box) && typeof (s as { ref?: unknown }).ref === 'string' && Array.isArray((s as { pins?: unknown }).pins)) &&
    (power as unknown[]).every((p) => numbers(p, ['x', 'y'])) &&
    (wires as unknown[]).every((w) => isRecord(w) && typeof w.net === 'string' && Array.isArray(w.a) && Array.isArray(w.b)) &&
    (labels as unknown[]).every((l) => numbers(l, ['x', 'y'])) &&
    (frames as unknown[]).every((f) => numbers(f, box))
  return ok ? (value as unknown as Sheet) : null
}

/** Everything a net is drawn with on the sheet. */
export function netShapes(sheet: Sheet, net: string): { wires: Sheet['wires']; spots: SheetSpot[]; pins: SheetPin[] } {
  return {
    wires: sheet.wires.filter((w) => w.net === net),
    spots: [...sheet.labels, ...sheet.power].filter((s) => s.net === net),
    pins: sheet.symbols.flatMap((s) => s.pins.filter((p) => p.net === net))
  }
}

/** Where on the sheet a target is, sheet mm, or null when the sheet does not draw it. */
export function sheetPlace(sheet: Sheet, target: Target): Pt | null {
  if (target.kind === 'part' || target.kind === 'pad') {
    const symbol = sheet.symbols.find((s) => s.ref === target.ref)
    if (!symbol) return null
    if (target.kind === 'pad') return symbol.pins.find((p) => p.number === target.number) ?? null
    return { x: (symbol.x0 + symbol.x1) / 2, y: (symbol.y0 + symbol.y1) / 2 }
  }
  if (target.kind === 'net') {
    const { pins, spots } = netShapes(sheet, target.name)
    const at = pins[0] ?? spots[0]
    return at ? { x: at.x, y: at.y } : null
  }
  return null
}
