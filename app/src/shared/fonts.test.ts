import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { MONO_FACE, UI_FACE, canvasFont } from './fonts'

it('canvasFont names the face, the weight and the fallback', () => {
  expect(UI_FACE).toBe('Instrument Sans')
  expect(MONO_FACE).toBe('Martian Mono')
  expect(canvasFont(12, 500, true)).toBe('500 12px "Martian Mono", ui-monospace, monospace')
  expect(canvasFont(12)).toBe('400 12px "Instrument Sans", system-ui, sans-serif')
  expect(canvasFont(10.5, 600)).toBe('600 10.5px "Instrument Sans", system-ui, sans-serif')
})

/** Every file under a folder, without node_modules and the build's output. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? (name === 'node_modules' ? [] : walk(path)) : [path]
  })
}

const named = /Instrument Sans|Martian Mono/

it('no family name is written outside shared/fonts.ts and tokens.css', () => {
  const src = resolve(__dirname, '..')
  const allowed = new Set(['shared/fonts.ts', 'renderer/styles/tokens.css'])
  const outside = walk(src)
    .map((file) => relative(src, file))
    .filter((file) => !allowed.has(file) && file !== 'shared/fonts.test.ts')
    .filter((file) => named.test(readFileSync(join(src, file), 'utf8')))
  expect(outside).toEqual([])
})

// The landing page is served on its own: its sheet cannot import the window's, so it declares the two faces and their
// tokens itself (`site.test.ts` holds them to the window's). It is the one file of site/ that may name them.
it('no family name is written in the landing page outside its stylesheet', () => {
  const site = resolve(__dirname, '../../../site')
  // The page, its sheet, its script and the mark; the fonts and pictures the build copies in are not text.
  const outside = walk(site)
    .filter((file) => /\.(html|css|js|svg)$/.test(file))
    .map((file) => relative(site, file))
    .filter((file) => file !== 'assets/site.css')
    .filter((file) => named.test(readFileSync(join(site, file), 'utf8')))
  expect(outside).toEqual([])
})
