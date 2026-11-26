import { describe, expect, it } from 'vitest'
import { fx, read, readJson, tinyBoard } from '../../test/fixtures'
import { circuitOf } from '../circuit'
import { readBoard, type Pad } from './board'
import { at, toBoard, toKicad } from './coords'
import { hitTest, Index } from './hit'
import { centreOf, crossings, describeTarget, findTarget, layerWords, shortLabel, targetOf, type Target } from './refs'

const tiny = readBoard(tinyBoard())
const reference = readBoard(read(fx('filled/board.kicad_pcb')))
const circuit = circuitOf(readJson(fx('circuit.json')))!
const U = '00000000-0000-4000-8000-'
const arc = tiny.tracks.find((t) => t.arc)!
const via = tiny.vias[0]
const zone = tiny.zones[0]

describe('the exact reference', () => {
  it('gives the exact pad reference of the reference board', () => {
    const pad = findTarget(reference, { kind: 'pad', ref: 'U2', number: '1' }) as Pad
    expect(describeTarget(reference, circuit, { kind: 'pad', ref: 'U2', number: '1' })).toBe(
      `pad U2.1 · VIN · net VBUS · top copper · at ${at(toBoard(pad.center))} mm`
    )
  })

  it('says a part with its value, footprint, position, turn and side', () => {
    expect(describeTarget(tiny, null, { kind: 'part', ref: 'R1' })).toBe('part R1 · 10k · R_0402_1005Metric · at (0.00, 0.00) mm · rot 0° · top')
    expect(describeTarget(tiny, null, { kind: 'part', ref: 'U1' })).toBe('part U1 · ESD · SOT-23 · at (5.00, 0.00) mm · rot 0° · bottom')
  })

  it("takes a pin's name from the board file when no circuit names it, and says when it has none", () => {
    expect(describeTarget(tiny, null, { kind: 'pad', ref: 'U1', number: '2' })).toBe('pad U1.2 · IO · net A · bottom copper · at (4.06, 0.95) mm')
    expect(describeTarget(tiny, null, { kind: 'pad', ref: 'R1', number: '1' })).toBe('pad R1.1 · net A · top copper · at (-0.48, 0.00) mm')
    expect(describeTarget(tiny, null, { kind: 'pad', ref: 'U1', number: '3' })).toBe('pad U1.3 · no net · bottom copper · at (5.94, 0.00) mm')
  })

  it('says a through-hole pad goes through', () => {
    const pad = reference.footprints.flatMap((f) => f.pads).find((p) => p.kind === 'thru_hole' && p.net)!
    expect(describeTarget(reference, circuit, { kind: 'pad', ref: pad.fp.ref, number: pad.number })).toContain(' · through · at (')
  })

  it('says a net by its members, in the circuit order, with the pin names the symbol gives', () => {
    expect(describeTarget(reference, circuit, { kind: 'net', name: 'VBUS' })).toBe('net VBUS · 6 pins: F1.2, R9.2, C1.1, C3.1, U2.1 VIN, U2.3 EN')
    const gnd = describeTarget(reference, circuit, { kind: 'net', name: 'GND' })
    expect(gnd).toMatch(/^net GND · \d+ pins: /)
    expect(gnd).toMatch(/, and \d+ more$/)
    expect(gnd.split(', ')).toHaveLength(25)
    expect(describeTarget(tiny, null, { kind: 'net', name: 'A' })).toBe('net A · 2 pins: R1.1, U1.2 IO')
  })

  it('says a track with its full uuid and width', () => {
    const said = describeTarget(tiny, null, { kind: 'track', uuid: arc.uuid })
    expect(said.startsWith('track · top copper · net A · 0.25 mm wide · from (')).toBe(true)
    expect(said).toBe(`track · top copper · net A · 0.25 mm wide · from (-0.48, 3.00) to (0.52, 4.00) through (-0.19, 3.71) mm · uuid ${arc.uuid}`)
    expect(arc.uuid.startsWith(U)).toBe(true)
  })

  it('says a via and a zone', () => {
    expect(describeTarget(tiny, null, { kind: 'via', uuid: via.uuid })).toBe(`via · net A · top to bottom copper · at (4.06, 0.95) mm · 0.60 mm, drill 0.30 · uuid ${via.uuid}`)
    expect(describeTarget(tiny, null, { kind: 'zone', uuid: zone.uuid, at: { x: -5, y: -3 } })).toBe(
      `zone · net GND · bottom copper · x -9.50 to 9.50, y -4.50 to -0.50 mm · clicked (-5.00, -3.00) mm · uuid ${zone.uuid}`
    )
  })

  it('names layers in words', () => {
    expect(['F.Cu', 'B.Cu', 'In1.Cu', 'In2.Cu', 'F.SilkS'].map(layerWords)).toEqual(['top copper', 'bottom copper', 'inner copper 1', 'inner copper 2', 'F.SilkS'])
  })

  it('labels a thing shortly', () => {
    const targets: Target[] = [
      { kind: 'part', ref: 'U1' },
      { kind: 'pad', ref: 'U1', number: '2' },
      { kind: 'net', name: 'A' },
      { kind: 'track', uuid: arc.uuid },
      { kind: 'via', uuid: via.uuid },
      { kind: 'zone', uuid: zone.uuid, at: { x: 0, y: 0 } }
    ]
    expect(targets.map((t) => shortLabel(tiny, t))).toEqual(['U1', 'U1.2', 'A', 'track A', 'via A', 'zone GND'])
  })

  it('turns a hit into a target that finds the same thing again', () => {
    const hits = hitTest(new Index(tiny), { x: 99.52, y: 100 }, { visible: new Set(['F.Cu']), active: 'F.Cu', tol: 0.1 })
    const targets = hits.map((h) => targetOf(h, { x: 99.52, y: 100 }))
    expect(targets).toEqual([{ kind: 'pad', ref: 'R1', number: '1' }, { kind: 'track', uuid: tiny.tracks[0].uuid }, { kind: 'part', ref: 'R1' }])
    hits.forEach((h, i) => expect(findTarget(tiny, targets[i])).toBe(h.target))
    const inZone = { x: 95, y: 103 }
    const zoneHit = hitTest(new Index(tiny), inZone, { visible: new Set(['B.Cu']), active: 'B.Cu', tol: 0.1 })[0]
    expect(targetOf(zoneHit, inZone)).toEqual({ kind: 'zone', uuid: zone.uuid, at: { x: -5, y: -3 } })
  })

  it('knows where a thing is, and says when it is not on the board', () => {
    expect(centreOf(tiny, { kind: 'part', ref: 'U1' })).toEqual({ x: 5, y: 0 })
    expect(centreOf(tiny, { kind: 'via', uuid: via.uuid })!.x).toBeCloseTo(4.0625, 6)
    expect(centreOf(tiny, { kind: 'net', name: 'A' })).not.toBeNull()
    expect(centreOf(tiny, { kind: 'part', ref: 'R9' })).toBeNull()
    expect(centreOf(tiny, { kind: 'net', name: 'NOPE' })).toBeNull()
    expect(findTarget(tiny, { kind: 'track', uuid: 'nope' })).toBeNull()
    expect(describeTarget(tiny, null, { kind: 'part', ref: 'R9' })).toBe('part R9 · not on this board')
  })
})

