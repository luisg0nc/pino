import { describe, expect, it } from 'vitest'
import { readBoard } from '../../shared/board/board'
import { circuitOf } from '../../shared/circuit'
import { sheetOf } from '../../shared/sheet'
import { fx, read, readJson } from '../../test/fixtures'
import { point, stroke } from '../../test/marks'
import { contentBox, inkSvg, KICAD_COLOURS, netShapes, sheetChipAt, sheetMarks, sheetTargetAt, sheetWords, viewBoxOf } from './ink'

const sheet = sheetOf(readJson(fx('sheet.json')))!
const circuit = circuitOf(readJson(fx('circuit.json')))!
const board = readBoard(read(fx('filled/board.kicad_pcb')))
const u2 = sheet.symbols.find((s) => s.ref === 'U2')!
const vin = u2.pins.find((p) => p.name === 'VIN')!

describe('the sheet in pino ink', () => {
  it("recolours the reference sheet to the ink and leaves none of KiCad's colours", () => {
    const svg = read(fx('schematic.svg'))
    const out = inkSvg(svg)
    for (const k of Object.keys(KICAD_COLOURS)) expect(out.toUpperCase()).not.toContain(k.toUpperCase())
    expect(out).toContain('var(--sch-ink)')
    expect(out).toContain('var(--sch-wire)')
    expect(out.startsWith('<svg')).toBe(true)
    expect(out).toMatch(/^<svg[^>]*\swidth="100%" height="100%"/)
    expect(out).not.toContain('<title>')
    expect(viewBoxOf(out)).toEqual(viewBoxOf(svg))
  })

  it('knows every colour the export of the reference sheet uses', () => {
    const used = new Set([...read(fx('schematic.svg')).matchAll(/(?:fill|stroke):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1].toUpperCase()))
    expect([...used].filter((c) => !(c in KICAD_COLOURS))).toEqual([])
  })

  // The picture stands in the window's own page: a style in it would restyle the window, a permission card included.
  it('keeps nothing that could restyle the window or reach out of the picture', () => {
    const inked = inkSvg(
      '<svg><style>.ask{display:none}</style><style/><g onclick=y() onfocus = "z()"/><image/onerror=alert(1) href="https://example.org/x.png"/>' +
        '<a xlink:href="&#106;avascript:z()"><use href="#symbol"/></a><iframe src=x></iframe><img src="x"></svg>'
    )
    expect(inked).not.toMatch(/<(style|iframe|img|image)|onclick|onfocus|onerror|example\.org|avascript/i)
    expect(inked).toContain('<use href="#symbol"/>')
  })

  it('strips scripts and event attributes', () => {
    expect(inkSvg('<svg><script>x()</script><g onclick="y()"/></svg>')).toBe('<svg width="100%" height="100%"><g/></svg>')
    expect(inkSvg('<?xml version="1.0"?>\n<svg width="10mm" height="5mm"><script/><a href="javascript:z()"><g onLoad=\'a()\'></g></a><foreignObject><div/></foreignObject></svg>')).toBe(
      '<svg width="100%" height="100%"><a><g></g></a></svg>'
    )
  })

  it("reads the sheet's size from its view box", () => {
    expect(viewBoxOf(read(fx('schematic.svg')))).toEqual([0, 0, 419.989, 297.0022])
  })

  it('finds what the sheet holds, with a margin, to fit the view to', () => {
    const box = contentBox(sheet)
    for (const f of sheet.frames) {
      expect(box.x0).toBeLessThan(f.x0)
      expect(box.y1).toBeGreaterThan(f.y1)
    }
    expect(box.x1 - box.x0).toBeLessThan(sheet.paper.width)
  })
})

