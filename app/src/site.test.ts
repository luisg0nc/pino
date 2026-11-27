import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TILE_SHAPES, markSvg } from './renderer/ui/pinOne'
import { MONO_FACE, UI_FACE } from './shared/fonts'
// @ts-expect-error: a plain .mjs script, without types
import { COPIED } from '../scripts/build-site.mjs'

// The landing page at pino.luisg.me (site/index.html): every local address is a file in git or one that
// app/scripts/build-site.mjs copies in the Pages build, nothing is loaded from another host, and motion is reduced
// when asked.
const root = resolve(__dirname, '../..')
const site = join(root, 'site')
const html = readFileSync(join(site, 'index.html'), 'utf8')
const css = readFileSync(join(site, 'assets/site.css'), 'utf8')
const copied = COPIED as Record<string, string>

const attrs = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1])
const loaded = [...attrs(/\b(?:src|poster|srcset)="([^"]+)"/g), ...attrs(/<link\b[^>]*\bhref="([^"]+)"/g)]
const links = attrs(/<a\b[^>]*\bhref="([^"]+)"/g)

/** The width and height a picture of the page has, from the PNG's own header. */
const sizeOf = (path: string): [number, number] => {
  const png = readFileSync(join(root, copied[path]))
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

describe('site/index.html', () => {
  it('loads nothing from another host', () => {
    expect(loaded.filter((u) => /^(https?:)?\/\//.test(u))).toEqual([])
    expect(css).not.toMatch(/url\(\s*['"]?(https?:)?\/\//)
    expect(css).not.toMatch(/@import/)
  })

  it('names only files that are there or that the Pages build copies', () => {
    const local = [...loaded, ...links, ...[...css.matchAll(/url\(([^)]+)\)/g)].map((m) => `assets/${m[1]}`)]
      .filter((u) => !/^([a-z]+:|\/\/|#)/.test(u))
      .map((u) => u.split('#')[0].replace(/\/$/, '/index.html'))
    expect(local.length).toBeGreaterThan(10)
    for (const path of local) {
      const there = existsSync(join(site, path)) || path in copied
      expect(there, path).toBe(true)
    }
    for (const from of Object.values(copied)) expect(existsSync(join(root, from)), from).toBe(true)
  })

  it('has the six sections, in order', () => {
    expect(attrs(/<section\b[^>]*\bid="([^"]+)"/g)).toEqual(['hero', 'loop', 'window', 'for', 'run', 'links'])
    expect(html.match(/<section\b/g)).toHaveLength(6)
  })

  it('links the run section, the repository, its issues and the sibling', () => {
    expect(links).toContain('#run')
    expect(links.filter((u) => u === 'https://github.com/luisg0nc/pino').length).toBeGreaterThanOrEqual(2)
    expect(links).toContain('https://github.com/luisg0nc/pino/issues')
    expect(links).toContain('https://torno.luisg.me/')
  })

  it('is served at pino.luisg.me, with a square link preview', () => {
    expect(readFileSync(join(site, 'CNAME'), 'utf8')).toBe('pino.luisg.me\n')
    expect(html).toContain('<meta property="og:url" content="https://pino.luisg.me/">')
    expect(html).toContain('<meta property="og:image" content="https://pino.luisg.me/assets/img/social-preview.png">')
    expect(html).toContain('<meta name="twitter:card" content="summary">')
    expect(copied['assets/img/social-preview.png']).toBe('docs/images/social-preview.png')
    expect(sizeOf('assets/img/social-preview.png')).toEqual([1200, 1200])
  })

  it('shows the hero in the theme of the system', () => {
    expect(html).toMatch(/<source media="\(prefers-color-scheme: dark\)" srcset="assets\/img\/hero-dark\.png">\s*<img src="assets\/img\/hero\.png"/)
  })

  it('says the size each picture has', () => {
    const pictures = [...html.matchAll(/<img src="(assets\/img\/[^"]+)"[^>]*? width="(\d+)" height="(\d+)"/g)]
    expect(pictures.map((m) => m[1])).toEqual(['hero', 'brief', 'schematic', 'board', '3d'].map((name) => `assets/img/${name}.png`))
    for (const [, path, width, height] of pictures) expect([path, Number(width), Number(height)]).toEqual([path, ...sizeOf(path)])
  })

  it('has no long dash', () => {
    for (const text of [html, css, readFileSync(join(site, 'assets/site.js'), 'utf8')]) expect(text).not.toMatch(/[–—]/)
  })

  it('draws the mark from the window\'s pin one, in the light tokens', () => {
    const light = readFileSync(join(root, 'app/src/renderer/styles/tokens.css'), 'utf8').split('@media (prefers-color-scheme: dark)')[0]
    const token = (name: string): string => new RegExp(`${name}:\\s*(#[0-9A-F]{6});`).exec(light)![1]
    expect(readFileSync(join(site, 'assets/pino.svg'), 'utf8')).toBe(markSvg(TILE_SHAPES, 64, { ink: token('--ink'), accent: token('--accent'), tile: token('--surface') }))
  })

  it('is deployed by the Pages workflow when the page or what it copies changes', () => {
    const yml = readFileSync(join(root, '.github/workflows/pages.yml'), 'utf8')
    expect(yml).toContain('paths: [site/**, docs/images/**, app/scripts/build-site.mjs, .github/workflows/pages.yml]')
    expect(yml.match(/run: .+/g)).toEqual(['run: pnpm install --frozen-lockfile', 'run: node app/scripts/build-site.mjs'])
    expect(yml).toContain('path: site\n')
  })

  it('reduces motion when asked', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
})

// Its palette and faces are the window's (site.css says so): every token it names has the value of tokens.css, in light and in dark,
// and the faces are the window's two, set `swap`, with the body's face preloaded.
describe('site/assets/site.css', () => {
  const tokens = (text: string): Record<string, string> => Object.fromEntries([...text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
  const halves = (text: string): [string, string] => {
    const at = text.indexOf('@media (prefers-color-scheme: dark)')
    return [text.slice(0, at), text.slice(at)]
  }
  const ownToTheSite = new Set(['--measure'])

  it('uses the tokens of the window, to the value, in light and in dark', () => {
    const app = halves(readFileSync(join(root, 'app/src/renderer/styles/tokens.css'), 'utf8'))
    const ours = halves(css)
    for (const theme of [0, 1]) {
      const [mine, theirs] = [tokens(ours[theme]), tokens(app[theme])]
      expect(Object.keys(mine).length).toBeGreaterThan(8)
      for (const [name, value] of Object.entries(mine)) if (!ownToTheSite.has(name)) expect([name, value]).toEqual([name, theirs[name]])
    }
  })

  it('sets the window\'s two faces, swapped in, and preloads the body\'s', () => {
    const faces = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1])
    expect(faces.map((face) => /font-family: '([^']+)'; font-weight: (\d+)/.exec(face)!.slice(1).join(' '))).toEqual([`${UI_FACE} 400`, `${UI_FACE} 500`, `${UI_FACE} 600`, `${MONO_FACE} 400`])
    for (const face of faces) expect(face).toContain('font-display: swap')
    for (const [, file] of css.matchAll(/url\(([^)]+\.woff2)\)/g)) expect(`assets/${file}` in copied, file).toBe(true)
    expect(Object.keys(copied).filter((path) => path.endsWith('.woff2'))).toHaveLength(4)
    expect(attrs(/<link rel="preload" href="([^"]+)" as="font"/g)).toEqual(['assets/fonts/instrument-sans-400.woff2'])
  })
})
