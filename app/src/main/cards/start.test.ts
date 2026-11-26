import { describe, expect, it } from 'vitest'
import { CARD_ID, type CardsFile, type PartReading } from '../../shared/cards'
import type { SizeFact } from '../../shared/size'
import { DEFAULT_FAB } from '../../shared/slots'
import { readCardsFile, textOf } from './file'
import { START_FRAMES, startCards, type StartRequest } from './start'

const size = (what: string): SizeFact => ({ what, value: '186 x 128', unit: 'mm', source: 'measured' })
const READING: PartReading = { class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true }

const none: StartRequest = { power: [], connections: [], sizes: [], enclosure: '', edges: '', parts: [], fab: null, rules: '', links: [] }
const full: StartRequest = {
  power: [{ source: 'USB-C', kind: '', volts: '5', amps: '0.5', note: '' }],
  connections: [{ what: 'SHT40 sensor', bus: 'I2C', connector: 'JST-SH 4-pin' }],
  sizes: [size('Board width'), size('Board height')],
  enclosure: 'Hammond 1551K',
  edges: 'USB on the short edge',
  parts: [
    { what: 'C25804', note: 'pull-up', reading: READING },
    { what: 'C51118', note: '' },
    { what: 'ESP32-C3 module', note: 'from the drawer' },
    { what: 'an old OLED', note: '' }
  ],
  fab: DEFAULT_FAB,
  rules: '  hand-solderable, 0805 or larger  ',
  links: [{ url: 'https://example.com/part', note: 'the vendor page' }, { url: 'http://example.com/b', note: '' }]
}

const frames = (f: CardsFile) => f.cards.filter((c) => c.kind === 'frame')
const inside = (f: CardsFile, name: string) => f.cards.filter((c) => c.frame === frames(f).find((frame) => frame.name === name)?.id)

describe('startCards', () => {
  it('puts each slot in its frame, in order, with ids C1 onwards', () => {
    expect(frames(startCards(full)).map((c) => c.name)).toEqual(START_FRAMES)
    expect(startCards({ ...none, rules: 'hand-solderable, 0805 or larger' }).cards).toEqual([
      { id: 'C1', kind: 'frame', by: 'person', name: 'Rules' },
      { id: 'C2', kind: 'rule', by: 'person', frame: 'C1', text: 'hand-solderable, 0805 or larger' }
    ])
  })

  it('makes the cards of each slot, all of them the person’s', () => {
    const file = startCards(full)
    const said = (name: string) => inside(file, name).map(({ kind, text }) => [kind, text])
    expect(said('Power')).toEqual([['power', 'USB-C, 5 V, 0.5 A']])
    expect(said('Connections')).toEqual([['connection', 'SHT40 sensor over I2C, JST-SH 4-pin']])
    expect(inside(file, 'Size and shape').map((c) => [c.kind, c.size?.what ?? c.text])).toEqual([
      ['size', 'Board width'],
      ['size', 'Board height'],
      ['requirement', 'Fits an enclosure: Hammond 1551K'],
      ['requirement', 'Connector edges: USB on the short edge']
    ])
    expect(inside(file, 'Parts I have').map((c) => [c.kind, c.part, c.text])).toEqual([
      ['part', { lcsc: 'C25804', reading: READING }, 'pull-up'],
      ['part', { lcsc: 'C51118' }, undefined],
      ['part', undefined, 'ESP32-C3 module: from the drawer'],
      ['part', undefined, 'an old OLED']
    ])
    expect(inside(file, 'Fab and assembly').map((c) => [c.kind, c.fab])).toEqual([['fab', DEFAULT_FAB]])
    expect(said('Rules')).toEqual([['rule', 'hand-solderable, 0805 or larger']])
    expect(said('Links')).toEqual([['link', 'https://example.com/part\nthe vendor page'], ['link', 'http://example.com/b']])
    expect(file.cards.every((c) => c.by === 'person')).toBe(true)
    expect(file.cards.filter((c) => c.kind !== 'frame').every((c) => c.frame !== undefined)).toBe(true)
  })

  it('makes no frame, and no card, for what is empty', () => {
    expect(startCards(none)).toEqual({ next: 1, cards: [] })
    expect(startCards({ ...none, rules: '  \n' })).toEqual({ next: 1, cards: [] })
    expect(frames(startCards({ ...none, edges: 'left' })).map((c) => c.name)).toEqual(['Size and shape'])
  })

  it('gives ids C1.., next above the last, and a file the reader keeps whole', () => {
    const file = startCards(full)
    expect(file.cards.every((c) => CARD_ID.test(c.id))).toBe(true)
    expect(file.cards.map((c) => c.id)).toEqual(file.cards.map((_, i) => `C${i + 1}`))
    expect(file.next).toBe(file.cards.length + 1)
    const read = readCardsFile(JSON.parse(textOf(file)))
    expect(read?.dropped).toBe(0)
    expect(read?.file).toEqual(file)
  })
})
