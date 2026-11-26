// KiCad's schematic picture in pino's ink, and what is where on it. Pure string and number work: the SVG's colours
// become the tokens, and the hit test is over sheet.json (pino wrote the sheet, so it knows where everything is).

import type { Board } from '../../shared/board/board'
import { distToSeg, type BBox, type Pt } from '../../shared/board/geom'
import { netMembers, shortLabel, type Target } from '../../shared/board/refs'
import type { Circuit } from '../../shared/circuit'
import type { Mark, PointMark } from '../../shared/marks'
import { netShapes, sheetPlace, type Sheet, type SheetSpot } from '../../shared/sheet'

export { netShapes, sheetPlace }

/** KiCad's colours in the export, and the ink each becomes (the design mocks' map). */
export const KICAD_COLOURS: Record<string, string> = {
  '#840000': 'var(--sch-ink)',
  '#FFFFC2': 'var(--sch-fill)',
  '#009600': 'var(--sch-wire)',
  '#006464': 'var(--sch-net)',
  '#A90000': 'var(--sch-pin)',
  '#0000C2': 'var(--sch-block)',
  '#000084': 'var(--sch-block)',
  '#DC090D': 'var(--fail)',
  '#9B9B98': 'var(--sch-dnp)',
  '#939390': 'var(--sch-dnp)',
  '#F5F4EF': 'var(--sch-paper)',
  '#000000': 'var(--sch-ink)'
}

const COLOUR = new RegExp(Object.keys(KICAD_COLOURS).join('|'), 'gi')

/**
 * The export ready to stand in the page: recoloured, as large as its box, without its title, and with nothing in it
 * that runs or reaches out (scripts, event attributes, script links, embedded pages).
 */
export function inkSvg(svg: string): string {
  const from = svg.indexOf('<svg')
  const body = (from < 0 ? svg : svg.slice(from))
    .replace(/<title\b[\s\S]*?<\/title>/gi, '')
    .replace(/<(script|foreignObject)\b[^>]*\/>/gi, '')
    .replace(/<(script|foreignObject)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '')
    .replace(COLOUR, (c) => KICAD_COLOURS[c.toUpperCase()])
  return body.replace(/^<svg\b([^>]*)>/, (_, attributes: string) => `<svg${attributes.replace(/\s(width|height)\s*=\s*"[^"]*"/g, '')} width="100%" height="100%">`)
}

export function viewBoxOf(svg: string): [number, number, number, number] {
  const found = /viewBox\s*=\s*"([^"]+)"/.exec(svg)
  const values = found?.[1].trim().split(/[\s,]+/).map(Number)
  return values?.length === 4 && values.every(Number.isFinite) ? (values as [number, number, number, number]) : [0, 0, 297, 210]
}

const MARGIN = 3 // sheet mm kept round the blocks

/** The part of the paper that holds the drawing: the blocks' frames, or the whole paper without any. */
export function contentBox(sheet: Sheet): BBox {
  if (!sheet.frames.length) return { x0: 0, y0: 0, x1: sheet.paper.width, y1: sheet.paper.height }
  return {
    x0: Math.min(...sheet.frames.map((f) => f.x0)) - MARGIN,
    y0: Math.min(...sheet.frames.map((f) => f.y0)) - MARGIN,
    x1: Math.max(...sheet.frames.map((f) => f.x1)) + MARGIN,
    y1: Math.max(...sheet.frames.map((f) => f.y1)) + MARGIN
  }
}

const PIN_REACH = 1.0 // mm
const NET_REACH = 0.6

const nearest = <T>(items: T[], away: (item: T) => number, within: number): T | null => {
  let best: T | null = null
  let least = within
  for (const item of items) {
    const d = away(item)
    if (d <= least) {
      least = d
      best = item
    }
  }
  return best
}

const from = (p: Pt) => (q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y)

