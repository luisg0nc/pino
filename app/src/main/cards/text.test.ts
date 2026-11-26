import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Card, type CardsFile, emptyCards, type PartReading } from '../../shared/cards'
import { BRIEF_LIMIT, cardLine, cardsLine, cardsText, CUT_SENTENCE, MAX_BRIEF_CHARS, readBrief } from './text'

const READING: PartReading = { class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true }
const part = (id: string, by: Card['by'], text: string, lcsc: string, reading?: PartReading, prompt?: string): Card => ({ id, kind: 'part', by, text, part: { lcsc, ...(reading ? { reading } : {}) }, ...(prompt ? { turn: { prompt } } : {}) })
const power = (id: string, by: Card['by'], text: string): Card => ({ id, kind: 'power', by, text })
const file = (cards: Card[]): CardsFile => ({ next: 99, cards })
const tool = (t: string): string => `mcp__pino__${t}`
const file3 = file([power('C1', 'person', 'USB-C, 5 V'), { id: 'C2', kind: 'rule', by: 'person', text: '0603 or larger' }, { id: 'C3', kind: 'note', by: 'person', text: 'a' }])

describe('a card in a line', () => {
  it('says each card in one line with its author and prompt', () => {
    expect(cardLine(part('C7', 'agent', 'Pull-up: 10k for I2C', 'C25804', READING, 'u1'), new Map([['u1', 3]]))).toBe('C7 · part · by you, prompt 3: Pull-up: 10k for I2C · C25804 basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)')
    expect(cardLine(power('C2', 'person', 'USB-C, 5 V, 0.5 A'))).toBe('C2 · power · by the person: USB-C, 5 V, 0.5 A')
  })

  it('says a size, a fab ask, a part with no reading or no number, and text over lines as one', () => {
    expect(cardLine({ id: 'C1', kind: 'size', by: 'person', size: { what: 'Board width', value: '50', unit: 'mm', source: 'measured' } })).toBe('C1 · size · by the person: Board width 50 mm (measured)')
    expect(cardLine({ id: 'C2', kind: 'fab', by: 'person', fab: { layers: 2, thickness: 1.6, assembly: 'jlc', boards: 5 } })).toBe('C2 · fab · by the person: 2 layers, 1.6 mm, JLC assembles it, 5 boards')
    expect(cardLine(part('C3', 'agent', 'LDO', 'C51118'))).toBe('C3 · part · by you: LDO · C51118 stock not checked')
    expect(cardLine({ id: 'C4', kind: 'part', by: 'person', text: 'ESP32-C3 module: in the drawer' })).toBe('C4 · part · by the person: ESP32-C3 module: in the drawer')
    expect(cardLine({ id: 'C5', kind: 'link', by: 'person', text: 'https://x.dev/a\nthe  datasheet' })).toBe('C5 · link · by the person: https://x.dev/a the datasheet')
  })

  it('says a card the person made theirs is theirs now, and was Claude’s, in which prompt (#339)', () => {
    const adopted: Card = { id: 'C1', kind: 'decision', by: 'person', text: 'USB-C', from: { by: 'agent', turn: { prompt: 'u3' } } }
    expect(cardLine(adopted, new Map([['u3', 4]]))).toBe('C1 · decision · by the person (it was yours, prompt 4: theirs now, not yours to change): USB-C')
  })
})

describe('the text of the Brief', () => {
  const cards = file([{ id: 'C1', kind: 'frame', by: 'person', name: 'Power' }, power('C4', 'agent', 'loose'), { ...power('C2', 'person', 'USB-C'), frame: 'C1' }])

  it('has brief.md’s words first, then each frame with its cards, then the loose cards', () => {
    expect(cardsText(cards, { brief: '# blinky\n\nBlinks.\n\n## References\n\n- reference/photo-1.png\n', limit: 8000 })).toBe(
      "brief.md, the person's words:\nBlinks.\n\nC1 · frame · by the person: Power\nC2 · power · by the person, in Power: USB-C\nC4 · power · by you: loose"
    )
    expect(cardsText(emptyCards(), { brief: '', limit: 8000 })).toBe('There is no brief.md.\n\nThe Brief has no cards.')
  })

  it('cuts long words of brief.md and says where the rest is, and cuts at the limit by whole lines', () => {
    const long = cardsText(emptyCards(), { brief: 'y'.repeat(BRIEF_LIMIT + 500), limit: 8000 })
    expect(long).toContain(`${'y'.repeat(BRIEF_LIMIT)} (cut: the rest is in brief.md)`)
    const many = file(Array.from({ length: 50 }, (_, i) => power(`C${i + 1}`, 'person', 'z'.repeat(100))))
    const cut = cardsText(many, { limit: 1000 })
    expect(cut.length).toBeLessThanOrEqual(1000)
    expect(cut.endsWith(`z\n${CUT_SENTENCE}`)).toBe(true)
  })

  it('narrows to one kind', () => {
    expect(cardsText(cards, { limit: 8000, kind: 'power' })).toBe('C2 · power · by the person, in Power: USB-C\nC4 · power · by you: loose')
    expect(cardsText(cards, { limit: 8000, kind: 'rule' })).toBe('The Brief has no rule card.')
  })
})

