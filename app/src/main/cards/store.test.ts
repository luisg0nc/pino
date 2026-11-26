import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seenOf } from '../../shared/brief'
import { type Card, type CardsFile, MAX_TEXT_CHARS, MAX_WAS, type PartReading } from '../../shared/cards'
import { CardStore, REMOVED_KEPT } from './store'

const P = 'bracket'
let root: string
let dirs: Record<string, string>
let clock: number
let store: CardStore
let changes: Array<{ projectId: string; file: CardsFile }>
let problems: string[]

const OLD: PartReading = { class: 'basic', package: '0603', stock: 10, price: 0.0024, checkedAt: '2026-11-20T06:00:00.000Z', fresh: false }
const NEW: PartReading = { class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true }

const folder = (id = P): string => join(dirs[id], '.pino', 'brief')
const onDisk = (id = P): CardsFile => JSON.parse(readFileSync(join(folder(id), 'cards.json'), 'utf8'))
const note = (text = 'hello') => ({ op: 'add' as const, kind: 'note' as const, text })
const byId = (file: CardsFile, id: string): Card => file.cards.find((c) => c.id === id) as Card
const at = (ms: number): string => new Date(ms).toISOString()
const turn = (prompt: string) => ({ prompt, conversation: 'c1' })

function newStore(): CardStore {
  return new CardStore({ dirOf: (id) => dirs[id], now: () => new Date(clock), onChange: (projectId, file) => changes.push({ projectId, file }), onProblem: (_projectId, message) => problems.push(message) })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pino-cards-store-'))
  dirs = { bracket: join(root, 'bracket'), two: join(root, 'two') }
  for (const dir of Object.values(dirs)) mkdirSync(dir)
  clock = Date.UTC(2026, 10, 26, 9, 12)
  changes = []
  problems = []
  store = newStore()
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('reading', () => {
  it('is no cards for a project with none, and writes nothing', async () => {
    expect(await store.read(P)).toEqual({ next: 1, cards: [] })
    expect(changes).toEqual([])
    expect(() => readFileSync(join(folder(), 'cards.json'))).toThrow()
  })

  it('rejects for a project that is not open', async () => {
    await expect(store.read('nope')).rejects.toThrow(/no project named nope/)
  })

  it('gives a copy: what the caller does to it is not the store’s', async () => {
    await store.person(P, note())
    const file = await store.read(P)
    file.cards.length = 0
    expect((await store.read(P)).cards).toHaveLength(1)
  })

  it('a file it could not read is said once, and the next read says nothing', async () => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(join(folder(), 'cards.json'), '<<<<<<< HEAD')
    await store.read(P)
    await store.read(P)
    await store.person(P, note())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/could not be read/)
  })
})

