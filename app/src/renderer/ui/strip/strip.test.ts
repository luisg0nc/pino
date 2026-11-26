import { describe, expect, it } from 'vitest'
import type { BuildEntry, BuildResult, RoutingState } from '../../../shared/build'
import { captionOf, factsOf, stripNodes } from './strip'

const entry = (number: number, over: Partial<BuildEntry> = {}): BuildEntry => ({ number, hash: `aaaaaaaa000${number}`, verdict: 'ok', at: '', kept: true, ...over })
const result = (over: Partial<BuildResult> & { routing?: RoutingState }) => ({ verdict: 'ok', counts: { errors: 0 }, ...over }) as unknown as BuildResult

describe("the strip's nodes", () => {
  it('makes one node a build, oldest first, with the shown one ringed', () => {
    const nodes = stripNodes([entry(1), entry(2), entry(3)], { latest: 3, shown: null, facts: new Map() })
    expect(nodes.map((n) => [n.id, n.onShow])).toEqual([
      ['h1', false],
      ['h2', false],
      ['h3', true]
    ])
    expect(stripNodes([entry(1), entry(2)], { latest: 2, shown: 1, facts: new Map() }).map((n) => n.onShow)).toEqual([true, false])
  })

  it('rings the last build that drew something while the newest failed', () => {
    const nodes = stripNodes([entry(1), entry(2, { verdict: 'failed', hash: null, kept: false })], { latest: 1, shown: null, facts: new Map() })
    expect(nodes.map((n) => [n.id, n.onShow, n.caption, n.pick])).toEqual([
      ['h1', true, 'ok', true],
      ['h2', false, 'failed', false]
    ])
  })

  it('says a build that is not kept, and one that runs', () => {
    const nodes = stripNodes([entry(1, { kept: false }), entry(2, { verdict: 'running', hash: null, kept: false })], { latest: null, shown: null, facts: new Map() })
    expect(nodes.map((n) => [n.caption, n.kind, n.pick])).toEqual([
      ['not kept', 'gone', false],
      ['building', 'running', false]
    ])
  })

  it('captions a build by what is known of it: its routing, else its errors', () => {
    expect(captionOf(entry(1), factsOf(result({ routing: { state: 'current' } as RoutingState })))).toBe('routed')
    expect(captionOf(entry(1), factsOf(result({ routing: { state: 'stale' } as RoutingState })))).toBe('stale')
    expect(captionOf(entry(1), factsOf(result({ verdict: 'errors', counts: { errors: 2 } as never })))).toBe('2 errors')
    expect(captionOf(entry(1), factsOf(result({ verdict: 'errors', counts: { errors: 1 } as never })))).toBe('1 error')
    expect(captionOf(entry(1), factsOf(result({})))).toBe('ok')
    expect(captionOf(entry(1, { verdict: 'errors' }), undefined)).toBe('errors')
  })

  it('keeps one node a number, the later entry standing', () => {
    expect(stripNodes([entry(1, { verdict: 'failed' }), entry(1)], { latest: 1, shown: null, facts: new Map() })).toHaveLength(1)
  })
})
