// brief and add_card over a real cards store on a temp project, with a fab that answers parts as the engine does.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PromptRow } from '../../shared/chat'
import type { PartsQuery, PartsResult } from '../../shared/fab'
import { toolsOver } from '../../test/mcp'
import { CardStore } from '../cards/store'
import type { ToolDeps } from './tools'

let dir: string
let store: CardStore
let asked: PartsQuery[]
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pino-card-tools-'))
  store = new CardStore({ dirOf: (id) => (id === 'p1' ? dir : undefined) })
  asked = []
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const answer = (q: PartsQuery): PartsResult => ({
  schema: 'pino.parts/1', kind: 'get', query: {}, resolved: [], findings: [], headline: '',
  source: { url: '', fresh: true, fetched_at: null },
  parts: q.lcsc === 'C25804' ? [{ lcsc: 'C25804', mfr: 'x', package: '0603', description: '10k', stock: 1234567, price: 0.0024, class: 'basic', checked_at: '2026-11-26T05:00:00.000Z', fetched_at: '2026-11-26T06:00:00+00:00' }] : []
})

async function tools(opts: { down?: boolean; turn?: string; prompts?: PromptRow[] } = {}) {
  const lookup = async (q: PartsQuery): Promise<PartsResult> => {
    asked.push(q)
    if (!opts.down) return answer(q)
    return { ...answer({}), findings: [{ source: 'parts', code: 'parts_unavailable', severity: 'warning', message: 'down' }], headline: 'Parts: jlcsearch could not be reached' }
  }
  return toolsOver({
    project: () => ({ id: 'p1', dir, name: 'blinky' }),
    cards: store,
    turnNow: () => (opts.turn ? { prompt: opts.turn, conversation: 'c1' } : undefined),
    prompts: async () => opts.prompts ?? [],
    fab: { lookup } as unknown as ToolDeps['fab']
  })
}

describe('add_card and brief', () => {
  it('add_card adds a part with the reading main looked up, and brief reads it back', async () => {
    const { call } = await tools()
    expect(await call('add_card', { kind: 'part', lcsc: 'c25804', text: 'Pull-up: 10k for I2C' })).toBe('Added C1, part: C25804 is basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26).')
    expect(asked).toEqual([{ lcsc: 'C25804' }])
    expect(await call('brief')).toContain('C1 · part · by you: Pull-up: 10k for I2C · C25804 basic')
  })

  it('a part whose stock cannot be checked is still added, and says so', async () => {
    const { call } = await tools({ down: true })
    expect(await call('add_card', { kind: 'part', lcsc: 'C25804', text: 'R1' })).toBe('Added C1, part: stock not checked (jlcsearch could not be reached). The person can check it again on the Brief.')
    expect((await store.read('p1')).cards[0].part).toEqual({ lcsc: 'C25804' })
  })

  it('says so of a number JLC does not have, and of a lookup that throws', async () => {
    const { call } = await tools()
    expect(await call('add_card', { kind: 'part', lcsc: 'C1', text: 'x' })).toMatch(/^Added C1, part: C1: JLC has no such part \(checked \d{4}-\d\d-\d\d\)\. Check the number\.$/)
    const broken = await toolsOver({ project: () => ({ id: 'p1', dir, name: 'blinky' }), cards: store, turnNow: () => undefined, prompts: async () => [], fab: { lookup: () => Promise.reject(new Error('The engine did not start: no uv')) } as unknown as ToolDeps['fab'] })
    expect(await broken.call('add_card', { kind: 'part', lcsc: 'C2', text: 'x' })).toBe('Added C2, part: stock not checked (The engine did not start: no uv). The person can check it again on the Brief.')
  })

  it('changes and removes a card of its own, looking up a number only when it is given', async () => {
    const { call } = await tools()
    await call('add_card', { kind: 'decision', text: 'Power: USB-C' })
    expect(await call('add_card', { card: 'C1', text: 'Power: a LiPo cell' })).toBe('Changed C1.')
    await call('add_card', { kind: 'part', lcsc: 'C1', text: 'LDO' })
    asked.length = 0
    await call('add_card', { card: 'C2', text: 'LDO: 600 mA' })
    expect(asked).toEqual([])
    expect(await call('add_card', { card: 'C2', lcsc: 'C25804' })).toBe('Changed C2: C25804 is basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26).')
    expect(await call('add_card', { card: 'C1', remove: true })).toBe('Removed C1.')
    expect((await store.read('p1')).cards.map((c) => c.id)).toEqual(['C2'])
  })

  it("refuses the person's card, a second change shape and an empty card", async () => {
    await store.person('p1', { op: 'add', kind: 'note', text: 'mine' })
    const { result, call } = await tools()
    const theirs = await result('add_card', { card: 'C1', text: 'x' })
    expect([theirs.isError, theirs.content[0].text]).toEqual([true, expect.stringContaining("C1 is the person's")])
    for (const [args, why] of [
      [{}, 'add_card needs kind and text, size or lcsc: nothing was done.'],
      [{ kind: 'note' }, 'add_card needs kind and text, size or lcsc: nothing was done.'],
      [{ text: 'x' }, 'add_card needs kind and text, size or lcsc: nothing was done.'],
      [{ remove: true }, 'give card with its id'],
      [{ card: 'x1', text: 'y' }, 'give card with its id'],
      [{ card: 'C1', remove: true, text: 'y' }, 'remove takes only the id'],
      [{ card: 'C1' }, 'A change of a card gives text, size or lcsc: nothing was done.'],
      [{ card: 'C1', kind: 'rule', text: 'y' }, 'A card keeps its kind']
    ] as const) {
      const said = await result('add_card', args)
      expect([said.isError, said.content[0].text]).toEqual([true, expect.stringContaining(why)])
    }
    expect((await store.read('p1')).cards).toHaveLength(1)
    expect(await call('brief')).toContain('C1 · note · by the person: mine')
  })

  it('stamps the card with the prompt the session is answering', async () => {
    const { call } = await tools({ turn: 'u7', prompts: [{ conversation: 'c1', id: 'u7', number: 3, text: 'x', at: 1 }] })
    await call('add_card', { kind: 'note', text: 'a' })
    expect((await store.read('p1')).cards[0].turn).toEqual({ prompt: 'u7', conversation: 'c1' })
    expect(await call('brief')).toContain('C1 · note · by you, prompt 3: a')
  })

  it("brief gives brief.md's words first, cut at its limit, and narrows to a kind", async () => {
    writeFileSync(join(dir, 'brief.md'), `# blinky\n\nBlinks an LED. ${'x'.repeat(3000)}\n`)
    await store.person('p1', { op: 'add', kind: 'rule', text: '0603 or larger' })
    await store.person('p1', { op: 'add', kind: 'note', text: 'ask about the case' })
    const { call } = await tools()
    const all = await call('brief')
    expect(all).toContain("brief.md, the person's words:\nBlinks an LED.")
    expect(all).toContain('the rest is in brief.md')
    expect(all.indexOf('Blinks an LED.')).toBeLessThan(all.indexOf('C1 · rule'))
    expect(await call('brief', { kind: 'rule' })).toBe('C1 · rule · by the person: 0603 or larger')
    expect(await call('brief', { kind: 'power' })).toBe('The Brief has no power card.')
  })
})