describe('the person’s changes', () => {
  it('lands two changes made at once, each with its own id', async () => {
    const [a, b] = await Promise.all([store.person(P, note('a')), store.person(P, note('b'))])
    expect(a.cards.map((c) => c.id)).toEqual(['C1'])
    expect(b.cards.map((c) => c.id)).toEqual(['C1', 'C2'])
    expect(onDisk().cards.map((c) => c.id)).toEqual(['C1', 'C2'])
  })

  it('reads what is on disk in a new run, and goes on from its numbers', async () => {
    await store.person(P, note())
    await store.person(P, { op: 'remove', ids: ['C1'] })
    const again = newStore()
    expect((await again.person(P, note())).cards.map((c) => c.id)).toEqual(['C2'])
  })

  it('tells nothing of a change that waited out a forget', async () => {
    const wait = store.person(P, note())
    store.forget(P)
    await wait
    expect(changes).toEqual([])
  })

  it('gives ids C1, C2 in order, and never again after a remove', async () => {
    await store.person(P, note('a'))
    await store.person(P, note('b'))
    await store.person(P, { op: 'remove', ids: ['C2'] })
    const file = await newStore().person(P, note('c'))
    expect(file.cards.map((c) => c.id)).toEqual(['C1', 'C3'])
    expect(onDisk()).toEqual(file)
  })

  it('makes a card the person’s, with the time and only what its kind says', async () => {
    const file = await store.person(P, { op: 'add', kind: 'note', text: 'x', id: 'C99', by: 'agent', turn: { prompt: 'u9' }, at: '2001-01-01T00:00:00.000Z', was: [{ text: 'y' }], fab: { layers: 2 } } as never)
    expect(file.cards).toEqual([{ id: 'C1', kind: 'note', by: 'person', text: 'x', at: at(clock) }])
    expect(changes).toEqual([{ projectId: P, file }])
  })

  it('takes a size, a fab ask and a part, each checked; the part’s reading is the stamp’s alone', async () => {
    await store.person(P, { op: 'add', kind: 'size', size: { what: 'Board width', value: '50', unit: 'mm', source: 'a guess' } })
    await store.person(P, { op: 'add', kind: 'fab', fab: { layers: 4, thickness: 1.6, assembly: 'hand', boards: 3 } })
    const file = await store.person(P, { op: 'add', kind: 'part', lcsc: 'C25804', text: 'R', reading: OLD } as never, { reading: NEW })
    expect(file.cards.map((c) => [c.kind, c.size?.value, c.fab?.layers, c.part])).toEqual([
      ['size', '50', undefined, undefined],
      ['fab', undefined, 4, undefined],
      ['part', undefined, undefined, { lcsc: 'C25804', reading: NEW }]
    ])
    expect(await newStore().read(P)).toEqual(file)
  })

  it('refuses a frame, a size or fab ask that is not whole, a bad part number and too long a text, and keeps nothing', async () => {
    for (const change of [
      { op: 'add', kind: 'frame', text: 'F' },
      { op: 'add', kind: 'picture' },
      { op: 'add', kind: 'size', size: { what: 'x', value: '1', unit: 'cm', source: 'measured' } },
      { op: 'add', kind: 'fab', fab: { layers: 3, thickness: 1.6, assembly: 'jlc', boards: 5 } },
      { op: 'add', kind: 'fab', fab: { layers: 2, thickness: 1.6, assembly: 'jlc', boards: 10_001 } },
      { op: 'add', kind: 'part', lcsc: 'R1' },
      note('x'.repeat(MAX_TEXT_CHARS + 1))
    ]) {
      await expect(store.person(P, change as never)).rejects.toThrow()
    }
    expect((await store.read(P)).cards).toEqual([])
  })

  it('edits the person’s own card, and writes nothing for an edit that says the same', async () => {
    await store.person(P, note('hello'))
    const before = readFileSync(join(folder(), 'cards.json'), 'utf8')
    clock += 60_000
    await store.person(P, { op: 'edit', id: 'C1', text: 'hello' })
    expect(readFileSync(join(folder(), 'cards.json'), 'utf8')).toBe(before)
    const file = await store.person(P, { op: 'edit', id: 'C1', text: 'new' })
    expect(byId(file, 'C1')).toMatchObject({ text: 'new', at: at(clock) })
    expect(byId(file, 'C1').was).toBeUndefined()
  })

  it('does not change the words of a card of Claude’s that is not made theirs, and may take it down', async () => {
    await store.agent(P, { op: 'add', kind: 'decision', text: 'Power: USB-C' }, {})
    await expect(store.person(P, { op: 'edit', id: 'C1', text: 'x' })).rejects.toThrow("C1 is Claude's: make it yours first.")
    expect((await store.person(P, { op: 'remove', ids: ['C1'] })).cards).toEqual([])
  })

  it('puts back what was removed this run, as it was, whatever the window says of it', async () => {
    await store.agent(P, { op: 'add', kind: 'note', text: 'mine' }, { turn: turn('u1') })
    const was = byId(await store.read(P), 'C1')
    await store.person(P, { op: 'remove', ids: ['C1'] })
    const file = await store.person(P, { op: 'restore', ids: ['C1', 'C7'] })
    expect(file.cards).toEqual([was])
  })

  it('keeps the last 200 things removed, and no more', async () => {
    for (let n = 0; n <= REMOVED_KEPT; n++) await store.person(P, note())
    const ids = (await store.read(P)).cards.map((c) => c.id)
    await store.person(P, { op: 'remove', ids })
    expect((await store.person(P, { op: 'restore', ids })).cards).toHaveLength(REMOVED_KEPT)
  })
})

