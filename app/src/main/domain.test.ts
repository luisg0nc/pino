import { describe, expect, it, vi } from 'vitest'
import { verdictWords, type BuildResult, type BuildState, type RoutingState } from '../shared/build'
import type { StrokeMark } from '../shared/marks'
import { DEFAULT_LOOK, type BoardLook, type Selection, type ViewTab } from '../shared/view'
import { fx, readJson } from '../test/fixtures'
import { toolName } from '../shared/app'
import { CONTEXT_LIMIT, MOST_HOLDS, PinoDomain, VERDICT_LIMIT, verdictText, type DomainDeps } from './domain'

const ref = readJson<BuildResult>(fx('result.json'))
const project = { id: 'p1', dir: '/x', name: 'board' }

const m3stroke: StrokeMark = {
  id: 'M3', author: 'user', status: 'draft', anchor: 'ok', build: 1, note: 'route the flash lines this way',
  payload: 'stroke · bottom copper · 6.10 mm · path (0.00, 0.00) (6.10, 0.00) mm · crosses nets VBUS · passes parts U2',
  label: 'M3', createdAt: '2026-11-26T08:00:00Z', kind: 'stroke', layer: 'B.Cu', points: [{ x: 0, y: 0 }, { x: 6.1, y: 0 }], crosses: { nets: ['VBUS'], parts: ['U2'] }
}
const padSel: Selection = { tab: 'board', target: { kind: 'pad', ref: 'U2', number: '1' }, text: 'pad U2.1 · VIN · net VBUS · top copper · at (1.00, 2.00) mm', label: 'U2.1' }

const stateOf = (over: Partial<BuildState> = {}): BuildState => ({ projectId: 'p1', engine: { state: 'ready', kernel: 'x', serve: 1 }, building: false, latest: ref, lastGood: ref, history: [], route: null, copperFrom: null, problem: null, ...over })

function domain(opts: { state?: Partial<BuildState>; drafts?: StrokeMark[]; open?: StrokeMark[]; view?: { tab: ViewTab; look: BoardLook; selection: Selection | null } | null } = {}) {
  let state = stateOf(opts.state)
  let time = 1000
  let pending = false
  let startedAt: number | undefined
  let endedAt: number | undefined
  const markSent = vi.fn(async () => {})
  let settle = async () => {}
  const deps: DomainDeps = {
    builds: {
      state: () => state,
      startedAt: () => startedAt,
      endedAt: () => endedAt,
      pending: () => pending,
      whenSettled: async () => {
        await settle()
        return state
      },
      routedOn: () => 5
    },
    marks: { drafts: async () => opts.drafts ?? [], open: async () => opts.open ?? [], markSent },
    view: () => opts.view ?? null,
    toolName,
    now: () => time
  }
  const d = new PinoDomain(deps)
  return {
    d,
    markSent,
    later: (ms: number) => (time += ms),
    /** A build begins now; it is the running one until `lands`. */
    begins(over: Partial<BuildState> = {}) {
      startedAt = time
      state = { ...state, building: true, history: [...state.history, { number: (state.latest?.number ?? 0) + 1, hash: null, verdict: 'running', at: '', kept: false }], ...over }
    },
    lands(result: BuildResult, over: Partial<BuildState> = {}) {
      endedAt = time
      state = { ...state, building: false, latest: result, lastGood: result.hash ? result : state.lastGood, history: state.history.filter((e) => e.verdict !== 'running'), ...over }
    },
    saveSeen() {
      pending = true
    },
    saveSettled() {
      pending = false
    },
    onSettle(fn: () => Promise<void>) {
      settle = fn
    }
  }
}

// A build that changed the board has a folder of its own, by another hash.
const changed = (number: number, hash = `bbbbbbbb${String(number).padStart(4, '0')}`): BuildResult => ({ ...ref, number, hash, changes: { circuit: [], layout: ['moves 1 part: R4'] } })
const failed: BuildResult = { ...ref, number: 2, verdict: 'failed', hash: null, headline: 'On h2: board.py failed at line 12: invalid syntax', findings: [{ source: 'board.py', code: 'syntax_error', severity: 'error', message: 'invalid syntax', at: { space: 'source', file: 'board.py', line: 12 } }] }

