import { describe, expect, it } from 'vitest'
import type { BuildEntry, BuildResult, RoutingState } from '../../../shared/build'
import type { ProjectUsage, UsageRow } from '../../../shared/usage'
import { buildNamed, captionOf, chipCost, factsOf, groupCount, groupTitle, stripGroups, stripNodes, stripSays } from './strip'

const entry = (number: number, over: Partial<BuildEntry> = {}): BuildEntry => ({ number, hash: `aaaaaaaa000${number}`, verdict: 'ok', at: '', kept: true, ...over })
const agent = (number: number, prompt: string, over: Partial<BuildEntry> = {}): BuildEntry => entry(number, { cause: 'agent', turn: { prompt }, ...over })
const result = (over: Partial<BuildResult> & { routing?: RoutingState }) => ({ verdict: 'ok', counts: { errors: 0 }, ...over }) as unknown as BuildResult
const at = (latest: number | null, shown: number | null = null) => ({ latest, shown, facts: new Map() })
const numbering = new Map([
  ['u13', 13],
  ['u14', 14]
])

describe("the timeline's nodes", () => {
  it('makes one node a build, oldest first, with the shown one ringed', () => {
    const nodes = stripNodes([entry(1), entry(2), entry(3)], at(3))
    expect(nodes.map((n) => [n.id, n.onShow])).toEqual([
      ['h1', false],
      ['h2', false],
      ['h3', true]
    ])
    expect(stripNodes([entry(1), entry(2)], at(2, 1)).map((n) => n.onShow)).toEqual([true, false])
  })

  it('rings the last build that drew something while the newest failed', () => {
    const nodes = stripNodes([entry(1), entry(2, { verdict: 'failed', hash: null, kept: false })], at(1))
    expect(nodes.map((n) => [n.id, n.onShow, n.caption, n.pick])).toEqual([
      ['h1', true, 'ok', true],
      ['h2', false, 'failed', false]
    ])
  })

  it('says a build that is not kept, and one that runs', () => {
    const nodes = stripNodes([entry(1, { kept: false }), entry(2, { verdict: 'running', hash: null, kept: false })], at(null))
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
    expect(stripNodes([entry(1, { verdict: 'failed' }), entry(1)], at(1))).toHaveLength(1)
  })

  it('names what made a build: its prompt by number, the person, their route, an earlier run', () => {
    const nodes = stripNodes([entry(1), agent(2, 'u13'), entry(3, { cause: 'person' }), entry(4, { cause: 'route' }), agent(5, 'gone')], at(5), numbering)
    expect(nodes.map((n) => [n.by, n.saved, n.prompt])).toEqual([
      ['Earlier', false, undefined],
      ['Prompt 13', false, 13],
      ['Saved by you', true, undefined],
      ['Routed by you', true, undefined],
      ['Claude Code', false, undefined]
    ])
  })

  it('leaves a running build that nothing is known of nobody\'s, and names one of a prompt', () => {
    const running = (over: Partial<BuildEntry>) => entry(9, { verdict: 'running', hash: null, kept: false, ...over })
    expect(stripNodes([running({})], at(null))[0]!.by).toBe('')
    expect(stripNodes([running({ cause: 'agent', turn: { prompt: 'u14' } })], at(null), numbering)[0]!.by).toBe('Prompt 14')
  })
})

describe("the timeline's groups", () => {
  it("makes one group of a prompt's builds, labelled by its number, its last build the one shown", () => {
    const groups = stripGroups(stripNodes([agent(1, 'u13'), agent(2, 'u14'), agent(3, 'u14'), agent(4, 'u14')], at(4), numbering))
    expect(groups.map((g) => [g.label, groupCount(g), g.last.id])).toEqual([
      ['Prompt 13', 1, 'h1'],
      ['Prompt 14', 3, 'h4']
    ])
    expect(groups[1]).toMatchObject({ id: 'h2', prompt: 14, onShow: true })
    expect(groups[0]!.onShow).toBe(false)
  })

  it('makes one "Saved by you" group of saves in a row, and one "Earlier" of an earlier run', () => {
    const history = [entry(1), entry(2), entry(3, { cause: 'person' }), entry(4, { cause: 'person' }), entry(5, { cause: 'route' }), agent(6, 'u14')]
    const groups = stripGroups(stripNodes(history, at(6), numbering))
    expect(groups.map((g) => [g.label, groupCount(g), g.saved])).toEqual([
      ['Earlier', 2, false],
      ['Saved by you', 2, true],
      ['Routed by you', 1, true],
      ['Prompt 14', 1, false]
    ])
  })

  it("splits a prompt's builds when something else came between them, and keeps two prompts apart", () => {
    const history = [agent(1, 'u13'), entry(2, { cause: 'person' }), agent(3, 'u13'), agent(4, 'u14')]
    expect(stripGroups(stripNodes(history, at(4), numbering)).map((g) => g.label)).toEqual(['Prompt 13', 'Saved by you', 'Prompt 13', 'Prompt 14'])
  })

  it("counts a failed build in its prompt's group and says the group ended in a failure", () => {
    const [group] = stripGroups(stripNodes([agent(1, 'u14'), agent(2, 'u14', { verdict: 'failed', hash: null, kept: false })], at(1), numbering))
    expect(group).toMatchObject({ label: 'Prompt 14', state: 'failed', onShow: true })
    expect(groupCount(group!)).toBe(2)
  })

  it("puts the running build in its prompt's group, and one nobody can say in a group of its own", () => {
    const running = (over: Partial<BuildEntry>) => entry(2, { verdict: 'running', hash: null, kept: false, ...over })
    const mine = stripGroups(stripNodes([agent(1, 'u14'), running({ cause: 'agent', turn: { prompt: 'u14' } })], at(1), numbering))
    expect(mine.map((g) => [g.label, groupCount(g), g.state])).toEqual([['Prompt 14', 2, 'running']])
    const nobody = stripGroups(stripNodes([entry(1), running({})], at(1)))
    expect(nobody.map((g) => [g.label, g.state])).toEqual([
      ['Earlier', 'built'],
      ['Building', 'running']
    ])
  })

  it('is none for no node', () => {
    expect(stripGroups([])).toEqual([])
  })
})

