import { LCSC, type PartReading, readingOf } from '../../shared/cards'
import type { PartsQuery, PartsResult } from '../../shared/fab'

// The stock readings main gave this run, by LCSC number: what a new project's part cards and its first prompt are
// told from, so that a reading is never taken from the window.

/** How long a reading is given for: the page was typed in lately, or it is looked up again. */
export const HELD_MS = 60 * 60 * 1000
/** The most numbers held: a person types a few. */
const MOST = 500

export interface Readings {
  put(lcsc: string, reading: PartReading): void
  /** The newest reading of this number main gave in the last hour. */
  get(lcsc: string): PartReading | undefined
}

/**
 * One number looked up as it is typed on the New project page: its reading, which is kept for the project's cards,
 * or why the stock was not checked. It never rejects: a part that cannot be checked does not hold Start.
 */
export async function lookupPart(typed: unknown, lookup: (q: PartsQuery) => Promise<PartsResult>, readings: Readings, now: () => Date = () => new Date()): Promise<{ reading: PartReading } | { refused: string }> {
  const lcsc = typeof typed === 'string' ? typed.trim().toUpperCase() : ''
  if (!LCSC.test(lcsc)) return { refused: 'That is no LCSC number' }
  try {
    const found = readingOf(await lookup({ lcsc }), lcsc, now())
    if ('refused' in found) return found
    readings.put(lcsc, found)
    return { reading: found }
  } catch (e) {
    return { refused: (e as Error).message }
  }
}

export function makeReadings(now: () => number = Date.now): Readings {
  const held = new Map<string, { reading: PartReading; at: number }>()
  return {
    put(lcsc, reading) {
      held.delete(lcsc)
      if (held.size >= MOST) held.delete(held.keys().next().value as string)
      held.set(lcsc, { reading, at: now() })
    },
    get(lcsc) {
      const found = held.get(lcsc)
      return found && now() - found.at <= HELD_MS ? found.reading : undefined
    }
  }
}
