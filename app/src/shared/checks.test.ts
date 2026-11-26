import { describe, expect, it } from 'vitest'
import { readBoard } from './board/board'
import type { BuildResult, Finding, RoutingState } from './build'
import { circuitOf, placementOf } from './circuit'
import { boardFacts, buildSeconds, checkRows, checksSummary, netGauge, netVerdict, openNets, waitingWords, withRouteFindings, cellsRouted, clock, headSaid, underHead, releaseFindings } from './checks'
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
      'Parts at JLC',
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
    expect(checksSummary(checkRows(ref))).toBe('10, 3 warn')
    expect(checksSummary(checkRows(withFinding(ref, finding('erc', 'e', 'error'))))).toBe('10, 1 fail, 3 warn')
  })
})

describe('parts and release in the checks', () => {
  it('puts parts findings in their own row', () => {
    const rows = checkRows(withFinding(ref, finding('parts', 'part_extended', 'warning')))
    expect(rows.find((r) => r.label === 'Parts at JLC')!.word).toBe('warn')
  })

  it("shows a release row only when release has something to say", () => {
    expect(checkRows(ref).map((r) => r.label)).not.toContain('Release')
    const rows = checkRows(withFinding(ref, finding('release', 'rotation_unchecked', 'info')))
    expect(rows.map((r) => r.label).indexOf('Release')).toBe(rows.map((r) => r.label).indexOf('Routing') + 1)
    expect(row(withFinding(ref, finding('release', 'part_no_stock', 'error')), 'Release')!.word).toBe('fail')
  })

  it('pins release findings only on the build they were made from', () => {
    const f = finding('release', 'rotation_unchecked', 'info')
    const state = (hash: string) => ({ projectId: 'p', running: false, step: null, readiness: null, error: null, result: { build: { number: 1, hash }, findings: [f] } as never })
    expect(releaseFindings(state(ref.hash!), ref)).toEqual([f])
    expect(releaseFindings(state('other'), ref)).toEqual([])
    expect(releaseFindings(null, ref)).toEqual([])
    expect(releaseFindings(state(ref.hash!), null)).toEqual([])
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

describe('a routed board', () => {
  const routing = (state: RoutingState['state']) => ({ state, number: 1 }) as RoutingState
  const copper = finding('copper', 'copper_stub', 'warning')
  const word = (r: BuildResult, label: string) => checkRows(r).find((row) => row.label === label)!.word

  it("takes in what the router's own checks said while the route is current, each once", () => {
    const current = { ...ref, routing: routing('current') }
    const merged = withRouteFindings(current, [copper])
    expect(merged.findings).toEqual([...ref.findings, copper])
    expect(word(merged, 'Copper')).toBe('warn')
    expect(withRouteFindings(merged, [copper]).findings).toEqual(merged.findings)
    expect(withRouteFindings({ ...ref, routing: routing('stale') }, [copper]).findings).toEqual(ref.findings)
    expect(withRouteFindings(current, null)).toBe(current)
  })

  it('says the copper checks were not run unless the copper is of this board', () => {
    expect(word({ ...ref, routing: routing('current') }, 'Copper')).toBe('pass')
    for (const state of ['none', 'stale', 'running'] as const) expect(word({ ...ref, routing: routing(state) }, 'Copper')).toBe('skipped')
  })
})

describe('a route under way', () => {
  it('fills the gauge by how far through its nets the router is', () => {
    expect(cellsRouted({ index: 7, of: 13 }, 13)).toBe(7)
    expect(cellsRouted({ index: 7, of: 26 }, 13)).toBe(3)
    expect(cellsRouted({ index: 0, of: 0 }, 13)).toBe(0)
  })

  it('says how long it has been at it in minutes and seconds', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(12_900)).toBe('0:12')
    expect(clock(83_000)).toBe('1:23')
    expect(clock(-5)).toBe('0:00')
  })
})

describe("the card's head", () => {
  const at = (over: Partial<BuildResult> = {}, counts: Partial<BuildResult['counts']> = {}): BuildResult => ({ ...ref, ...over, counts: { ...ref.counts, errors: 0, warnings: 0, unrouted: 80, ...counts } })
  const routing = (state: RoutingState['state'], unrouted = 0) => ({ state, number: 1, unrouted }) as RoutingState

  it('says how the build stands in a word or three, in the colour of the worst of it', () => {
    expect(headSaid(at(), false)).toEqual({ word: 'checks pass', tone: 'ok' })
    expect(headSaid(at({}, { warnings: 31 }), false)).toEqual({ word: '31 warnings', tone: 'warn' })
    expect(headSaid(at({}, { errors: 1, warnings: 31 }), false)).toEqual({ word: '1 error', tone: 'fail' })
    expect(headSaid(at({ verdict: 'failed' }), false)).toEqual({ word: 'failed', tone: 'fail' })
  })

  it('says where the copper stands once there is some', () => {
    expect(headSaid(at({}, { warnings: 31 }), true)).toEqual({ word: 'routing', tone: 'ok' })
    expect(headSaid(at({ routing: routing('stale') }, { warnings: 31 }), false)).toEqual({ word: 'copper stale', tone: 'warn' })
    expect(headSaid(at({ routing: routing('current') }), false)).toEqual({ word: 'routed', tone: 'ok' })
    expect(headSaid(at({ routing: routing('current') }, { warnings: 2 }), false)).toEqual({ word: 'routed, 2 warnings', tone: 'warn' })
    expect(headSaid(at({ routing: routing('current', 7) }, { warnings: 2 }), false)).toEqual({ word: 'routed, 7 left', tone: 'warn' })
  })

  it('says under it what is not routed yet, and else what the engine says waits', () => {
    expect(underHead(at({ waiting: ['routing: not started'] }))).toBe('Not routed: 80 connections.')
    expect(underHead(at({ waiting: ['routing: stale (parts moved)'] }))).toBe('Routing: stale (parts moved).')
    expect(underHead(at({ waiting: [] }, { unrouted: 0 }))).toBe('')
  })
})