describe("a group's title", () => {
  it("gives a prompt's words and how many builds, never in the label", () => {
    const [group] = stripGroups(stripNodes([agent(1, 'u14'), agent(2, 'u14')], at(2), numbering))
    expect(group!.label).toBe('Prompt 14')
    expect(groupTitle(group!, new Map([[14, 'Move the LED to the edge']]))).toBe('Prompt 14: Move the LED to the edge\n2 builds, h1 to h2, h2 on show')
  })

  it('says a lone build, a failure, and a group of no prompt by its label', () => {
    const [saved] = stripGroups(stripNodes([entry(3, { cause: 'person', verdict: 'failed', hash: null, kept: false })], at(null)))
    expect(groupTitle(saved!)).toBe('Saved by you\nh3, failed')
  })
})

describe('a build named in words', () => {
  const nodes = stripNodes([entry(1), agent(2, 'u13'), entry(3, { cause: 'person' }), agent(4, 'u14')], at(4), numbering)

  it('names the newest build as the latest, with what made it in the timeline\'s words', () => {
    expect(buildNamed(nodes, 4)).toEqual({ id: 'h4', head: 'Latest build · prompt 14', latest: true })
    expect(buildNamed(stripNodes([entry(1, { cause: 'person' })], at(1)), 1)!.head).toBe('Latest build · saved by you')
    expect(buildNamed(stripNodes([entry(1, { cause: 'route' })], at(1)), 1)!.head).toBe('Latest build · routed by you')
    expect(buildNamed(stripNodes([agent(1, 'gone')], at(1)), 1)!.head).toBe('Latest build · Claude Code')
    expect(buildNamed(stripNodes([entry(1)], at(1)), 1)!.head).toBe('Latest build')
  })

  it('names an older build by what made it, and says it is older', () => {
    expect(buildNamed(nodes, 2)).toEqual({ id: 'h2', head: 'Prompt 13 · older build', latest: false })
    expect(buildNamed(nodes, 1)!.head).toBe('Earlier · older build')
  })

  it('names a failed newest build the latest, and a running one does not count', () => {
    const failed = stripNodes([agent(1, 'u13'), agent(2, 'u14', { verdict: 'failed', hash: null, kept: false }), entry(3, { verdict: 'running', hash: null, kept: false })], at(1), numbering)
    expect(buildNamed(failed, 2)).toMatchObject({ head: 'Latest build · prompt 14', latest: true })
    expect(buildNamed(failed, 1)!.latest).toBe(false)
  })

  it('is null for a build the timeline does not have, or one that runs', () => {
    expect(buildNamed(nodes, 9)).toBeNull()
    expect(buildNamed(stripNodes([entry(1, { verdict: 'running', hash: null, kept: false })], at(null)), 1)).toBeNull()
  })
})

describe("a prompt chip's cost", () => {
  const row = (number: number, costUsd?: number): UsageRow => ({ conversation: 'c', id: `u${number}`, number, text: '', at: number, turns: [`t${number}`], facts: { pictures: {}, builds: { count: 0 } }, usage: { input: 0, output: 1, cacheRead: 1, cacheCreation: 0, ...(costUsd !== undefined ? { costUsd } : {}) } })
  const usage: ProjectUsage = { rows: [row(13, 0.95), row(14, 0.64), row(15, 7.05), row(16)], median: 0.95 }
  const groupOf = (prompt: number) => stripGroups(stripNodes([agent(1, `u${prompt}`)], at(1), new Map([[`u${prompt}`, prompt]])))[0]!

  it("says a prompt group's cost, the large one marked", () => {
    expect(chipCost(groupOf(14), usage)).toEqual({ text: '$0.64', large: false })
    expect(chipCost(groupOf(15), usage)).toEqual({ text: '$7.05', large: true })
  })

  it('says nothing for a group that is no prompt, a prompt whose cost is not known, or before usage is read', () => {
    expect(chipCost(stripGroups(stripNodes([entry(1, { cause: 'person' })], at(1)))[0]!, usage)).toBeNull()
    expect(chipCost(groupOf(16), usage)).toBeNull()
    expect(chipCost(groupOf(14), undefined)).toBeNull()
  })
})

describe('what a pick does', () => {
  it('says it, says a build runs, and says an older build is on show', () => {
    expect(stripSays(stripNodes([entry(1), entry(2)], at(2)))).toBe('Pick one to show it in the views')
    expect(stripSays(stripNodes([entry(1), entry(2, { verdict: 'running', hash: null, kept: false })], at(1)))).toBe('A build is running')
    expect(stripSays(stripNodes([entry(1), entry(2)], at(2, 1)))).toBe('h1 is on show: pick the newest to go back')
  })
})
