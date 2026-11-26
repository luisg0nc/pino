import { expect, it } from 'vitest'
import { tinyBoard } from '../../test/fixtures'
import { readBoard } from './board'
import { changedItems } from './changes'

const tiny = readBoard(tinyBoard())
const edited = (from: string, to: string) => {
  expect(tinyBoard()).toContain(from)
  return readBoard(tinyBoard().replace(from, to))
}

it('finds a moved part and new copper, and nothing on a first build', () => {
  expect(changedItems(null, tiny)).toEqual({ parts: [], tracks: [], vias: [], zones: [] })
  expect(changedItems(tiny, tiny)).toEqual({ parts: [], tracks: [], vias: [], zones: [] })
  expect(changedItems(tiny, edited('(at 100 100)', '(at 101.5 100)')).parts).toEqual(['R1'])
  const less = { ...tiny, tracks: tiny.tracks.slice(1), vias: [], zones: [] }
  expect(changedItems(less, tiny)).toEqual({ parts: [], tracks: [tiny.tracks[0].uuid], vias: [tiny.vias[0].uuid], zones: [tiny.zones[0].uuid] })
})

it('takes a turn or a change of side as a change, and a hair as none', () => {
  expect(changedItems(tiny, edited('(at 100 100)', '(at 100 100 90)')).parts).toEqual(['R1'])
  expect(changedItems(tiny, edited('(at 100 100)', '(at 100.005 100)')).parts).toEqual([])
  expect(changedItems({ ...tiny, footprints: tiny.footprints.slice(1) }, tiny).parts).toEqual(['R1'])
})
