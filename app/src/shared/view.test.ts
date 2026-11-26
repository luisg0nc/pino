import { describe, expect, it } from 'vitest'
import type { BuildState } from './build'
import type { Placement } from './circuit'
import { bandFor, DEFAULT_LOOK, emptyWords, firstTab, lookTab, PANE_NAMES, PANE_TABS, ratsFor, tabLabel, type Selection } from './view'

describe('the tabs of the middle of the window', () => {
  it('are the Brief, then the three views', () => {
    expect(PANE_TABS.map((t) => PANE_NAMES[t])).toEqual(['Brief', 'Schematic', 'Board', '3D'])
  })

  it('opens a project with no board.py on the Brief, and one with a board where it was left', () => {
    expect(firstTab({ name: 'a', dir: '/w/a', board: false, brief: true, empty: false }, 'board')).toBe('brief')
    expect(firstTab({ name: 'a', dir: '/w/a', board: true, brief: true, empty: false }, '3d')).toBe('3d')
    expect(firstTab({ name: 'a', dir: '/w/a', board: true, brief: false, empty: false }, null)).toBe('schematic')
    // A project the listing in hand does not have is not known to be without a board.
    expect(firstTab(undefined, 'board')).toBe('board')
  })

  it("Claude's look on the Brief draws the board unless it asks for a tab", () => {
    expect([lookTab(undefined, 'brief'), lookTab('schematic', 'brief'), lookTab(undefined, '3d')]).toEqual(['board', 'schematic', '3d'])
  })
})

const selection = { tab: 'schematic', label: 'J1' } as Selection

describe('the tabs', () => {
  it('labels the tab you are not on with the selection', () => {
    expect(tabLabel('board', 'schematic', selection)).toBe('Board · J1')
    expect(tabLabel('schematic', 'schematic', selection)).toBe('Schematic')
    expect(tabLabel('3d', 'board', null)).toBe('3D')
  })

  it('starts on the top copper with everything but the net colours', () => {
    expect(DEFAULT_LOOK).toEqual({ active: 'F.Cu', pours: true, ratsnest: true, silk: true, netColours: false })
  })
})

describe('the band at the foot of the view', () => {
  const result = (number: number, verdict = 'ok') => ({ number, verdict, hash: verdict === 'failed' ? null : 'aaaaaaaa0001' })
  const state = (over: Partial<Record<keyof BuildState, unknown>>) => ({ latest: result(15), lastGood: result(15), problem: null, engine: { state: 'ready' }, ...over }) as unknown as BuildState

  it('says nothing while the latest build is on show', () => {
    expect(bandFor(state({}), null)).toBeNull()
    expect(bandFor(null, null)).toBeNull()
  })

  it('keeps the drawing and says why when a build fails', () => {
    const failed = state({ latest: result(8, 'failed'), lastGood: result(7), problem: 'h8 failed: invalid syntax, board.py line 12' })
    expect(bandFor(failed, null)).toEqual({ kind: 'failed', text: 'Drawn from h7. h8 failed: invalid syntax, board.py line 12' })
  })

  it('says an engine that stopped over the last drawing', () => {
    expect(bandFor(state({ problem: 'The engine stopped: boom' }), null)).toEqual({ kind: 'failed', text: 'Drawn from h15. The engine stopped: boom' })
  })

  it('says when an older build is on show', () => {
    expect(bandFor(state({}), 12)).toEqual({ kind: 'older', text: 'Showing h12. The latest is h15.' })
    expect(bandFor(state({}), 15)).toBeNull()
  })

  const route = (over: Record<string, unknown>) => ({ job: 1, step: 'signals', index: 18, of: 31, startedAt: 0, ...over })

  it('says how far a route in the background is, or which step it is at', () => {
    expect(bandFor(state({ route: route({}) }), null)).toEqual({ kind: 'routing', text: 'Routing in the background, 18 of 31', progress: { done: 18, of: 31 } })
    expect(bandFor(state({ route: route({ step: 'fanout', index: 0, of: 0 }) }), null)).toEqual({ kind: 'routing', text: 'Routing in the background: fanout' })
  })

  const stale = state({ lastGood: { ...result(15), routing: { state: 'stale', number: 2, stale_because: ['parts moved', 'rules changed'] } } })

  it('says that the copper no longer fits, where it is from and why, until the person keeps it', () => {
    expect(bandFor(stale, null, { from: 12 })).toEqual({ kind: 'stale', text: 'Copper from h12. Parts moved and rules changed since.' })
    expect(bandFor(stale, null)).toEqual({ kind: 'stale', text: 'Copper from route r2. Parts moved and rules changed since.' })
    expect(bandFor(stale, null, { kept: 'aaaaaaaa0001' })).toBeNull()
    expect(bandFor(stale, null, { kept: 'bbbbbbbb0002' })?.kind).toBe('stale')
  })

  it('says one thing at a time: an older build, then a failure, then the router, then stale copper', () => {
    const all = state({ ...stale, problem: 'h16 failed', route: route({}) })
    expect(bandFor(all, 12)?.kind).toBe('older')
    expect(bandFor(all, null)?.kind).toBe('failed')
    expect(bandFor({ ...all, problem: null }, null)?.kind).toBe('routing')
    expect(bandFor({ ...all, problem: null, route: null }, null)?.kind).toBe('stale')
  })
})

