import { beforeEach, describe, expect, it } from 'vitest'
import type { PartReading } from '../../../shared/cards'
import { onboard, onboarding } from '../../state/onboard'
import { LOOKUP_AFTER_MS, lookStock, numberOf, partState } from './parts'

const READING: PartReading = { class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true }

describe('the stock check of Parts I have', () => {
  beforeEach(() => onboarding.discard())

  /** A row of the draft holding this, and its key. */
  const typed = (what: string): string => {
    onboarding.addPart()
    const { key } = onboard.getState().draft.parts.at(-1)!
    onboarding.setPart(key, { what })
    return key
  }
  const row = (key: string) => onboard.getState().draft.parts.find((p) => p.key === key)

  it('says what a typed part is, as it stands', () => {
    expect(partState({ key: 'k', what: 'ESP32-C3 module', note: '' })).toEqual({ kind: 'module', said: 'A module in words: Claude looks it up.' })
    expect(partState({ key: 'k', what: 'C25804', note: '', looking: true })).toEqual({ kind: 'looking', said: 'Checking JLC…' })
    expect(partState({ key: 'k', what: 'C25804', note: '', reading: READING })).toEqual({ kind: 'read', said: 'basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)' })
    expect(partState({ key: 'k', what: 'C25804', note: '', problem: 'jlcsearch could not be reached' })).toEqual({ kind: 'refused', said: 'Stock not checked: jlcsearch could not be reached.' })
    expect(partState({ key: 'k', what: 'C25804', note: '', problem: 'uv is not installed.' })).toEqual({ kind: 'refused', said: 'Stock not checked: uv is not installed.' })
    expect(partState({ key: 'k', what: '  ', note: '' })).toEqual({ kind: 'none', said: '' })
    expect(partState({ key: 'k', what: 'C25804', note: '' })).toEqual({ kind: 'none', said: '' })
  })

  it('reads an LCSC number however it is typed, and nothing else as one', () => {
    expect([numberOf(' c25804 '), numberOf('C25804'), numberOf('ESP32-C3'), numberOf('25804'), numberOf('')]).toEqual(['C25804', 'C25804', null, null, null])
    expect(LOOKUP_AFTER_MS).toBe(400)
  })

  it('marks the row while it asks, and puts the answer on it', async () => {
    const key = typed('c25804')
    let during: unknown
    await lookStock(key, async (lcsc) => {
      during = [lcsc, row(key)?.looking]
      return { reading: READING }
    })
    expect(during).toEqual(['C25804', true])
    expect(row(key)).toEqual({ key, what: 'c25804', note: '', reading: READING })
  })

  it('puts why it was not checked on the row, whether main refuses or the call fails', async () => {
    const a = typed('C25804')
    await lookStock(a, async () => ({ refused: 'jlcsearch could not be reached' }))
    expect(row(a)?.problem).toBe('jlcsearch could not be reached')
    const b = typed('C51118')
    await lookStock(b, () => Promise.reject(new Error('the window lost main')))
    expect(row(b)).toEqual({ key: b, what: 'C51118', note: '', problem: 'the window lost main' })
  })

  it('asks once for a number: not again for a row that has its answer, nor for what is no number', async () => {
    const asked: string[] = []
    const lookup = async (lcsc: string) => (asked.push(lcsc), { reading: READING })
    const key = typed('C25804')
    await lookStock(key, lookup)
    await lookStock(key, lookup)
    await lookStock(typed('ESP32-C3 module'), lookup)
    await lookStock('gone', lookup)
    expect(asked).toEqual(['C25804'])
  })

  it('drops an answer for a number the row no longer holds, and keeps a note typed meanwhile', async () => {
    const a = typed('C2580')
    await lookStock(a, async () => {
      onboarding.setPart(a, { what: 'C25804' })
      return { reading: READING }
    })
    expect(row(a)).toEqual({ key: a, what: 'C25804', note: '' })
    const b = typed('C25804')
    await lookStock(b, async () => {
      onboarding.setPart(b, { note: 'pull-up' })
      return { reading: READING }
    })
    expect(row(b)).toEqual({ key: b, what: 'C25804', note: 'pull-up', reading: READING })
  })
})
