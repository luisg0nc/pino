// The stock check of "Parts I have": an LCSC number is looked up as it is typed, through the engine's lookup, which
// is the one the `parts` tool uses. What it says stands on the row; main keeps the reading the project's card is made
// with, so what the row shows is never sent back.

import { useEffect } from 'react'
import { LCSC, type PartReading, readingLine } from '../../../shared/cards'
import { onboard, onboarding, type PartDraft } from '../../state/onboard'

/** How long after the last key a number is looked up. */
export const LOOKUP_AFTER_MS = 400

/** The LCSC number a row's words are, or null for a module in words. */
export function numberOf(what: string): string | null {
  const number = what.trim().toUpperCase()
  return LCSC.test(number) ? number : null
}

export function partState(row: PartDraft): { kind: 'module' | 'looking' | 'read' | 'refused' | 'none'; said: string } {
  const none = { kind: 'none' as const, said: '' }
  if (row.what.trim() === '') return none
  if (numberOf(row.what) === null) return { kind: 'module', said: 'A module in words: Claude looks it up.' }
  if (row.looking) return { kind: 'looking', said: 'Checking JLC…' }
  if (row.reading) return { kind: 'read', said: readingLine(row.reading) }
  if (row.problem !== undefined) return { kind: 'refused', said: `Stock not checked: ${row.problem.replace(/\.$/, '')}.` }
  return none
}

type Lookup = (lcsc: string) => Promise<{ reading: PartReading } | { refused: string }>

const rowOf = (key: string): PartDraft | undefined => onboard.getState().draft.parts.find((p) => p.key === key)

/**
 * Looks up the number the row holds, unless it has its answer or one is on the way. An answer for a number the row no
 * longer holds is dropped.
 */
export async function lookStock(key: string, lookup: Lookup): Promise<void> {
  const row = rowOf(key)
  const number = row ? numberOf(row.what) : null
  if (!row || number === null || row.looking || row.reading || row.problem !== undefined) return
  onboarding.setPart(key, { looking: true })
  const found = await lookup(number).catch((e: Error) => ({ refused: e.message }))
  const now = rowOf(key)
  if (!now || now.what !== row.what || !now.looking) return
  onboarding.setPart(key, { looking: undefined, ...('reading' in found ? { reading: found.reading } : { problem: found.refused }) })
}

/** Looks a row's number up once it has stood for `LOOKUP_AFTER_MS`, once per number. */
export function useStockCheck(row: PartDraft): void {
  const { key, what } = row
  useEffect(() => {
    const timer = setTimeout(() => void lookStock(key, window.pino.parts.lookup), LOOKUP_AFTER_MS)
    return () => clearTimeout(timer)
  }, [key, what])
}
