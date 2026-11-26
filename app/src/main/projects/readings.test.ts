import { describe, expect, it } from 'vitest'
import type { PartReading } from '../../shared/cards'
import type { PartsResult } from '../../shared/fab'
import { HELD_MS, lookupPart, makeReadings } from './readings'

const reading = (stock: number): PartReading => ({ class: 'basic', package: '0603', stock, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true })

describe('the stock readings main gave this run', () => {
  it('keeps the newest reading of a number, and none for another', () => {
    const readings = makeReadings()
    expect(readings.get('C25804')).toBeUndefined()
    readings.put('C25804', reading(1))
    readings.put('C25804', reading(2))
    expect(readings.get('C25804')).toEqual(reading(2))
    expect(readings.get('C51118')).toBeUndefined()
  })

  it('gives a reading for an hour, and no longer', () => {
    let now = 1_000
    const readings = makeReadings(() => now)
    readings.put('C25804', reading(1))
    now += HELD_MS
    expect(readings.get('C25804')).toEqual(reading(1))
    now += 1
    expect(readings.get('C25804')).toBeUndefined()
    expect(HELD_MS).toBe(60 * 60 * 1000)
  })
})

const answer = (over: Partial<PartsResult>): PartsResult => ({ headline: 'Parts: 1 found', parts: [], findings: [], source: { fresh: true }, ...over }) as PartsResult

describe('looking a part up for the New project page', () => {
  it('keeps the reading it gives, under the number as LCSC writes it', async () => {
    const readings = makeReadings()
    const asked: unknown[] = []
    const found = await lookupPart(' c25804 ', async (q) => {
      asked.push(q)
      return answer({ parts: [{ lcsc: 'C25804', class: 'basic', package: '0603', stock: 1, price: 0.0024, checked_at: '2026-11-26T05:00:00.000Z' } as never] })
    }, readings)
    expect(asked).toEqual([{ lcsc: 'C25804' }])
    expect(found).toEqual({ reading: reading(1) })
    expect(readings.get('C25804')).toEqual(reading(1))
  })

  it('says why a part was not checked, and keeps nothing: an engine that cannot be asked is not a rejection', async () => {
    const readings = makeReadings()
    expect(await lookupPart('C25804', async () => answer({ headline: 'Parts: jlcsearch could not be reached', findings: [{ code: 'parts_unavailable' } as never] }), readings)).toEqual({ refused: 'jlcsearch could not be reached' })
    expect(await lookupPart('C25804', () => Promise.reject(new Error('uv is not installed')), readings)).toEqual({ refused: 'uv is not installed' })
    expect(readings.get('C25804')).toBeUndefined()
  })

  it('asks nothing of what is no LCSC number', async () => {
    expect(await lookupPart('ESP32-C3 module', () => Promise.reject(new Error('asked')), makeReadings())).toEqual({ refused: 'That is no LCSC number' })
  })
})