/** What a click at `p` (sheet mm) takes: a pin first, then a net by its wire, name or power symbol, then a symbol. */
export function sheetTargetAt(sheet: Sheet, p: Pt): Target | null {
  const pins = sheet.symbols.flatMap((s) => s.pins.map((pin) => ({ ref: s.ref, ...pin })))
  const pin = nearest(pins, from(p), PIN_REACH)
  if (pin) return { kind: 'pad', ref: pin.ref, number: pin.number }
  const wire = nearest(sheet.wires, (w) => distToSeg(p, { x: w.a[0], y: w.a[1] }, { x: w.b[0], y: w.b[1] }), NET_REACH)
  const spot = wire ?? nearest<SheetSpot>([...sheet.labels, ...sheet.power], from(p), NET_REACH)
  if (spot) return { kind: 'net', name: spot.net }
  const inside = sheet.symbols.filter((s) => p.x >= s.x0 && p.x <= s.x1 && p.y >= s.y0 && p.y <= s.y1)
  const smallest = inside.sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0]
  return smallest ? { kind: 'part', ref: smallest.ref } : null
}

const MOST_NETS = 5
const MOST_PINS = 12

/** The tag's words for what is selected on the sheet: a first line, and what adds to it. */
export function sheetWords(board: Board, circuit: Circuit | null, target: Target): { head: string; lines: string[] } {
  if (target.kind === 'net') {
    const members = netMembers(board, circuit, target.name)
    const said = members.slice(0, MOST_PINS).map((m) => `${m.ref}.${m.number}`)
    if (members.length > MOST_PINS) said.push(`and ${members.length - MOST_PINS} more`)
    return { head: `net ${target.name}`, lines: [`${members.length} pin${members.length === 1 ? '' : 's'}: ${said.join(', ')}`] }
  }
  if (target.kind === 'part') {
    const part = circuit?.parts.find((p) => p.ref === target.ref)
    if (!part) return { head: target.ref, lines: [] }
    const nets = part.pins.map((p) => circuit!.nets.find((n) => n.pins.some(([r, number]) => r === part.ref && number === p.number))?.name)
    const used = nets.filter(Boolean)
    const named = [...new Set(used)] as string[]
    const list = named.slice(0, MOST_NETS).join(', ') + (named.length > MOST_NETS ? `, +${named.length - MOST_NETS}` : '')
    const footprint = part.footprint.slice(part.footprint.indexOf(':') + 1)
    return {
      head: `${part.ref} ${part.value}`,
      lines: [[footprint, part.lcsc && `LCSC ${part.lcsc}`, part.dnp && 'not placed'].filter(Boolean).join(' · '), `${part.pins.length} pins, ${used.length} used · ${list}`]
    }
  }
  if (target.kind === 'pad') {
    const pin = circuit?.parts.find((p) => p.ref === target.ref)?.pins.find((p) => p.number === target.number)
    const net = circuit?.nets.find((n) => n.pins.some(([r, number]) => r === target.ref && number === target.number))
    const name = pin && pin.name !== '~' && pin.name !== pin.number ? ` ${pin.name}` : ''
    return { head: `${target.ref}.${target.number}${name}`, lines: [net ? `net ${net.name}` : 'not connected'] }
  }
  return { head: shortLabel(board, target), lines: [] }
}

/** The marks the sheet can show: open point marks on a part, pin or net it draws. */
export function sheetMarks(sheet: Sheet, marks: readonly Mark[]): PointMark[] {
  return marks.filter((m): m is PointMark => m.kind === 'point' && m.status !== 'resolved' && sheetPlace(sheet, m.target) !== null)
}

/** Where a mark's chip stands on the sheet: a part's top right corner, a pin, or where the net was pointed at. */
export function sheetChipAt(sheet: Sheet, mark: PointMark): Pt | null {
  if (mark.space === 'sheet' && mark.target.kind === 'net') return mark.at
  if (mark.target.kind === 'part') {
    const ref = mark.target.ref
    const symbol = sheet.symbols.find((s) => s.ref === ref)
    return symbol ? { x: symbol.x1, y: symbol.y0 } : null
  }
  const at = sheetPlace(sheet, mark.target)
  return at && { x: at.x, y: at.y }
}