describe('the agent’s changes', () => {
  it("an agent changes only its own cards: the person's are refused in words", async () => {
    await store.person(P, note("the person's"))
    const before = readFileSync(join(folder(), 'cards.json'), 'utf8')
    await expect(store.agent(P, { op: 'edit', id: 'C1', text: 'x' }, {})).rejects.toThrow("C1 is the person's: you may change or remove only your own cards. Add a card of yours instead.")
    await expect(store.agent(P, { op: 'remove', id: 'C1' }, {})).rejects.toThrow("C1 is the person's")
    await expect(store.agent(P, { op: 'remove', id: 'C9' }, {})).rejects.toThrow('There is no card C9 in the Brief.')
    expect(readFileSync(join(folder(), 'cards.json'), 'utf8')).toBe(before)
  })

  it('stamps the prompt and the time, and keeps what an edit replaced, at most six', async () => {
    const first = clock
    const added = await store.agent(P, { op: 'add', kind: 'decision', text: 'v0' }, { turn: turn('u1') })
    expect([added.id, byId(added.file, 'C1')]).toEqual(['C1', { id: 'C1', kind: 'decision', by: 'agent', text: 'v0', turn: turn('u1'), at: at(first) }])
    clock += 60_000
    const same = await store.agent(P, { op: 'edit', id: 'C1', text: 'v0' }, { turn: turn('u2') })
    expect(byId(same.file, 'C1')).toEqual(byId(added.file, 'C1'))
    const changed = await store.agent(P, { op: 'edit', id: 'C1', text: 'v1' }, { turn: turn('u3') })
    expect(byId(changed.file, 'C1')).toMatchObject({ text: 'v1', turn: turn('u3'), at: at(clock), was: [{ text: 'v0', turn: turn('u1'), at: at(first) }] })
    for (let n = 2; n <= 7; n++) await store.agent(P, { op: 'edit', id: 'C1', text: `v${n}` }, { turn: turn(`u${n + 2}`) })
    const was = byId(await store.read(P), 'C1').was ?? []
    expect(was).toHaveLength(MAX_WAS)
    expect([was[0].text, was.at(-1)?.text]).toEqual(['v1', 'v6'])
  })

  it('a card changed between turns has no prompt', async () => {
    await store.agent(P, { op: 'add', kind: 'note', text: 'a' }, { turn: turn('u1') })
    const { file } = await store.agent(P, { op: 'edit', id: 'C1', text: 'b' }, {})
    expect(byId(file, 'C1').turn).toBeUndefined()
  })

  it('a size or part needs its own field, and a part an LCSC number', async () => {
    await expect(store.agent(P, { op: 'add', kind: 'part', text: 'MCU' }, {})).rejects.toThrow('A part card names its part by LCSC number, such as lcsc: "C2838500". Nothing was done.')
    await expect(store.agent(P, { op: 'add', kind: 'part', lcsc: 'R1' }, {})).rejects.toThrow('A part card names its part by LCSC number')
    await expect(store.agent(P, { op: 'add', kind: 'size', text: 'wide' }, {})).rejects.toThrow('A size card takes size, not text')
    await expect(store.agent(P, { op: 'add', kind: 'note', text: 'x', lcsc: 'C1' }, {})).rejects.toThrow('Only a part card takes lcsc')
    await expect(store.agent(P, { op: 'add', kind: 'note', size: { what: 'x', value: '1' } }, {})).rejects.toThrow('Only a size card takes size')
    await expect(store.agent(P, { op: 'add', kind: 'decision' }, {})).rejects.toThrow('A decision card has some text')
    await expect(store.agent(P, { op: 'add', kind: 'fab' as never, text: 'x' }, {})).rejects.toThrow()
    expect((await store.read(P)).cards).toEqual([])
  })

  it('a size of Claude’s is from Claude, and its earlier words are the size as it was said', async () => {
    await store.agent(P, { op: 'add', kind: 'size', size: { what: 'Board width', value: '50' } }, {})
    await expect(store.agent(P, { op: 'edit', id: 'C1', text: 'wide' }, {})).rejects.toThrow('A size card takes size, not text')
    const { file } = await store.agent(P, { op: 'edit', id: 'C1', size: { what: 'Board width', value: '56' } }, {})
    expect(byId(file, 'C1')).toMatchObject({ size: { value: '56', source: 'from Claude' }, was: [{ text: 'Board width 50 mm (from Claude)' }] })
  })

  it('a part keeps the reading main gave, takes another number with its own, and says the old one in what it was', async () => {
    await store.agent(P, { op: 'add', kind: 'part', lcsc: 'C25804', text: 'Pull-up' }, { reading: NEW })
    const words = await store.agent(P, { op: 'edit', id: 'C1', text: 'Pull-up: 10k' }, {})
    expect(byId(words.file, 'C1')).toMatchObject({ part: { lcsc: 'C25804', reading: NEW }, was: [{ text: 'Pull-up' }] })
    const other = await store.agent(P, { op: 'edit', id: 'C1', lcsc: 'C51118' }, {})
    expect(byId(other.file, 'C1').part).toEqual({ lcsc: 'C51118' })
    expect(byId(other.file, 'C1').was?.at(-1)?.text).toBe('C25804: Pull-up: 10k')
  })

  it('removes a card of its own, which the person may put back', async () => {
    await store.agent(P, { op: 'add', kind: 'note', text: 'a' }, {})
    expect((await store.agent(P, { op: 'remove', id: 'C1' }, {})).file.cards).toEqual([])
    expect((await store.person(P, { op: 'restore', ids: ['C1'] })).cards).toHaveLength(1)
  })

  it('takes one change at a time with the person’s', async () => {
    await Promise.all([store.agent(P, { op: 'add', kind: 'note', text: 'a' }, {}), store.person(P, note('b'))])
    expect(onDisk().cards.map((c) => c.id)).toEqual(['C1', 'C2'])
  })
})

