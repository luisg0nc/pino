import { describe, expect, it, vi } from 'vitest'
import { verdictWords, type BuildState } from '../../shared/build'
import type { LookRequest } from '../../shared/view'
import { toolsOver } from '../../test/mcp'
import { modelOf, referenceModel, tiny } from '../../test/marks'
import type { BuildModel } from '../model'
import { capText, MOST_LINES, TOOL_TEXT_LIMIT } from './schemas'
import { targetOfName } from './readTools'
import type { ToolDeps } from './tools'

const project = { id: 'p1', dir: '/boards/reference', name: 'reference' }
const ref = referenceModel()

const stateOf = (model: BuildModel, over: Partial<BuildState> = {}): BuildState => ({
  projectId: 'p1', engine: { state: 'ready', kernel: 'x', serve: 1 }, building: false, latest: model.result, lastGood: model.result,
  history: [{ number: model.result.number, hash: model.result.hash, verdict: 'ok', at: '', kept: true }], route: null, problem: null, ...over
})

async function tools(model: BuildModel | null = ref, over: Partial<ToolDeps> = {}) {
  const looked = vi.fn()
  const deps: Partial<ToolDeps> = {
    project: (id) => (id === 'p1' ? project : undefined),
    state: () => (model ? stateOf(model) : undefined),
    model: async () => model,
    looked,
    ...over
  }
  return { ...(await toolsOver(deps)), looked }
}

