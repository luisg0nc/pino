import { expect, it } from 'vitest'
import { tinyBoard } from '../../test/fixtures'
import { readBoard } from './board'
import { withStaleCopper } from './stale'

const tiny = readBoard(tinyBoard())

it("lays a route's copper over a newer board, and names it as stale", () => {
  const build = { ...tiny, tracks: [], vias: [], zones: tiny.zones }
  const { board, stale } = withStaleCopper(build, tiny)
  expect(board.tracks).toEqual(tiny.tracks)
  expect(board.vias).toEqual(tiny.vias)
  expect(board.zones).toEqual(tiny.zones) // the build's own pour, not twice
  expect([...stale].sort()).toEqual([...tiny.tracks, ...tiny.vias].map((x) => x.uuid).sort())
  expect(board.footprints).toBe(build.footprints)
})

it("keeps the build's own kept copper fresh", () => {
  const build = { ...tiny, tracks: tiny.tracks.slice(0, 1), vias: [] }
  expect(withStaleCopper(build, tiny).stale.has(tiny.tracks[0].uuid)).toBe(false)
})