describe('what a stroke crosses', () => {
  const path = (...points: Array<[number, number]>) => points.map(([x, y]) => toKicad({ x, y }))

  it('a stroke across the tiny board crosses net A and part R1 in order', () => {
    expect(crossings(tiny, path([-2, 0], [6, 0]), 'F.Cu')).toEqual({ nets: ['A', 'GND'], parts: ['R1', 'U1'] })
    expect(crossings(tiny, path([6, 0], [-2, 0]), 'F.Cu')).toEqual({ nets: ['GND', 'A'], parts: ['U1', 'R1'] })
  })

  it('counts copper of its own layer only', () => {
    expect(crossings(tiny, path([4, 3], [4, -3]), 'B.Cu')).toEqual({ nets: ['A', 'GND'], parts: ['U1'] })
    expect(crossings(tiny, path([-8, 2], [-8, -4]), 'F.Cu')).toEqual({ nets: [], parts: [] })
    expect(crossings(tiny, path([-8, 2], [-8, -4]), 'B.Cu')).toEqual({ nets: ['GND'], parts: [] })
  })

  it('meets an arc where it bends, not along its chords', () => {
    // the arc's centre is (0.52, 3), its radius 1, and a chord from its start to its middle runs 0.076 inside it:
    // the first line crosses that chord and stays inside the arc, the second crosses the arc itself
    expect(crossings(tiny, path([-0.376, 3.371], [-0.265, 3.325]), 'F.Cu').nets).toEqual([])
    expect(crossings(tiny, path([-0.45, 3.402], [-0.376, 3.371]), 'F.Cu').nets).toEqual(['A'])
  })

  it('crosses a via', () => {
    expect(crossings(tiny, path([4.06, 2], [4.06, 1.1]), 'F.Cu').nets).toEqual(['A'])
  })
})