describe('check', () => {
  it('lists the rows and the findings with positions, capped', async () => {
    const t = await tools()
    const said = await t.call('check')
    expect(said.split('\n')[0]).toBe(`On h1: ${verdictWords(ref.result).rest}`)
    expect(said).toContain('Electrical rules: pass')
    expect(said).toContain('Copper: not run')
    expect(said).toMatch(/^\[warning\] drc \w+ · .* · at \(-?\d+\.\d\d, -?\d+\.\d\d\) mm · \w+/m)
    expect(said.split('\n').filter((l) => l.startsWith('[')).length).toBe(Math.min(MOST_LINES, ref.result.findings.length))
    expect(t.looked).toHaveBeenCalledWith('p1')
  })

  it('narrows by source, severity and what a finding is near', async () => {
    const t = await tools()
    const models = await t.call('check', { source: 'model3d' })
    expect(models.split('\n').filter((l) => l.startsWith('['))).toHaveLength(2)
    expect(await t.call('check', { severity: 'info' })).toContain('[info] board.py nc_rest')
    const near = await t.call('check', { near: 'C3' })
    for (const line of near.split('\n').filter((l) => l.startsWith('['))) expect(line).toMatch(/\bC3\b|at \(/)
    expect(await t.call('check', { near: 'R99' })).toContain('No part R99')
  })

  it('says how many findings it left out, and what narrows them', async () => {
    const many = referenceModel({ findings: Array.from({ length: 90 }, () => ref.result.findings[0]) })
    expect(await (await tools(many)).call('check')).toContain(`and ${90 - MOST_LINES} more: narrow with source or near`)
  })

  it('tells of a failed build, and of nothing built', async () => {
    const failed = { ...ref.result, number: 2, verdict: 'failed' as const, hash: null, headline: 'On h2: board.py failed at line 12: invalid syntax', findings: [{ source: 'board.py', code: 'syntax_error', severity: 'error' as const, message: 'invalid syntax', at: { space: 'source' as const, file: 'board.py', line: 12 } }] }
    const t = await tools(ref, { state: () => stateOf(ref, { latest: failed }) })
    const said = await t.call('check')
    expect(said).toContain('On h2: board.py failed at line 12: invalid syntax')
    expect(said).toContain('[error] board.py syntax_error · invalid syntax · board.py line 12')
    expect(await (await tools(null)).call('check')).toBe('Nothing has been built yet. pino builds board.py when it is saved.')
  })
})

describe('measure', () => {
  it('gives numbers from the board file and names the build', async () => {
    const t = await tools()
    expect(await t.call('measure', { what: 'distance', a: 'U2', b: 'J1' })).toMatch(/^distance U2 to J1: \d+\.\d\d mm\. From the board file of h1\.$/)
    expect(await t.call('measure', { what: 'gap', a: 'U2.1', b: 'U2.5' })).toMatch(/^gap U2\.1 to U2\.5: \d+\.\d\d mm, copper edge to copper edge\. From/)
    expect(await t.call('measure', { what: 'vias' })).toBe('vias on the board: 0. From the board file of h1.')
    expect(await t.call('measure', { what: 'length', net: 'VBUS' })).toContain('length of VBUS: 0.00 mm')
    expect(await t.call('measure', { what: 'edge', a: 'net:VBUS' })).toContain('from the board edge')
  })

  it('names the route when its copper is on the board it measures', async () => {
    const current = referenceModel({ routing: { state: 'current', number: 3 } as never })
    const routed = { ...current, routeBoard: current.board }
    expect(await (await tools(routed)).call('measure', { what: 'vias' })).toContain('From the board file of h1 (route r3).')
    // a current route whose copper pino could not read: the numbers are the unrouted board's, and say no route
    expect(await (await tools(current)).call('measure', { what: 'vias' })).toContain('From the board file of h1.')
  })

  it('answers an unknown name with the nearest ones, and says what a measure needs', async () => {
    const t = await tools()
    expect(await t.call('measure', { what: 'edge', a: 'U9' })).toContain('No part U9. Nearest: U1, U2')
    expect(await t.call('measure', { what: 'gap', a: 'U2' })).toBe('A gap is between two things: give a and b.')
    expect(await t.call('measure', { what: 'length' })).toBe('A length is of a net: give net.')
    expect(await t.call('measure', { what: 'width', net: 'VBUSS' })).toContain('No net VBUSS. Nearest: VBUS')
    expect((await t.result('measure', { what: 'edge', a: 'U9' })).isError).toBe(true)
  })

  it('reads names as parts, pads, nets, tracks and vias', () => {
    expect(targetOfName(tiny, null, 'R1')).toEqual({ kind: 'part', ref: 'R1' })
    expect(targetOfName(tiny, null, 'U1.2')).toEqual({ kind: 'pad', ref: 'U1', number: '2' })
    expect(targetOfName(tiny, null, 'net:A')).toEqual({ kind: 'net', name: 'A' })
    expect(targetOfName(tiny, null, 'GND')).toEqual({ kind: 'net', name: 'GND' })
    expect(targetOfName(tiny, null, `track:${tiny.tracks[0].uuid}`)).toEqual({ kind: 'track', uuid: tiny.tracks[0].uuid })
    expect(targetOfName(tiny, null, `via:${tiny.vias[0].uuid}`)).toEqual({ kind: 'via', uuid: tiny.vias[0].uuid })
    expect(targetOfName(tiny, null, 'U1.9')).toEqual({ error: 'U1 has no pad 9. Its pads: 1, 2, 3' })
    expect(targetOfName(tiny, null, 'track:nope')).toMatchObject({ error: expect.stringContaining('No track nope') })
  })
})

describe('nets and trace', () => {
  it('lists VBUS by part and pin', async () => {
    const said = await (await tools()).call('nets', { net: 'VBUS' })
    expect(said).toContain('net VBUS (supply), 6 pins')
    expect(said).toContain('U2.1 VIN')
  })

  it("lists a part's pins with their nets, and every net by its size", async () => {
    const t = await tools()
    const u2 = await t.call('nets', { part: 'U2' })
    expect(u2).toContain('U2.1 VIN: VBUS')
    expect(u2).toContain('U2.4 NC: not connected')
    const all = await t.call('nets')
    expect(all).toContain('VBUS (supply): 6 pins')
    expect(all.split('\n').filter((l) => /\(\w+\): \d+ pins?$/.test(l))).toHaveLength(ref.circuit!.nets.length)
  })

  it('says a pin is not joined on an unrouted board', async () => {
    const said = await (await tools()).call('trace', { pin: 'U2.1' })
    expect(said).toContain('U2.1 VIN is on net VBUS with 5 other pins')
    expect(said).toMatch(/\d+ groups: /)
    expect(said).toContain('U2.1 not joined yet')
    expect(said).not.toContain('joined by')
  })

  it('says what joins the pins that are joined', async () => {
    const said = await (await tools(modelOf(tiny))).call('trace', { pin: 'R1.1' })
    expect(said).toContain('1 group: R1.1, U1.2 joined by 3 tracks, 1 via')
  })
})

describe('ratsnest and diff', () => {
  it('says the placement score and the open connections by pin', async () => {
    const said = await (await tools()).call('ratsnest')
    expect(said.split('\n')[0]).toBe(`Placement of h1: score ${ref.result.placement!.score}, ${ref.result.placement!.crossings} crossings, ${ref.result.placement!.length_mm} mm of open connections.`)
    expect(said).toMatch(/^\+3V3: \w+\.\w+ to \w+\.\w+, \d+\.\d\d mm$/m)
  })

  const history = [1, 2, 3].map((n) => ({ number: n, hash: `aaaaaaaa000${n}`, verdict: 'ok' as const, at: '', kept: n > 1 }))
  const third = referenceModel({ number: 3, hash: 'aaaaaaaa0003', changes: { circuit: [], layout: ['moves 1 part: R4'] } })

  it('answers consecutive builds from the changes the build kept', async () => {
    const diff = vi.fn()
    const t = await tools(third, { state: () => stateOf(third, { history }), diff })
    expect(await t.call('diff')).toBe('From h2 to h3:\nmoves 1 part: R4')
    expect(diff).not.toHaveBeenCalled()
  })

  it('asks the engine about builds further apart, and says one that is no longer kept', async () => {
    const diff = vi.fn(async () => ({ circuit: ['adds R9'], layout: [] }))
    const kept = history.map((e) => ({ ...e, kept: true }))
    const t = await tools(third, { state: () => stateOf(third, { history: kept }), diff })
    expect(await t.call('diff', { from: 1, to: 3 })).toBe('From h1 to h3:\nadds R9')
    expect(diff).toHaveBeenCalledWith(project, 'aaaaaaaa0001', 'aaaaaaaa0003')
    const pruned = await tools(third, { state: () => stateOf(third, { history }), diff })
    expect(await pruned.call('diff', { from: 1 })).toBe('h1 is no longer kept.')
    expect(await pruned.call('diff', { from: 7 })).toBe('There is no build h7.')
  })

  it('says nothing changed between two builds of one board, whatever the later one says changed since another', async () => {
    const again = history.map((e) => (e.number === 2 ? { ...e, hash: third.result.hash! } : e))
    const diff = vi.fn()
    const t = await tools(third, { state: () => stateOf(third, { history: again }), diff })
    expect(await t.call('diff')).toBe('From h2 to h3:\nnothing changed')
    expect(diff).not.toHaveBeenCalled()
  })

  it('says so when nothing changed', async () => {
    const same = referenceModel({ number: 3, hash: 'aaaaaaaa0003', changes: { circuit: [], layout: [] } })
    expect(await (await tools(same, { state: () => stateOf(same, { history }) })).call('diff')).toBe('From h2 to h3:\nnothing changed')
  })
})

describe('look', () => {
  const picture = { png: Buffer.from('png').toString('base64'), width: 1280, height: 960, said: 'Board tab, h1, top copper' }

  it('answers one picture and what it shows, and counts as having looked', async () => {
    const look = vi.fn(async (_p: unknown, _req: LookRequest) => picture)
    const t = await tools(ref, { look })
    const answer = await t.result('look', { tab: 'board', layers: ['B.Cu'], size: 800 })
    expect(answer.content).toEqual([
      { type: 'image', data: picture.png, mimeType: 'image/png' },
      { type: 'text', text: 'Board tab, h1, top copper' }
    ])
    expect(look).toHaveBeenCalledWith(project, { tab: 'board', layers: ['B.Cu'], size: 800, marks: true })
    expect(t.looked).toHaveBeenCalledWith('p1')
  })

  it('refuses a size out of range in words, and says why no picture came', async () => {
    const t = await tools(ref, { look: async () => picture })
    expect(await t.call('look', { size: 5000 })).toBe('size is the long edge in pixels, from 400 to 2000.')
    const broken = await tools(ref, { look: async () => Promise.reject(new Error('the window did not answer within 10 s')) })
    expect(await broken.call('look')).toBe('No picture: the window did not answer within 10 s')
    expect(broken.looked).not.toHaveBeenCalled()
  })
})

describe('every tool', () => {
  it('stays under TOOL_TEXT_LIMIT', async () => {
    const long = referenceModel({ findings: Array.from({ length: 200 }, () => ({ ...ref.result.findings[0], message: 'z'.repeat(300) })) })
    const t = await tools(long)
    for (const [name, args] of [['check', {}], ['nets', {}], ['ratsnest', {}]] as const) {
      expect((await t.call(name, args)).length).toBeLessThanOrEqual(TOOL_TEXT_LIMIT)
    }
  })

  it('cuts a text at a line and counts what it left', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const cut = capText(text, 120)
    expect(cut.length).toBeLessThanOrEqual(120)
    expect(cut).toMatch(/line \d+\n\(cut: \d+ more characters\)$/)
    expect(capText('short', 120)).toBe('short')
  })

  it('says when the project is not open', async () => {
    const t = await tools(ref, { project: () => undefined })
    expect(await t.call('check')).toBe('No project p1 is open in pino.')
  })
})