describe('what is clicked on the sheet', () => {
  it('finds a pin before its wire, and a symbol by its box', () => {
    expect(sheetTargetAt(sheet, { x: vin.x + 0.3, y: vin.y })).toEqual({ kind: 'pad', ref: 'U2', number: vin.number })
    expect(sheetTargetAt(sheet, { x: (u2.x0 + u2.x1) / 2, y: (u2.y0 + u2.y1) / 2 })).toEqual({ kind: 'part', ref: 'U2' })
  })

  it('finds a net by its wire, its label or its power symbol', () => {
    const pins = sheet.symbols.flatMap((s) => s.pins)
    const wire = sheet.wires.find((w) => {
      const mid = { x: (w.a[0] + w.b[0]) / 2, y: (w.a[1] + w.b[1]) / 2 }
      return pins.every((p) => Math.hypot(p.x - mid.x, p.y - mid.y) > 2) // out of every pin's reach, 0.4 mm off too
    })!
    expect(sheetTargetAt(sheet, { x: (wire.a[0] + wire.b[0]) / 2, y: (wire.a[1] + wire.b[1]) / 2 + 0.4 })).toEqual({ kind: 'net', name: wire.net })
    const label = sheet.labels.find((l) => pins.every((p) => Math.hypot(p.x - l.x, p.y - l.y) > 1.2))!
    expect(sheetTargetAt(sheet, { x: label.x, y: label.y })).toEqual({ kind: 'net', name: label.net })
  })

  it('finds nothing on bare paper', () => {
    expect(sheetTargetAt(sheet, { x: 1, y: 1 })).toBeNull()
  })

  it('takes everything a net is drawn with: wires, names and power symbols', () => {
    const shapes = netShapes(sheet, 'GND')
    expect(shapes.wires.length).toBeGreaterThan(0)
    expect(shapes.spots.length).toBeGreaterThan(0)
    expect(shapes.pins.length).toBeGreaterThan(0)
    expect(netShapes(sheet, 'NOPE')).toEqual({ wires: [], spots: [], pins: [] })
  })
})

describe('the words beside what is selected', () => {
  it('says a part, its footprint and what its pins carry', () => {
    const words = sheetWords(board, circuit, { kind: 'part', ref: 'U2' })
    expect(words.head).toBe('U2 AP2112K-3.3')
    expect(words.lines).toEqual(['SOT-23-5', '5 pins, 4 used · VBUS, GND, +3V3'])
  })

  it('says a pin and its net, and a net and its pins', () => {
    expect(sheetWords(board, circuit, { kind: 'pad', ref: 'U2', number: vin.number })).toEqual({ head: 'U2.1 VIN', lines: ['net VBUS'] })
    expect(sheetWords(board, circuit, { kind: 'net', name: 'VBUS' })).toEqual({ head: 'net VBUS', lines: ['6 pins: F1.2, R9.2, C1.1, C3.1, U2.1, U2.3'] })
  })
})

describe('marks on the sheet', () => {
  it('draws the point marks whose target the sheet has, and puts their chips on them', () => {
    const marks = [
      point({ id: 'M1', target: { kind: 'part', ref: 'U2' } }),
      point({ id: 'M2', space: 'sheet', target: { kind: 'net', name: 'VBUS' }, at: { x: 100, y: 60 } }),
      point({ id: 'M3', target: { kind: 'track', uuid: 'x' } }),
      point({ id: 'M4', target: { kind: 'part', ref: 'R99' } }),
      stroke({ id: 'M5' }),
      point({ id: 'M6', target: { kind: 'part', ref: 'U2' }, status: 'resolved' })
    ]
    expect(sheetMarks(sheet, marks).map((m) => m.id)).toEqual(['M1', 'M2'])
    expect(sheetChipAt(sheet, marks[0] as never)).toEqual({ x: u2.x1, y: u2.y0 })
    expect(sheetChipAt(sheet, marks[1] as never)).toEqual({ x: 100, y: 60 })
    expect(sheetChipAt(sheet, point({ target: { kind: 'pad', ref: 'U2', number: vin.number } }))).toMatchObject({ x: vin.x, y: vin.y })
  })
})
