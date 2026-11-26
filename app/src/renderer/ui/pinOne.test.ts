import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { DIMENSIONS, ICON16_SHAPES, markSvg, PART, SCRIBE_PATHS, TILE_SHAPES, type MarkShape } from './pinOne'

const repo = resolve(__dirname, '../../../..')
const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8'))![1]

/** Every coordinate a shape names: a rect's four, the numbers of a path (arc flags are 0 and 1, whole anyway). */
const numbers = (s: MarkShape): number[] => ('rect' in s ? s.rect.slice(0, 4) : s.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number)).map((v) => v ?? 0)

it('draws the icon on whole pixels and the tile on the 64 grid', () => {
  for (const s of ICON16_SHAPES) for (const v of numbers(s)) expect(Number.isInteger(v)).toBe(true)
  for (const s of TILE_SHAPES) for (const v of numbers(s)) expect(Math.abs(v % 0.5)).toBe(0)
})

it('has eight legs and a body with the pin-1 dot cut out of it', () => {
  for (const [shapes, legs] of [[TILE_SHAPES, 8], [ICON16_SHAPES, 8]] as const) {
    expect(shapes.filter((s) => 'rect' in s)).toHaveLength(legs)
    const body = shapes.filter((s) => 'd' in s)
    expect(body).toHaveLength(1)
    // one outline and one hole: two subpaths, which the even-odd rule leaves open
    expect((('d' in body[0] && body[0].d) || '').match(/M/g)).toHaveLength(2)
  }
})

it('has one shape in the accent, pin 1: the top left leg, and the rest in ink', () => {
  for (const [shapes, leg] of [[TILE_SHAPES, [10, 13, 10, 4, 1]], [ICON16_SHAPES, [2, 3, 3, 1]]] as const) {
    const accent = shapes.filter((s) => s.fill === 'accent')
    expect(accent).toHaveLength(1)
    expect('rect' in accent[0] && accent[0].rect).toEqual(leg)
    const legs = shapes.flatMap((s) => ('rect' in s ? [s.rect] : []))
    // top left: no leg is higher, and none further left
    expect(Math.min(...legs.map((r) => r[1]))).toBe(leg[1])
    expect(Math.min(...legs.map((r) => r[0]))).toBe(leg[0])
  }
})

it('scribes the chip with its pin 1 leg filled, and its three dimensions', () => {
  expect(SCRIBE_PATHS).toHaveLength(10)
  expect(PART).toMatch(/^M[^M]*z$/)
  expect(DIMENSIONS.map((d) => d.text)).toEqual(['3.9', '1.27', 'pin 1'])
})

it('writes the even-odd rule for a path with a hole', () => {
  const svg = markSvg(TILE_SHAPES, 64, { ink: '#000000', accent: '#00ff00' })
  expect(svg).toMatch(/<path d="[^"]+" fill-rule="evenodd" fill="#000000"\/>/)
})

it("ships pin one as the launcher's icon: the files are what the shapes draw", () => {
  const colours = { ink: '#20242B', accent: token('--accent'), tile: '#F1EFEA' }
  expect(readFileSync(resolve(repo, 'scripts/pino.svg'), 'utf8')).toBe(markSvg(TILE_SHAPES, 64, colours))
  expect(existsSync(resolve(repo, 'scripts/pino-16.svg'))).toBe(true)
  expect(readFileSync(resolve(repo, 'scripts/pino-16.svg'), 'utf8')).toBe(markSvg(ICON16_SHAPES, 16, colours))
})
