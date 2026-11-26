import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CARD_KINDS, type CardsFile } from '../../shared/cards'
import { loadCardsFile, readCardsFile, saveCardsFile, textOf } from './file'

const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'note', by: 'person', text: 'hi', ...extra })

describe('readCardsFile', () => {
  it('keeps a whole file as it is', () => {
    const file = { next: 3, cards: [card('C1', { kind: 'frame', name: 'Power', text: undefined }), card('C2', { frame: 'C1' })] }
    expect(readCardsFile(file)).toEqual({ file: JSON.parse(JSON.stringify(file)), dropped: 0 })
  })

  it('is not a cards file when it is not an object with cards', () => {
    expect(readCardsFile(null)).toBeNull()
    expect(readCardsFile([])).toBeNull()
    expect(readCardsFile({ next: 1 })).toBeNull()
  })

  it('drops a card with a bad id, an unknown kind, or an unknown author, main’s own among them', () => {
    const read = readCardsFile({ next: 9, cards: [card('C1'), card('c2'), card('C0'), card('C3', { kind: 'picture' }), card('C4', { by: 'pino' }), card('C5', { by: 'someone' })] })
    expect(read?.file.cards.map((c) => c.id)).toEqual(['C1'])
    expect(read?.dropped).toBe(5)
  })

  it('drops a card whose frame names no frame, and one that follows it', () => {
    const read = readCardsFile({ next: 9, cards: [card('C1'), card('C2', { frame: 'C9' }), card('C3', { kind: 'frame', name: 'F', frame: 'C2' }), card('C4', { frame: 'C3' }), card('C5', { frame: 'C1' })] })
    // C2 is framed by a card that is not there; C3 sits in C2, C4 in C3; C5's frame C1 is a note, not a frame.
    expect(read?.file.cards.map((c) => c.id)).toEqual(['C1'])
    expect(read?.dropped).toBe(4)
  })

  it('keeps each id once', () => {
    const read = readCardsFile({ next: 5, cards: [card('C1', { text: 'first' }), card('C1', { text: 'second' })] })
    expect(read?.file.cards).toHaveLength(1)
    expect(read?.file.cards[0].text).toBe('first')
  })

  it('never lets next sit at or below an id in use', () => {
    expect(readCardsFile({ next: 1, cards: [card('C7')] })?.file.next).toBe(8)
    expect(readCardsFile({ next: 'x', cards: [card('C1'), card('C5')] })?.file.next).toBe(6)
    expect(readCardsFile({ next: 30, cards: [card('C1')] })?.file.next).toBe(30)
  })

  it('keeps each kind’s own field on that kind alone', () => {
    const size = { what: 'Board width', value: '50', unit: 'mm', source: 'measured' }
    const fab = { layers: 2, thickness: 1.6, assembly: 'jlc', boards: 5 }
    const partOf = { lcsc: 'C25804' }
    const read = readCardsFile({ next: 9, cards: [card('C1', { size, fab, part: partOf, name: 'x' })] })
    expect(read?.dropped).toBe(0)
    expect(Object.keys(read?.file.cards[0] ?? {})).toEqual(['id', 'kind', 'by', 'text'])
    // A frame has a name and no words.
    expect(readCardsFile({ next: 2, cards: [card('C1', { kind: 'frame', name: 'Rules' })] })?.file.cards[0]).toEqual({ id: 'C1', kind: 'frame', by: 'person', name: 'Rules' })
  })

  it('leaves out a part reading that is not whole, and keeps the part', () => {
    const whole = { class: 'basic', package: '0603', stock: null, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true }
    const gone = { missing: true, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true }
    for (const reading of [whole, gone]) {
      const kept = card('C1', { kind: 'part', part: { lcsc: 'C25804', reading } })
      expect(readCardsFile({ next: 2, cards: [kept] })).toEqual({ file: { next: 2, cards: [kept] }, dropped: 0 })
    }
    for (const reading of [{ ...whole, class: 'rare' }, { ...whole, stock: 'lots' }, { ...whole, checkedAt: 'now' }, { missing: true }, 'basic']) {
      const read = readCardsFile({ next: 2, cards: [card('C1', { kind: 'part', part: { lcsc: 'C25804', reading } })] })
      expect(read?.file.cards[0].part).toEqual({ lcsc: 'C25804' })
      expect(read?.dropped).toBe(0)
    }
    // A part the person has, in words, names no number.
    expect(readCardsFile({ next: 2, cards: [card('C1', { kind: 'part' })] })?.dropped).toBe(0)
    // A number that is not an LCSC one is not a part card.
    expect(readCardsFile({ next: 2, cards: [card('C1', { kind: 'part', part: { lcsc: 'R1' } })] })?.dropped).toBe(1)
  })

  it('drops a fab card whose ask is missing or not whole', () => {
    const fab = { layers: 4, thickness: 1, assembly: 'mix', boards: 10 }
    const asks = [{ ...fab, extra: 1 }, undefined, { ...fab, layers: 3 }, { ...fab, thickness: 1.5 }, { ...fab, assembly: 'me' }, { ...fab, boards: 0 }, { ...fab, boards: 2.5 }]
    const read = readCardsFile({ next: 9, cards: asks.map((ask, i) => card(`C${i + 1}`, { kind: 'fab', text: undefined, fab: ask })) })
    expect(read?.file.cards.map((c) => c.id)).toEqual(['C1'])
    expect(read?.file.cards[0].fab).toEqual(fab)
    expect(read?.dropped).toBe(6)
  })

  it('drops a size card whose size is missing or not whole, and keeps only the fields a size has', () => {
    const good = { what: 'tray', value: '186', unit: 'mm', source: 'a guess' }
    const read = readCardsFile({
      next: 9,
      cards: [
        card('C1', { kind: 'size', text: undefined, size: { ...good, extra: 1, tie: { mark: 'M1', tolerance: 1 } } }),
        card('C2', { kind: 'size' }),
        card('C3', { kind: 'size', size: { ...good, unit: 'cm' } }),
        card('C4', { kind: 'size', size: { ...good, what: 'w'.repeat(201) } }),
        card('C5', { kind: 'size', size: { ...good, source: 'from Claude' } }),
        card('C6', { kind: 'size', by: 'agent', size: { ...good, source: 'from Claude' } })
      ]
    })
    expect(read?.file.cards.map((c) => c.id)).toEqual(['C1', 'C6'])
    expect(read?.file.cards[0].size).toEqual(good)
    expect(read?.dropped).toBe(4)
  })

  it('keeps when and in which prompt a card was written, and what it said before, each whole (#336)', () => {
    const stamped = card('C1', { by: 'agent', turn: { prompt: 'u2', conversation: 'c1' }, at: '2026-11-25T14:11:00.000Z', was: [{ text: 'Mount: a flat blade', turn: { prompt: 'u1' }, at: '2026-11-25T14:02:00.000Z' }, { text: 'Mount: a tube' }] })
    expect(readCardsFile({ next: 2, cards: [stamped] })?.file.cards[0]).toEqual(stamped)
    const bad = readCardsFile({ next: 2, cards: [card('C1', { turn: { prompt: 7 }, at: 'yesterday', was: [{ text: 3 }, 'x', { text: 'kept', turn: 'u1', at: 'soon', extra: 1 }], from: 'agent' })] })
    expect(bad?.file.cards[0]).toEqual({ ...card('C1'), was: [{ text: 'kept' }] })
    expect(bad?.dropped).toBe(0)
  })

  it('keeps who a card the person made theirs was by, and Claude’s source on a size of it until they change it (#339)', () => {
    const adopted = card('C1', { kind: 'size', text: undefined, from: { by: 'agent', turn: { prompt: 'u13' }, at: '2026-11-25T18:07:00.000Z', since: '2026-11-26T09:12:00.000Z' }, size: { what: 'encoder hole', value: '7', unit: 'mm', source: 'from Claude' } })
    delete (adopted as Record<string, unknown>).text
    expect(readCardsFile({ next: 2, cards: [adopted] })?.file.cards[0]).toEqual(adopted)
    // Claude's source is not the person's on a card they did not make theirs, and a from on Claude's own card is not kept.
    const plain = card('C2', { kind: 'size', size: { what: 'x', value: '7', unit: 'mm', source: 'from Claude' } })
    expect(readCardsFile({ next: 3, cards: [plain] })?.dropped).toBe(1)
    expect(readCardsFile({ next: 3, cards: [card('C3', { by: 'agent', from: { by: 'agent' } })] })?.file.cards[0].from).toBeUndefined()
  })

  it('drops a field of the wrong shape and keeps the card', () => {
    const read = readCardsFile({ next: 2, cards: [card('C1', { text: 5, hidden: true, picture: '../x.png', x: 3 })] })
    expect(read?.file.cards[0]).toEqual({ id: 'C1', kind: 'note', by: 'person' })
  })
})

