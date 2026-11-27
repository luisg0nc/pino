import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
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
const read = (path: string) => readFileSync(join(site, path), 'utf8')
/** The page's own scripts and stylesheets, by their path under site/. */
const own = ['assets/site.js', 'assets/story.js', 'assets/story.css', 'stories/simple-blinker.js', 'stories/simple-blinker.board.js']

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
    for (const text of [css, read('assets/story.css')]) {
      expect(text).not.toMatch(/url\(\s*['"]?(https?:)?\/\//)
      expect(text).not.toMatch(/@import/)
    }
    // The scripts name no address but SVG's namespace, and fetch nothing.
    for (const path of own.filter((p) => p.endsWith('.js'))) {
      expect([path, read(path).match(/https?:\/\/[^'"\s)]+/g)?.filter((u) => u !== 'http://www.w3.org/2000/svg') ?? []]).toEqual([path, []])
      expect(read(path), path).not.toMatch(/\bfetch\(|XMLHttpRequest|import\(/)
    }
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

  it('has the eight sections, in order', () => {
    expect(attrs(/<section\b[^>]*\bid="([^"]+)"/g)).toEqual(['hero', 'loop', 'story', 'window', 'for', 'run', 'links', 'author'])
    expect(html.match(/<section\b/g)).toHaveLength(8)
  })

  it('links the run section, the repository, its issues, the sibling with its mark, and the author', () => {
    expect(links).toContain('#run')
    expect(links.filter((u) => u === 'https://github.com/luisg0nc/pino').length).toBeGreaterThanOrEqual(2)
    expect(links).toContain('https://github.com/luisg0nc/pino/issues')
    expect(html).toMatch(/<a class="[^"]*" href="https:\/\/torno\.luisg\.me\/"><img src="assets\/sibling\/torno\.svg" alt="" width="24" height="24">/)
    // torno's mark, as torno draws it: a bench vise holding a part.
    expect(read('assets/sibling/torno.svg')).toContain('torno is Portuguese for a bench vise')
    expect(links).toContain('https://luisg.me/')
  })

  it('opens each picture of the window full size, as a link to its PNG without script', () => {
    const zooms = [...html.matchAll(/<a class="zoom" href="([^"]+)"><img src="([^"]+)"/g)]
    expect(zooms.map((m) => m[1])).toEqual(['brief', 'schematic', 'board', '3d'].map((name) => `assets/img/${name}.png`))
    for (const [, href, src] of zooms) expect(href).toBe(src)
    expect(html).toMatch(/<dialog class="lightbox"/)
    expect(read('assets/site.js')).toMatch(/showModal/)
  })

  it('draws Claude Code in the heading, named for screen readers, and plays its moment once', () => {
    expect(html).toMatch(/<h1 id="hero-title">[^<]*<span class="cc" role="img" aria-label="Claude Code"><svg [^>]*aria-hidden="true"/)
    const animations = [...css.matchAll(/animation:\s*([^;}]+)/g)].map((m) => m[1])
    expect(animations.filter((a) => a.includes('cc-')).length).toBeGreaterThan(4)
    for (const a of animations) expect(a).not.toMatch(/infinite/)
  })

  it('is served at pino.luisg.me, with a square link preview', () => {
    expect(readFileSync(join(site, 'CNAME'), 'utf8')).toBe('pino.luisg.me\n')
    expect(html).toContain('<meta property="og:url" content="https://pino.luisg.me/">')
    expect(html).toContain('<meta property="og:image" content="https://pino.luisg.me/assets/img/site-preview.png">')
    expect(html).toContain('<meta name="twitter:card" content="summary">')
    expect(copied['assets/img/site-preview.png']).toBe('docs/images/site-preview.png')
    expect(sizeOf('assets/img/site-preview.png')).toEqual([1200, 1200])
  })

  it('has a drawn social preview for the repository, 1280 x 640, kept out of the page', () => {
    const png = readFileSync(join(root, 'docs/images/social-preview.png'))
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 640])
    expect(Object.values(copied)).not.toContain('docs/images/social-preview.png')
    const card = readFileSync(join(root, 'app/scripts/social-preview.html'), 'utf8')
    // Drawn, in the window's faces: no picture but the mark, and no face but the bundled ones.
    expect([...card.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1])).toEqual(['../../site/assets/pino.svg'])
    expect([...card.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]).every((u) => u.startsWith('../node_modules/@fontsource/'))).toBe(true)
    expect(readFileSync(join(root, 'app/scripts/social-preview.mjs'), 'utf8')).toMatch(/did not load/)
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
    for (const text of [html, css, ...own.map(read)]) expect(text).not.toMatch(/[–—]/)
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
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\*, \*::before, \*::after \{ animation: none !important; transition: none !important; \}/)
    expect(read('assets/story.css')).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    for (const path of ['assets/site.js', 'assets/story.js']) expect(read(path), path).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    // The heading's moment runs only once the script has said it may (`.js`), so the reduced page keeps its drawing.
    for (const [, rule] of css.matchAll(/\n([^\n{]*)\{[^}]*animation: cc-/g)) expect(rule.trim()).toMatch(/^\.js /)
  })
})

// The story (stories/simple-blinker.js, played by assets/story.js): every state it shows is a build or a route of the
// board's data, which app/scripts/story-board.mjs reads from the project's own files.
describe('the story', () => {
  type Line = { say: string; rev: string; state?: { build?: string; route?: string } }
  type Step = { you: string; before?: Line[]; lines?: Line[] }
  type Counts = Record<string, number>
  const captured: { story?: { board: string; steps: Step[] }; board?: { builds: Record<string, { hash: string; counts: Counts }>; routes: Record<string, { key: string; build: string; counts: Counts }> } } = {}
  const PinoStory = {
    add: (_name: string, story: typeof captured.story) => { captured.story = story },
    board: (_name: string, data: typeof captured.board) => { captured.board = data }
  }
  runInNewContext(read('stories/simple-blinker.board.js'), { PinoStory })
  runInNewContext(read('stories/simple-blinker.js'), { PinoStory })
  const { story, board } = captured as Required<typeof captured>
  const generator = readFileSync(join(root, 'app/scripts/story-board.mjs'), 'utf8')

  it('is loaded by the page, after the engine and its board', () => {
    expect(attrs(/<script src="([^"]+)" defer><\/script>/g)).toEqual(['assets/site.js', 'assets/story.js', 'stories/simple-blinker.board.js', 'stories/simple-blinker.js'])
    // Without script the figure tells the story in words; with it, those words are the screen reader's summary.
    expect(html).toMatch(/<figure data-story="simple-blinker"><p class="story-told">[^<]{200,}<\/p><\/figure>/)
    expect(read('assets/story.js')).toContain("root.querySelector('.story-told')")
  })

  it('shows only the builds and routes the data has, which are the ones the generator reads', () => {
    expect(story.board).toBe('simple-blinker')
    const lines = story.steps.flatMap((s) => [...(s.before ?? []), ...(s.lines ?? [])])
    expect(lines.length).toBeGreaterThan(5)
    for (const line of lines) {
      if (line.state?.build) expect(board.builds, line.say).toHaveProperty(line.state.build)
      if (line.state?.route) expect(board.routes, line.say).toHaveProperty(line.state.route)
      expect(line.rev, line.say).toMatch(/^h\d+$/)
    }
    for (const [name, b] of Object.entries(board.builds)) expect(generator).toContain(`${name}: '${b.hash}'`)
    for (const [name, r] of Object.entries(board.routes)) {
      expect(generator).toContain(`${name}: '${r.key}'`)
      expect(board.builds, name).toHaveProperty(r.build)
    }
  })

  it('says of each build and route what its own counts say, and shows each route on the build it was made on', () => {
    let build: string | undefined
    let checked = 0
    for (const line of story.steps.flatMap((s) => [...(s.before ?? []), ...(s.lines ?? [])])) {
      build = line.state?.build ?? build
      const route = line.state?.route
      const built = /^h\d+: (\d+) errors, (\d+) unrouted$/.exec(line.say)
      if (built) {
        const counts = board.builds[line.state!.build!].counts
        expect([line.say, Number(built[1]), Number(built[2])]).toEqual([line.say, counts.errors, counts.unrouted])
        checked++
      }
      if (route) {
        const r = board.routes[route]
        expect([line.say, r.build]).toEqual([line.say, build])
        expect(line.say).toMatch(new RegExp(`^Route ${route}: `))
        const nets = /(\d+) of (\d+) nets/.exec(line.say)
        if (nets) expect([line.say, Number(nets[1]), Number(nets[2])]).toEqual([line.say, r.counts.nets - r.counts.unrouted, r.counts.nets])
        const copper = /(\d+) copper errors/.exec(line.say)
        expect([line.say, copper ? Number(copper[1]) : 0]).toEqual([line.say, r.counts.copper_errors])
        expect([line.say, /DRC clean/.test(line.say)]).toEqual([line.say, r.counts.drc_errors === 0 && r.counts.copper_errors === 0])
        checked++
      }
    }
    expect(checked).toBe(5)
  })

  it('has three prompts, short, and nothing of the person\'s machine', () => {
    expect(story.steps.map((s) => s.you)).toHaveLength(3)
    for (const s of story.steps) expect(s.you.length).toBeLessThan(70)
    for (const path of ['stories/simple-blinker.js', 'stories/simple-blinker.board.js']) expect(read(path), path).not.toMatch(/\/home\/|\/Users\/|~\//)
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