describe('making a card of Claude’s yours (#339)', () => {
  it('make it yours keeps who wrote it, in which prompt and when', async () => {
    await store.agent(P, note('a'), { turn: turn('u1') })
    await store.agent(P, note('b'), { turn: turn('u1') })
    await store.agent(P, { op: 'add', kind: 'decision', text: 'Controls: 9 buttons' }, { turn: turn('u13') })
    const wrote = at(clock)
    clock += 60_000
    const file = await store.person(P, { op: 'adopt', id: 'C3' })
    expect(byId(file, 'C3')).toMatchObject({ by: 'person', from: { by: 'agent', turn: turn('u13'), at: wrote, since: at(clock) }, at: at(clock) })
    expect(byId(file, 'C3').turn).toBeUndefined()
    await expect(store.agent(P, { op: 'edit', id: 'C3', text: 'mine again' }, {})).rejects.toThrow("C3 is the person's")
    const edited = await store.person(P, { op: 'edit', id: 'C3', text: 'Controls: 3 toggles' })
    expect(byId(await newStore().read(P), 'C3')).toEqual(byId(edited, 'C3'))
  })

  it('makes a size of Claude’s the person’s with its source, which they must say when they edit it', async () => {
    await store.agent(P, { op: 'add', kind: 'size', size: { what: 'encoder hole', value: '7' } }, {})
    await store.person(P, { op: 'adopt', id: 'C1' })
    expect(byId(await newStore().read(P), 'C1')).toMatchObject({ by: 'person', size: { source: 'from Claude' } })
    await expect(store.person(P, { op: 'edit', id: 'C1', size: { what: 'encoder hole', value: '7.2', unit: 'mm', source: 'from Claude' } })).rejects.toThrow(/say where/)
    const edited = await store.person(P, { op: 'edit', id: 'C1', size: { what: 'encoder hole', value: '7.2', unit: 'mm', source: 'measured' } })
    expect(byId(edited, 'C1').size).toMatchObject({ value: '7.2', source: 'measured' })
  })

  it('refuses a card that is not Claude’s, and one that is not there', async () => {
    await store.person(P, note())
    await expect(store.person(P, { op: 'adopt', id: 'C1' })).rejects.toThrow(/not Claude/)
    await expect(store.person(P, { op: 'adopt', id: 'C9' })).rejects.toThrow('There is no card C9 in the Brief.')
  })
})