it('reads a file of every kind back as it was written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pino-cards-file-'))
  try {
    const turn = { prompt: 'u2', conversation: 'c1' }
    const at = '2026-11-26T10:00:00.000Z'
    const cards = CARD_KINDS.map((kind, i) => {
      const id = `C${i + 1}`
      if (kind === 'frame') return { id, kind, by: 'person', name: 'Power' }
      const own =
        kind === 'size'
          ? { size: { what: 'Board width', value: '50', unit: 'mm', source: 'from Claude' } }
          : kind === 'fab'
            ? { fab: { layers: 2, thickness: 1.6, assembly: 'jlc', boards: 5 } }
            : { text: `a ${kind}`, ...(kind === 'part' ? { part: { lcsc: 'C25804', reading: { class: 'basic', package: '0603', stock: 12, price: null, checkedAt: at, fresh: false } } } : {}) }
      return kind === 'note'
        ? { id, kind, by: 'person', frame: 'C1', ...own, from: { by: 'agent', turn, at, since: at } }
        : { id, kind, by: 'agent', frame: 'C1', ...own, turn, at, was: [{ text: 'before', turn, at }] }
    })
    const file = { next: CARD_KINDS.length + 1, cards } as unknown as CardsFile
    await saveCardsFile(dir, file)
    expect(readFileSync(join(dir, '.pino', 'brief', 'cards.json'), 'utf8')).toBe(textOf(file))
    expect(await loadCardsFile(dir)).toEqual({ file, text: textOf(file) })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('the file', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pino-cards-file-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  const folder = (): string => join(dir, '.pino', 'brief')
  const path = (): string => join(folder(), 'cards.json')
  const writeCards = (text: string): void => {
    mkdirSync(folder(), { recursive: true })
    writeFileSync(path(), text)
  }

  it('reads a missing file as no cards and writes nothing', async () => {
    expect(await loadCardsFile(dir)).toEqual({ file: { next: 1, cards: [] }, text: null })
    expect(() => readdirSync(join(dir, '.pino'))).toThrow()
  })

  it('leaves out a card it cannot read whole, keeps the file as it was beside it, and says how many', async () => {
    const before = JSON.stringify({ next: 3, cards: [card('C1'), card('C2', { kind: 'part', part: { lcsc: 'R1' } })] })
    writeCards(before)
    const { file, problem } = await loadCardsFile(dir, () => new Date('2026-11-26T10:00:00.000Z'))
    expect(file.cards.map((c) => c.id)).toEqual(['C1'])
    expect(problem).toBe('1 card in the cards file of this project was not whole, and left out. The file as it was is kept as .pino/brief/cards.json.dropped-2026-11-26T10-00-00-000Z.')
    expect(readFileSync(join(folder(), 'cards.json.dropped-2026-11-26T10-00-00-000Z'), 'utf8')).toBe(before)
    expect(JSON.parse(readFileSync(path(), 'utf8'))).toEqual(file)
  })

  it('never gives again the id of a card it left out, and does not take an LCSC number for one', async () => {
    writeCards(JSON.stringify({ next: 3, cards: [card('C1', { kind: 'part', part: { lcsc: 'C25804' } }), card('C12', { kind: 'a kind of a newer pino' })] }))
    expect((await loadCardsFile(dir)).file.next).toBe(13)
  })

  it('keeps a merge-conflicted file aside and never reuses its ids', async () => {
    writeCards('<<<<<<< HEAD\n{"next": 9, "cards": [{"id": "C8", "kind": "note", "by": "agent", "text": "a"}]}\n=======\n{"next": 4}\n>>>>>>> other\n')
    const read = await loadCardsFile(dir, () => new Date('2026-11-26T10:00:00Z'))
    expect(read.problem).toBe('The cards file of this project could not be read. It was kept as .pino/brief/cards.json.corrupt-2026-11-26T10-00-00-000Z, and a new one was started.')
    expect(read.file).toEqual({ next: 9, cards: [] })
    expect(readdirSync(folder())).toContain('cards.json.corrupt-2026-11-26T10-00-00-000Z')
  })

  it('does not read a cards.json that is a link, nor copy what it leads to', async () => {
    const { symlinkSync } = await import('node:fs')
    mkdirSync(folder(), { recursive: true })
    writeFileSync(join(dir, 'secret.txt'), 'not cards')
    symlinkSync(join(dir, 'secret.txt'), path())
    const { file, problem, text } = await loadCardsFile(dir)
    expect(file).toEqual({ next: 1, cards: [] })
    expect(problem).toMatch(/not a plain file/)
    expect(text).toBeNull()
    expect(readdirSync(folder())).toEqual(['cards.json'])
  })

  it('writes nothing through a .pino/brief that is a link', async () => {
    const { symlinkSync } = await import('node:fs')
    mkdirSync(join(dir, '.pino'))
    mkdirSync(join(dir, 'elsewhere'))
    symlinkSync(join(dir, 'elsewhere'), folder())
    await expect(saveCardsFile(dir, { next: 1, cards: [] })).rejects.toThrow(/link/)
    expect(readdirSync(join(dir, 'elsewhere'))).toEqual([])
  })
})