describe("the build in Claude's prompt", () => {
  it('tells the verdict, the view and the drafts, and sends the drafts once delivered', async () => {
    const t = domain({ drafts: [m3stroke], view: { tab: 'board', look: DEFAULT_LOOK, selection: padSel } })
    const c = await t.d.promptContext(project, 'fix it')
    expect(c.text.split('\n')[0]).toBe(`On h1: ${verdictWords(ref).rest}.`)
    expect(c.text).toContain('The person sees the Board tab, top copper. Selected: pad U2.1 · VIN')
    expect(c.text).toContain(`M3 ${m3stroke.payload} · note: "route the flash lines this way"`)
    expect(c.sentMarkIds).toEqual(['M3'])
    expect(t.markSent).not.toHaveBeenCalled()
    await c.delivered!()
    expect(t.markSent).toHaveBeenCalledWith(project, ['M3'])
  })

  it('names the other tabs, and the open marks with what became of a stale one', async () => {
    const stale: StrokeMark = { ...m3stroke, id: 'M2', status: 'sent', anchor: 'stale', payload: 'track · x · stale: its track is gone, it was at (1.00, 2.00) mm' }
    const t = domain({ open: [{ ...m3stroke, id: 'M1', status: 'sent' }, stale], view: { tab: 'schematic', look: DEFAULT_LOOK, selection: null } })
    const text = (await t.d.promptContext(project, 'x')).text
    expect(text).toContain('The person sees the Schematic tab.')
    expect(text).toContain('Open marks: M1, M2 (stale: its track is gone).')
    expect((await domain({ view: { tab: '3d', look: DEFAULT_LOOK, selection: null } }).d.promptContext(project, 'x')).text).toContain('The person sees the 3D tab.')
  })

  it('adds nothing for a project with nothing built and nothing marked', async () => {
    const c = await domain({ state: { latest: null, lastGood: null } }).d.promptContext(project, 'x')
    expect(c).toEqual({ text: '', sentMarkIds: [] })
  })

  it('stays under CONTEXT_LIMIT and counts the marks that do not fit', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...m3stroke, id: `M${i + 1}`, payload: `${m3stroke.payload} ${'x'.repeat(200)}` }))
    const c = await domain({ drafts: many }).d.promptContext(project, 'x')
    expect(c.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(c.sentMarkIds.length).toBeGreaterThan(5)
    expect(c.sentMarkIds).toEqual(many.slice(0, c.sentMarkIds.length).map((m) => m.id))
    expect(c.text).toContain(`and ${40 - c.sentMarkIds.length} more marks: call mcp__pino__marks`)
  })
})

describe('the verdict in words', () => {
  it('lists up to five errors and warnings with their places', () => {
    const text = verdictText(ref, stateOf(), undefined)
    const lines = text.split('\n')
    expect(lines[0]).toBe(`On h1: ${verdictWords(ref).rest}.`)
    expect(lines.filter((l) => l.startsWith('- ['))).toHaveLength(5)
    expect(lines[1]).toMatch(/^- \[warning\] drc \w+: .* at \(-?\d+\.\d\d, -?\d+\.\d\d\) mm$/)
    expect(text.length).toBeLessThanOrEqual(VERDICT_LIMIT)
  })

  it('cuts a long verdict and says so', () => {
    const long = { ...ref, findings: ref.findings.map((f) => ({ ...f, message: 'y'.repeat(300) })) }
    const text = verdictText(long, stateOf({ latest: long }), undefined)
    expect(text.length).toBeLessThanOrEqual(VERDICT_LIMIT)
    expect(text.endsWith('(cut)')).toBe(true)
  })

  it('says a failed build, what the views still show, and a build under way', () => {
    expect(verdictText(failed, stateOf({ latest: failed }), undefined)).toBe('h2 failed: invalid syntax, board.py line 12. The views still show h1.')
    expect(verdictText(ref, stateOf({ building: true, history: [{ number: 2, hash: null, verdict: 'running', at: '', kept: false }] }), undefined)).toContain('Building h2 now.')
  })

  it('says how the routing stands', () => {
    const routed = (routing: Partial<RoutingState>) => verdictText({ ...ref, findings: [], routing: routing as RoutingState }, stateOf(), 5)
    expect(routed({ state: 'current', number: 3 })).toContain('Routing: current, r3.')
    expect(routed({ state: 'stale', stale_because: ['parts moved'], number: 3 })).toContain('Routing: stale (parts moved), copper from h5.')
    expect(verdictText({ ...ref, findings: [], routing: { state: 'running' } as RoutingState }, stateOf({ route: { job: 1, step: 'signals', index: 12, of: 31, startedAt: 0 } }), undefined)).toContain('Routing: running, 12 of 31 nets.')
  })

  it('says an engine that is not running', async () => {
    const t = domain({ state: { engine: { state: 'failed', reason: 'The engine did not start: uv was not found' }, latest: null, lastGood: null } })
    expect((await t.d.promptContext(project, 'x')).text).toBe('The engine is not running: uv was not found.')
  })
})

