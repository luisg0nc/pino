import { describe, expect, it } from 'vitest'
import { fabText, firstLink, readingLine, readingOf, readingOrder, type Card } from './cards'
import type { PartInfo, PartsResult } from './fab'

const card = (id: string, extra: Partial<Card> = {}): Card => ({ id, kind: 'note', by: 'person', ...extra })

const part: PartInfo = { lcsc: 'C25804', mfr: '0603WAF1002T5E', package: '0603', description: '10k resistor', stock: 1234567, price: 0.0024, class: 'basic', checked_at: '2026-11-26T05:00:00.000Z', fetched_at: '2026-11-26T06:00:00+00:00' }
const answer = (over: Partial<PartsResult> = {}): PartsResult => ({ schema: 'pino.parts/1', kind: 'get', query: {}, parts: [], resolved: [], findings: [], source: { url: 'https://jlcsearch.tscircuit.com', fresh: true, fetched_at: null }, headline: '', ...over })

it('reads frames by id, each followed by its cards, then the loose cards', () => {
  expect(readingOrder([card('C4'), card('C1', { kind: 'frame' }), card('C3', { frame: 'C1' }), card('C2', { frame: 'C1' })]).map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4'])
  // By number, not by letters: C2 before C10.
  expect(readingOrder([card('C10'), card('C2')]).map((c) => c.id)).toEqual(['C2', 'C10'])
})

it('says a part reading in one line', () => {
  expect(readingLine({ class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true })).toBe('basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)')
  expect(readingLine({ class: 'extended', package: 'SOT-25-5', stock: null, price: 0.09, checkedAt: '2026-11-03T22:33:00.000Z', fresh: true })).toBe('extended · SOT-25-5 · stock not known · $0.09 each (checked 2026-11-03)')
  expect(readingLine({ missing: true, checkedAt: '2026-11-26T06:00:00+00:00', fresh: true })).toBe('JLC has no such part (checked 2026-11-26)')
  expect(readingLine({ class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-20T06:00:00+00:00', fresh: false })).toBe('basic · 0603 · stock 1,234,567 · $0.0024 each (from 2026-11-20: jlcsearch could not be reached)')
})

describe('a reading from a parts answer', () => {
  const now = new Date('2026-11-26T12:00:00.000Z')

  it('is the part asked for, with the day jlcsearch checked it', () => {
    expect(readingOf(answer({ parts: [part] }), 'C25804', now)).toEqual({ class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true })
  })

  it('is from an earlier day, and not fresh, when the answer is one kept', () => {
    const kept = answer({ parts: [{ ...part, checked_at: null, fetched_at: '2026-11-20T06:00:00+00:00' }], source: { url: '', fresh: false, fetched_at: null } })
    expect(readingOf(kept, 'C25804', now)).toMatchObject({ checkedAt: '2026-11-20T06:00:00+00:00', fresh: false })
  })

  it('says JLC has no such part when it answered with none', () => {
    expect(readingOf(answer(), 'C1', now)).toEqual({ missing: true, checkedAt: now.toISOString(), fresh: true })
    // The real engine says so with a finding of its own, an error.
    const unknown = answer({ findings: [{ source: 'parts', code: 'part_unknown', severity: 'error', message: 'JLC has no part C1' }] })
    expect(readingOf(unknown, 'C1', now)).toEqual({ missing: true, checkedAt: now.toISOString(), fresh: true })
  })

  it('says why there is none when jlcsearch could not answer', () => {
    for (const severity of ['error', 'warning'] as const) {
      const down = answer({ findings: [{ source: 'parts', code: 'parts_unavailable', severity, message: 'no answer' }], source: { url: '', fresh: false, fetched_at: null }, headline: 'Parts: jlcsearch could not be reached' })
      expect(readingOf(down, 'C25804', now)).toEqual({ refused: 'jlcsearch could not be reached' })
    }
  })
})

it('says what the person asked of the fab', () => {
  expect(fabText({ layers: 2, thickness: 1.6, assembly: 'jlc', boards: 5 })).toBe('2 layers, 1.6 mm, JLC assembles it, 5 boards')
  expect(fabText({ layers: 4, thickness: 1.0, assembly: 'mix', boards: 1 })).toBe('4 layers, 1.0 mm, JLC assembles some and you solder the rest, 1 board')
  expect(fabText({ layers: 2, thickness: 0.8, assembly: 'hand', boards: 10000 })).toBe('2 layers, 0.8 mm, you solder it, 10,000 boards')
})

describe('the link a text card holds', () => {
  it('is the first http or https address, up to the next whitespace', () => {
    expect(firstLink('see https://example.com/a b')).toBe('https://example.com/a')
    // The markdown around an address is not part of it: the page and main read the same address.
    expect(firstLink('**[the seat](https://example.org/seat)**')).toBe('https://example.org/seat')
    expect(firstLink('| https://a.com/x |')).toBe('https://a.com/x')
    expect(firstLink('**https://a.com/x**')).toBe('https://a.com/x')
    expect(firstLink('a\nhttp://x.dev/p?q=1\nhttps://other.dev')).toBe('http://x.dev/p?q=1')
    expect(firstLink('HTTPS://EXAMPLE.COM')).toBe('HTTPS://EXAMPLE.COM')
  })
  it('is nothing for other schemes or no address', () => {
    for (const text of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.dev', 'no link here', '', 'https:/x']) expect(firstLink(text)).toBeNull()
  })
  it('leaves off the punctuation of the sentence it ends, and a bracket it does not open', () => {
    expect(firstLink('see https://x.dev/a.')).toBe('https://x.dev/a')
    expect(firstLink('https://x.dev/a, then')).toBe('https://x.dev/a')
    expect(firstLink('who? https://x.dev/a?!')).toBe('https://x.dev/a')
    expect(firstLink('https://x.dev/a;:')).toBe('https://x.dev/a')
    expect(firstLink('(see https://x.dev/a)')).toBe('https://x.dev/a')
    expect(firstLink('(see https://x.dev/a).')).toBe('https://x.dev/a')
  })
  it('keeps a bracket that closes one in the address, and a query', () => {
    expect(firstLink('https://en.wikipedia.org/wiki/Pin_(lead)')).toBe('https://en.wikipedia.org/wiki/Pin_(lead)')
    expect(firstLink('https://en.wikipedia.org/wiki/Pin_(lead).')).toBe('https://en.wikipedia.org/wiki/Pin_(lead)')
    expect(firstLink('https://x.dev/a?b=1&c=2')).toBe('https://x.dev/a?b=1&c=2')
  })
  it('is cut at 2000 characters', () => {
    expect(firstLink(`https://x.dev/${'a'.repeat(3000)}`)).toHaveLength(2000)
  })
})
