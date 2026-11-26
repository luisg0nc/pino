import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { DIMENSIONS, ICON16_SHAPES, PART, probeSvg, SCRIBE_PATHS, TILE_SHAPES } from './probe'

const repo = resolve(__dirname, '../../../..')
const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8'))![1]

it('draws the icon on whole pixels and the tile on the 64 grid', () => {
  for (const s of ICON16_SHAPES) for (const v of 'rect' in s ? s.rect : []) expect(Number.isInteger(v)).toBe(true)
  for (const s of TILE_SHAPES) for (const v of 'rect' in s ? s.rect.slice(0, 4) : []) expect((v ?? 0) % 0.5).toBe(0)
})

it('has one part in the accent, the board, and the rest of the probe in ink', () => {
  for (const shapes of [TILE_SHAPES, ICON16_SHAPES]) expect(shapes.map((s) => s.fill).filter((f) => f === 'accent')).toHaveLength(1)
})

it('scribes the probe over a hatched board, with its three dimensions', () => {
  expect(SCRIBE_PATHS.length).toBeGreaterThanOrEqual(8)
  expect(DIMENSIONS.map((d) => d.text)).toEqual(['⌀1.02', '1.5 travel', 'pad 1.6'])
  expect(PART.hatches).toHaveLength(22)
})

it("ships the probe as the launcher's icon: the files are what the shapes draw", () => {
  const colours = { ink: '#20242B', accent: token('--accent'), tile: '#F1EFEA' }
  expect(readFileSync(resolve(repo, 'scripts/pino.svg'), 'utf8')).toBe(probeSvg(TILE_SHAPES, 64, colours))
  expect(existsSync(resolve(repo, 'scripts/pino-16.svg'))).toBe(true)
  expect(readFileSync(resolve(repo, 'scripts/pino-16.svg'), 'utf8')).toBe(probeSvg(ICON16_SHAPES, 16, colours))
})