describe('the ratsnest', () => {
  const placement = { poses: {}, edges: [['A', [1, 2], [3, 4], 'F'], ['B', [0, 0], [1, 0], 'F']] } as unknown as Placement

  it('draws every open line of the placement, in the board file frame', () => {
    expect(ratsFor(placement, null)).toEqual([
      [{ x: 101, y: 98 }, { x: 103, y: 96 }, 'A'],
      [{ x: 100, y: 100 }, { x: 101, y: 100 }, 'B']
    ])
    expect(ratsFor(null, null)).toEqual([])
  })

  it('draws only the nets a current route left open', () => {
    expect(ratsFor(placement, new Set(['B'])).map((r) => r[2])).toEqual(['B'])
    expect(ratsFor(placement, new Set())).toEqual([])
  })
})

describe('what an empty view says', () => {
  const state = (over: Record<string, unknown>) => ({ engine: { state: 'ready' }, building: false, latest: null, lastGood: null, problem: null, ...over }) as unknown as BuildState

  it('says there is nothing yet, before there is a board file', () => {
    expect(emptyWords(null)).toEqual({ title: 'Nothing to draw yet.', lead: null })
    expect(emptyWords(state({}))).toEqual({ title: 'Nothing to draw yet.', lead: null })
  })

  it('says a first build is under way', () => {
    expect(emptyWords(state({ building: true }))).toEqual({ title: 'Building the board.', lead: 'pino runs board.py and draws what it makes.' })
  })

  it('says why a first build failed, and that the engine did not start', () => {
    expect(emptyWords(state({ latest: { number: 1, verdict: 'failed' }, problem: 'h1 failed: invalid syntax, board.py line 12' }))).toEqual({
      title: 'h1 failed.',
      lead: 'invalid syntax, board.py line 12'
    })
    expect(emptyWords(state({ engine: { state: 'failed', reason: 'The engine did not start: uv was not found' }, problem: 'The engine did not start: uv was not found' }))).toEqual({
      title: 'The engine did not start.',
      lead: 'uv was not found'
    })
    expect(emptyWords(state({ engine: { state: 'failed', reason: 'The engine stopped: boom' }, problem: 'The engine stopped: boom' }))).toEqual({ title: 'The engine stopped.', lead: 'boom' })
  })

  it("says what stands in the way of a build, in main's words", () => {
    expect(emptyWords(state({ problem: '/x/.pino is a link, not a folder' }))).toEqual({ title: 'Nothing was built.', lead: '/x/.pino is a link, not a folder' })
  })
})