describe('what is new', () => {
  it('tells what is new since the last prompt, once', () => {
    const first = cardsLine(file3, {}, '# blinky\n', tool)
    expect(first.line).toBe('Brief: 3 cards (3 new: C1, C2, C3). Read them with mcp__pino__brief.')
    expect(cardsLine(file3, first.told, '# blinky\n', tool).line).toBe('Brief: 3 cards (0 new). Read them with mcp__pino__brief.')
    expect(cardsLine(file3, first.told, '# blinky\nnow USB-C\n', tool).line).toBe('Brief: 3 cards (0 new); brief.md changed since. Read them with mcp__pino__brief.')
    expect(cardsLine(emptyCards(), {}, undefined, tool)).toEqual({ line: '', told: {} })
  })

  it('says brief.md changed also when it is the only thing there, or was removed', () => {
    const first = cardsLine(emptyCards(), {}, '# blinky\n', tool)
    expect(first.line).toBe('')
    expect(cardsLine(emptyCards(), first.told, '# blinky\nmore\n', tool).line).toBe('Brief: 0 cards (0 new); brief.md changed since. Read them with mcp__pino__brief.')
    expect(cardsLine(emptyCards(), first.told, undefined, tool).line).toContain('brief.md changed since')
  })

  it('counts a change of words as news, and not a frame, a new reading, or a card of Claude’s', () => {
    const base = file([{ id: 'C1', kind: 'frame', by: 'person', name: 'Parts' }, part('C2', 'person', 'R', 'C25804'), power('C3', 'agent', 'mine')])
    const first = cardsLine(base, {}, undefined, tool)
    expect(first.line).toBe('Brief: 2 cards (1 new: C2). Read them with mcp__pino__brief.')
    const read = file([base.cards[0], part('C2', 'person', 'R', 'C25804', READING), power('C3', 'agent', 'other')])
    expect(cardsLine(read, first.told, undefined, tool).line).toBe('Brief: 2 cards (0 new). Read them with mcp__pino__brief.')
    const edited = file([base.cards[0], part('C2', 'person', 'R: 10k', 'C25804'), base.cards[2]])
    expect(cardsLine(edited, first.told, undefined, tool).line).toContain('(1 new: C2)')
  })

  it('tells a card of Claude’s the person made theirs as new, once, and names eight of many', () => {
    const mine = file([{ id: 'C1', kind: 'note', by: 'agent', text: 'a' }])
    const first = cardsLine(mine, {}, undefined, tool)
    const adopted = file([{ id: 'C1', kind: 'note', by: 'person', text: 'a', from: { by: 'agent' } }])
    expect(cardsLine(adopted, first.told, undefined, tool).line).toContain('(1 new: C1)')
    const many = file(Array.from({ length: 11 }, (_, i) => power(`C${i + 1}`, 'person', 'x')))
    expect(cardsLine(many, {}, undefined, tool).line).toContain('(11 new: C1, C2, C3, C4, C5, C6, C7, C8 and 3 more)')
  })
})

describe('reading brief.md', () => {
  it('reads a plain file alone, to its limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pino-brief-read-'))
    try {
      expect(await readBrief(dir)).toBeUndefined()
      writeFileSync(join(dir, 'brief.md'), 'x'.repeat(MAX_BRIEF_CHARS + 10))
      expect(await readBrief(dir)).toHaveLength(MAX_BRIEF_CHARS)
      rmSync(join(dir, 'brief.md'))
      writeFileSync(join(dir, 'secret'), 's')
      symlinkSync(join(dir, 'secret'), join(dir, 'brief.md'))
      expect(await readBrief(dir)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
