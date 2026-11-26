import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fx, read, tinyBoard } from '../../test/fixtures'
import { readBoard } from './board'

const tiny = readBoard(tinyBoard())
const reference = () => readBoard(read(fx('filled/board.kicad_pcb')))
const fp = (board: ReturnType<typeof readBoard>, ref: string) => board.footprints.find((f) => f.ref === ref)!

describe('reading a board', () => {
  it('reads the tiny board: parts, pads, tracks, an arc, a via and a zone', () => {
    expect(tiny.footprints.map((f) => f.ref).sort()).toEqual(['R1', 'U1'])
    expect(fp(tiny, 'R1').pads.map((p) => p.net)).toEqual(['A', 'GND'])
    expect(fp(tiny, 'U1').side).toBe('B')
    expect(tiny.tracks).toHaveLength(3)
    expect(tiny.tracks.filter((t) => t.arc)).toHaveLength(1)
    expect(tiny.vias).toHaveLength(1)
    expect(tiny.zones.filter((z) => !z.keepout && !z.teardrop)).toHaveLength(1)
    expect(tiny.nets).toEqual(['A', 'GND'])
    expect(tiny.copper).toEqual(['F.Cu', 'B.Cu'])
    expect(tiny.box).toEqual({ x0: 90, y0: 95, x1: 110, y1: 105 })
  })

  it('says how thick the board and its copper are', () => {
    expect(reference().thickness).toBe(1.6)
    expect(reference().copperUm).toBe(35)
  })

  it('takes the courtyard as the outline of a part, and says where an outline came from', () => {
    const r1 = fp(tiny, 'R1')
    expect(r1.outlineFrom).toBe('courtyard')
    expect([r1.box.x0, r1.box.y0, r1.box.x1, r1.box.y1].map((v) => +v.toFixed(4))).toEqual([99.09, 99.54, 100.91, 100.46])
    expect(fp(reference(), 'U2').outlineFrom).toBe('courtyard')
  })

  it('follows a courtyard that is not a box', () => {
    const lines = [[0, 0, 4, 0], [4, 0, 4, 1], [4, 1, 1, 1], [1, 1, 1, 3], [1, 3, 0, 3], [0, 3, 0, 0]]
      .map(([a, b, c, d]) => `(fp_line (start ${a} ${b}) (end ${c} ${d}) (stroke (width 0.05)) (layer "F.CrtYd") (uuid "x"))`)
      .join('')
    const board = readBoard(`(kicad_pcb (layers (0 "F.Cu" signal) (2 "B.Cu" signal)) (footprint "a:L" (layer "F.Cu") (uuid "u") (at 10 10) (property "Reference" "L1") ${lines}))`)
    expect(board.footprints[0].outline).toHaveLength(6)
    expect(board.footprints[0].outline).toContainEqual({ x: 11, y: 11 })
  })

  it('names a part with no usable reference by its uuid, and unescapes net names once', () => {
    const board = readBoard(
      '(kicad_pcb (layers (0 "F.Cu" signal) (2 "B.Cu" signal))' +
        ' (footprint "a:b" (layer "F.Cu") (uuid "12345678-9abc") (at 0 0) (property "Reference" "REF**"))' +
        ' (footprint "a:b" (layer "F.Cu") (uuid "abcdef01-2345") (at 1 1) (property "Reference" ""))' +
        ' (segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net "/IO{slash}PUSH{brace}slash}") (uuid "s")))'
    )
    expect(board.footprints.map((f) => f.ref)).toEqual(['footprint 12345678', 'footprint abcdef01'])
    expect(board.tracks[0].net).toBe('/IO/PUSH{slash}')
    expect(board.nets).toEqual(['/IO/PUSH{slash}'])
  })

  it('refuses a file that is not a board', () => {
    expect(() => readBoard('(kicad_sch)')).toThrow('not a kicad_pcb file')
  })

  it('touches nothing of a browser, so main can use it too', () => {
    const dir = __dirname
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      expect(readFileSync(join(dir, name), 'utf8'), name).not.toMatch(/\b(Path2D|DOMMatrix|document|window)\b/)
    }
  })
})