describe('a new reading of a part', () => {
  it('changes neither was nor what the person has seen', async () => {
    const { id } = await store.agent(P, { op: 'add', kind: 'part', lcsc: 'C25804', text: 'Pull-up: 10k' }, { reading: OLD })
    const seen = await store.markSeen(P)
    const made = (await store.read(P)).cards[0]
    clock += 60_000
    const after = await store.restock(P, id, NEW)
    expect(after.cards[0]).toEqual({ ...made, part: { lcsc: 'C25804', reading: NEW } })
    expect(seenOf(after.cards, seen.at)).toEqual(seen)
  })

  it('is for a part with a number alone', async () => {
    await store.person(P, note())
    await expect(store.restock(P, 'C1', NEW)).rejects.toThrow('C1 is no part with an LCSC number')
    await expect(store.restock(P, 'C9', NEW)).rejects.toThrow('There is no card C9 in the Brief.')
  })
})

describe('a cards file changed from outside', () => {
  const pulled = (): void => {
    const file = onDisk()
    file.cards.push({ id: 'C9', kind: 'note', by: 'person', text: 'from the pull' })
    file.next = 10
    writeFileSync(join(folder(), 'cards.json'), `${JSON.stringify(file, null, 2)}\n`)
  }

  it('is taken as the base of the next change, which goes on top, and the window is told', async () => {
    await store.person(P, note())
    pulled()
    changes.length = 0
    const file = await store.person(P, note())
    expect(file.cards.map((c) => c.id)).toEqual(['C1', 'C9', 'C10'])
    expect(changes.map((c) => c.file.cards.length)).toEqual([2, 3])
  })

  it('is taken up by refresh, which tells the window, and says nothing when the file is as main left it', async () => {
    await store.person(P, note())
    changes.length = 0
    await store.refresh(P)
    expect(changes).toEqual([])
    pulled()
    await store.refresh(P)
    expect(changes.map((c) => c.file.cards.length)).toEqual([2])
    expect((await store.read(P)).cards).toHaveLength(2)
  })

  it('is read again after forget', async () => {
    await store.person(P, note())
    store.forget(P)
    pulled()
    expect((await store.read(P)).cards).toHaveLength(2)
  })
})

describe('seen.json and told.json', () => {
  it('seen.json and told.json are ignored by git; cards.json is not', async () => {
    await store.agent(P, { op: 'add', kind: 'note', text: 'a' }, {})
    await store.markSeen(P)
    await store.markTold(P, { C1: 'abc' })
    const ignored = readFileSync(join(dirs.bracket, '.pino', '.gitignore'), 'utf8').split('\n')
    expect(ignored).toEqual(expect.arrayContaining(['brief/seen.json', 'brief/told.json']))
    expect(ignored).not.toContain('brief/cards.json')
  })

  it('are nothing for a project that has none or whose file cannot be read, and keep what was marked', async () => {
    expect([await store.seen(P), await store.told(P)]).toEqual([null, {}])
    await store.agent(P, { op: 'add', kind: 'note', text: 'a' }, {})
    await store.person(P, note())
    const seen = await store.markSeen(P)
    expect(Object.keys(seen.cards)).toEqual(['C1'])
    expect(seen.at).toBe(at(clock))
    await store.markTold(P, { C1: 'abc' })
    expect([await newStore().seen(P), await newStore().told(P)]).toEqual([seen, { C1: 'abc' }])
    writeFileSync(join(folder(), 'seen.json'), 'not json')
    writeFileSync(join(folder(), 'told.json'), '[1]')
    expect([await newStore().seen(P), await newStore().told(P)]).toEqual([null, {}])
  })
})
