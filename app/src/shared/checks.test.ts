import { describe, expect, it } from 'vitest'
import { readBoard } from './board/board'
import type { BuildResult, Finding, RoutingState } from './build'
import { circuitOf, placementOf } from './circuit'
import { boardFacts, buildSeconds, checkRows, checksSummary, netGauge, netVerdict, openNets, waitingWords } from './checks'
import { fx, read, readJson } from '../test/fixtures'

const ref = readJson<BuildResult>(fx('result.json'))
const circuit = circuitOf(readJson(fx('circuit.json')))!
const placement = placementOf(readJson(fx('placement.json')))!
const board = readBoard(read(fx('filled/board.kicad_pcb')))

const withFinding = (r: BuildResult, f: Finding): BuildResult => ({ ...r, findings: [...r.findings, f] })
const finding = (source: string, code: string, severity: Finding['severity'] = 'warning', message = 'x'): Finding => ({ source, code, severity, message })
const row = (r: BuildResult, label: string) => checkRows(r).find((x) => x.label === label)

describe("the card's checks", () => {
  it("sorts the reference build's findings into the card's rows, in their order", () => {
    expect(checkRows(ref).map((r) => r.label)).toEqual([
      'Electrical rules',
      'Connections, by part and pin',
      'Board matches the schematic',
      'Design rules',
      'Courtyards, fit in outline',
      'Placement',
      'Reads left to right',
      'Copper',
      'Routing',
      '3D models',
      'Engine'
    ])
    expect(row(ref, 'Board matches the schematic')!.word).toBe('pass')
    expect(row(ref, 'Electrical rules')!.word).toBe('pass')
    expect(row(ref, 'Design rules')!).toMatchObject({ word: 'warn', warnings: 29, errors: 0 })
    expect(row(ref, '3D models')!.warnings).toBe(2)
    expect(row(ref, 'Engine')!).toMatchObject({ word: 'note', infos: 2 })
  })

  it('leaves no finding out of the rows', () => {
    const counted = checkRows(ref).flatMap((r) => r.findings).sort((a, b) => a - b)
    expect(counted).toEqual(ref.findings.map((_, i) => i))
    const odd = withFinding(ref, finding('stock', 'out_of_stock'))
    expect(checkRows(odd).flatMap((r) => r.findings)).toHaveLength(odd.findings.length)
  })

  it('puts parity apart from the design rules, and says a failure', () => {
    const broken = withFinding(ref, finding('drc', 'parity_net_conflict', 'error'))
    expect(row(broken, 'Board matches the schematic')!.word).toBe('fail')
    expect(row(broken, 'Design rules')!.word).toBe('warn')
  })

  it('says copper and routing were not run while nothing is routed', () => {
    expect([row(ref, 'Copper')!.word, row(ref, 'Routing')!.word]).toEqual(['skipped', 'skipped'])
    const routed = { ...ref, waiting: [], routing: { state: 'current' } as RoutingState }
    expect([row(routed, 'Copper')!.word, row(routed, 'Routing')!.word]).toEqual(['pass', 'pass'])
  })

  it('says a check was skipped when kicad-cli was missing, or failed at its step', () => {
    const missing = withFinding(ref, finding('kernel', 'kicad_cli_missing'))
    for (const label of ['Electrical rules', 'Board matches the schematic']) expect(row(missing, label)!.word).toBe('skipped')
    expect(row(missing, 'Connections, by part and pin')!.word).toBe('pass')
    const erc = withFinding(ref, finding('kernel', 'kicad_cli_failed', 'error', 'kicad-cli erc failed: boom'))
    expect(row(erc, 'Electrical rules')!.word).toBe('skipped')
    expect(row(erc, 'Design rules')!.word).toBe('warn')
  })

  it('shows the engine and the 3D models only when they have something to say', () => {
    const clean = { ...ref, findings: [] }
    expect(checkRows(clean).map((r) => r.label)).not.toContain('Engine')
    expect(checkRows(clean).map((r) => r.label)).not.toContain('3D models')
  })

  it('counts the checks that ran, and those with a word against them', () => {
    expect(checksSummary(checkRows(ref))).toBe('9, 2 warn')
    expect(checksSummary(checkRows(withFinding(ref, finding('erc', 'e', 'error'))))).toBe('9, 1 fail, 2 warn')
  })
})

describe('the nets of the card', () => {
  it('lists open nets from the ratsnest', () => {
    const open = openNets(ref, placement, null)
    expect(open).toContain('VBUS')
    expect(open).toEqual([...open].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })))
    expect(new Set(open).size).toBe(open.length)
  })

  it('lists them from the route when one is current', () => {
    const routed = { ...ref, routing: { state: 'current' } as RoutingState }
    expect(openNets(routed, placement, [{ ...finding('route', 'net_unrouted'), nets: ['LED', 'EN'] }, finding('route', 'other')])).toEqual(['EN', 'LED'])
    expect(openNets(routed, placement, [])).toEqual([])
  })

  it('counts a cell for each net there is to route, and fills those that are', () => {
    const none = netGauge(circuit, openNets(ref, placement, null), ref.routing ?? null)
    expect(none.total).toBe(circuit.nets.filter((n) => n.pins.length > 1).length)
    expect(none).toMatchObject({ done: 0, state: 'open' })
    expect(netGauge(circuit, ['LED'], { state: 'current' } as RoutingState)).toMatchObject({ done: none.total - 1, state: 'routed' })
    expect(netGauge(circuit, ['LED'], { state: 'stale', unrouted: 0 } as RoutingState)).toMatchObject({ state: 'stale' })
  })
})

describe('the facts of the card', () => {
  it("says the board's size, layers, parts, nets and copper", () => {
    expect(boardFacts(board, ref)).toEqual({ size: '56.0 × 44.0 mm', layers: 2, parts: 22, nets: 14, copper: null })
    const routed = { ...board, tracks: [{ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, arc: null } as never], vias: [{} as never, {} as never] }
    expect(boardFacts(routed, ref).copper).toBe('10 mm, 2')
  })

  it('adds up what the fast build took this time', () => {
    expect(buildSeconds({ ...ref, timings: [{ step: 'a', seconds: 1.2 }, { step: 'b', seconds: 0.9 }, { step: 'c', seconds: 20, cached: true }] })).toBe(2.1)
  })
})

describe('what the card says beside a net, and of what waits', () => {
  it('fails a net that a check by part and pin found wrong', () => {
    expect(netVerdict(ref, 'VBUS')).toBe('pass')
    expect(netVerdict(withFinding(ref, { ...finding('netlist', 'netlist_mismatch', 'error'), nets: ['VBUS'] }), 'VBUS')).toBe('fail')
    expect(netVerdict(withFinding(ref, { ...finding('expect', 'expect_path_broken', 'error'), nets: ['VBUS'] }), 'LED')).toBe('pass')
    expect(netVerdict({ ...ref, verdict: 'failed' }, 'VBUS')).toBe('skipped')
  })

  it("says in plain words what the engine says waits", () => {
    expect(waitingWords(['routing: not started'])).toBe('Not routed yet.')
    expect(waitingWords(['routing: stale (parts moved)'])).toBe('Routing: stale (parts moved).')
    expect(waitingWords([])).toBe('')
  })
})