describe('holding a Stop', () => {
  const turn = async (t: ReturnType<typeof domain>) => {
    await t.d.promptContext(project, 'go')
    t.later(10)
  }

  it('holds a Stop once while a build of the turn is running, and lets the next go', async () => {
    const t = domain()
    await turn(t)
    t.begins()
    expect(await t.d.stopAnswer(project)).toEqual({ decision: 'block', reason: 'h2, started in this turn, is still building. Wait for it, then call mcp__pino__check.' })
    expect(await t.d.stopAnswer(project)).toBeNull()
  })

  it('waits for a build that is nearly done, and then holds for its being unseen', async () => {
    const t = domain()
    await turn(t)
    t.begins()
    t.onSettle(async () => {
      t.later(5)
      t.lands(changed(2))
    })
    expect((await t.d.stopAnswer(project))!.reason).toBe('h2 was built in this turn and you have not looked at it. Call mcp__pino__look or mcp__pino__check before finishing.')
  })

  it('waits for a save that has not started its build yet', async () => {
    const t = domain()
    await turn(t)
    t.saveSeen()
    t.onSettle(async () => {
      t.saveSettled()
      t.begins()
      t.later(5)
      t.lands(changed(2))
    })
    expect((await t.d.stopAnswer(project))!.reason).toContain('h2 was built in this turn')
  })

  it('answers at once when no save waits and nothing builds', async () => {
    const t = domain()
    await turn(t)
    const waited = vi.fn(async () => {})
    t.onSettle(waited)
    const from = Date.now()
    expect(await t.d.stopAnswer(project)).toBeNull()
    expect(waited).not.toHaveBeenCalled()
    expect(Date.now() - from).toBeLessThan(50)
  })

  it('holds a Stop for a failed build of the turn with its line', async () => {
    const t = domain()
    await turn(t)
    t.begins()
    t.later(5)
    t.lands(failed)
    expect((await t.d.stopAnswer(project))!.reason).toBe('h2 failed: invalid syntax, board.py line 12. The views still show h1. Fix board.py, or say it is still broken.')
  })

  it('holds a Stop once for a build of the turn that nobody looked at', async () => {
    const t = domain()
    await turn(t)
    t.begins()
    t.later(5)
    t.lands(changed(2))
    expect((await t.d.stopAnswer(project))!.decision).toBe('block')
    expect(await t.d.stopAnswer(project)).toBeNull()
  })

  it('holds nothing once Claude has looked, or for a build that changed nothing', async () => {
    const seen = domain()
    await turn(seen)
    seen.begins()
    seen.later(5)
    seen.lands(changed(2))
    seen.later(5)
    seen.d.looked(project.id)
    expect(await seen.d.stopAnswer(project)).toBeNull()
    const same = domain()
    await turn(same)
    same.begins()
    same.lands({ ...ref, number: 2, changes: { circuit: [], layout: [] } })
    expect(await same.d.stopAnswer(project)).toBeNull()
  })

  // The engine numbers a build it has cached anew, and says what changed since the last one with another hash.
  it('holds nothing for a save that built the board the turn began with again', async () => {
    const t = domain()
    await turn(t)
    t.begins()
    t.later(5)
    t.lands(changed(2, ref.hash!))
    expect(await t.d.stopAnswer(project)).toBeNull()
  })

  it('holds nothing for a board Claude has looked at, built again', async () => {
    const t = domain()
    await turn(t)
    t.begins()
    t.lands(changed(2, 'cccccccc0002'))
    t.later(5)
    t.d.looked(project.id)
    t.later(5)
    t.begins()
    t.later(5)
    t.lands(changed(3, 'cccccccc0002'))
    expect(await t.d.stopAnswer(project)).toBeNull()
  })

  it('still holds for a new board built twice in a turn and never looked at', async () => {
    const t = domain()
    await turn(t)
    for (const number of [2, 3]) {
      t.begins()
      t.later(5)
      t.lands(changed(number, 'cccccccc0002'))
    }
    expect((await t.d.stopAnswer(project))!.reason).toContain('h3 was built in this turn')
  })

  it('holds nothing for a build begun before the turn', async () => {
    const t = domain()
    t.begins()
    t.later(50)
    await turn(t)
    expect(await t.d.stopAnswer(project)).toBeNull()
    t.lands(failed)
    expect(await t.d.stopAnswer(project)).toBeNull()
  })

  it('never holds a third time in a turn, and counts anew in the next', async () => {
    const t = domain()
    await turn(t)
    t.begins()
    const first = await t.d.stopAnswer(project)
    t.later(5)
    t.lands(failed)
    const second = await t.d.stopAnswer(project)
    t.begins()
    t.later(5)
    t.lands(changed(3))
    expect([first!.decision, second!.decision, await t.d.stopAnswer(project)]).toEqual(['block', 'block', null])
    expect(MOST_HOLDS).toBe(2)
    await turn(t)
    t.begins()
    expect((await t.d.stopAnswer(project))!.decision).toBe('block')
  })

  it('holds nothing before any prompt', async () => {
    const t = domain()
    t.begins()
    expect(await t.d.stopAnswer(project)).toBeNull()
  })
})
