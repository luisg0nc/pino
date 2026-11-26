import { describe, expect, it } from 'vitest'
import { readJson } from '../test/fixtures'
import { fabLine, fabRows, readinessWords, type FabProfile, type Readiness } from './fab'
import type { Finding } from './build'

const [TWO_LAYER, FOUR_LAYER] = readJson<FabProfile[]>('test/fixtures/fab-profiles.json')

const finding = (code: string, message: string, severity: Finding['severity'] = 'error', refs?: string[]): Finding => ({ source: 'release', code, severity, message, ...(refs ? { refs } : {}) })
const refused = (blockers: Finding[]): Readiness => ({ ready: false, build: { number: 3, hash: 'abc' }, route: null, blockers, warnings: [], next_version: null, bump: null, why: [] })

describe("the fab's limits in plain words", () => {
  it('lists the 2-layer limits in plain words, glossed', () => {
    const rows = fabRows(TWO_LAYER)
    expect(rows.map((r) => r.label)).toEqual([
      'Copper layers', 'Board thickness', 'Copper weight', 'Tracks and gaps', 'Vias (a plated hole between layers)',
      'Annular ring (copper round a hole)', 'Holes', 'Copper to the board edge', 'Silkscreen text', 'Assembly'
    ])
    const value = (label: string) => rows.find((r) => r.label === label)!.value
    expect(value('Tracks and gaps')).toBe('0.10 mm or more (2 oz copper: 0.16 mm)')
    expect(value('Board thickness')).toBe('1.6 mm (0.4 to 2.0 mm)')
    expect(value('Copper weight')).toBe('1 oz (up to 4.5 oz)')
    expect(value('Vias (a plated hole between layers)')).toBe('0.2 mm hole in 0.45 mm')
    expect(value('Annular ring (copper round a hole)')).toBe('vias 0.125 mm, plated pads 0.18 mm or more')
    expect(value('Holes')).toBe('plated 0.2 mm, unplated 0.5 mm or more')
    expect(value('Assembly')).toBe('economic: one side, 0402 and up, pitch 0.4 mm and up, board 10 x 10 to 470 x 500 mm')
    expect(rows.every((r) => !r.value.includes('—'))).toBe(true)
  })

  it('says the inner copper of 4 layers', () => {
    expect(fabRows(FOUR_LAYER).find((r) => r.label === 'Copper weight')!.value).toBe('1 oz outside (up to 2 oz), 0.5 oz inside')
    expect(fabRows(FOUR_LAYER).find((r) => r.label === 'Tracks and gaps')!.value).toBe('0.09 mm or more (2 oz copper: 0.15 mm)')
  })

  it('says them in one line under 400 characters', () => {
    expect(fabLine(TWO_LAYER)).toBe(
      'Fab: JLC standard 2-layer. Tracks and gaps 0.10 mm or more (2 oz copper: 0.16 mm); vias 0.2 mm hole in 0.45 mm; holes 0.2 mm or more; copper 0.2 mm from the edge; silkscreen text 1.0 mm high. Board 1.6 mm (0.4 to 2.0), 1 oz copper (up to 4.5). Assembly: economic, one side, 0402 and up, pitch 0.4 mm and up, board 10 x 10 to 470 x 500 mm.'
    )
    expect(fabLine(FOUR_LAYER).length).toBeLessThan(400)
  })
})

describe('what blocks a release', () => {
  it('says what to do about each gate', () => {
    expect(readinessWords(refused([finding('release_stale', 'copper is stale (parts moved): route again')]))).toEqual(['Copper is stale: parts moved. Route again'])
    expect(readinessWords(refused([finding('release_not_routed', 'the board is not routed: route it first')]))).toEqual(['Route the board first'])
    expect(readinessWords(refused([finding('release_build_stale', 'x')]))).toEqual(['board.py changed since the last build: wait for the new build'])
    expect(readinessWords(refused([finding('release_incomplete', 'the route left nets unrouted (SDA, SCL)')]))).toEqual(['The route left nets unrouted (SDA, SCL)'])
  })

  it('counts the errors that need board.py, and says the first ones short', () => {
    const words = readinessWords(
      refused([
        finding('release_not_routed', 'the board is not routed: route it first'),
        finding('part_no_lcsc', 'U1 has no LCSC number, so JLC cannot place it: add lcsc=, or hand_fit=True (board.py:9)'),
        finding('part_extended', 'U2 C1 is an extended part (JLC charges a setup fee per part type): say why (board.py:10)')
      ])
    )
    expect(words).toEqual(['Route the board first', '2 errors to fix: U1 has no LCSC number, so JLC cannot place it; U2 C1 is an extended part (JLC charges a setup fee per part type)'])
  })

  it('has nothing to say when ready', () => {
    expect(readinessWords({ ...refused([]), ready: true })).toEqual([])
  })
})
