// Makes site/stories/simple-blinker.board.js: the board of the landing page's story, read from the builds and routes
// of a real project with the app's own board reader (src/shared/board), so the story draws what pino drew. Nothing is
// made up: each state is one build or one route of the folder, and the parts move between two builds only because
// their poses are both in the files.
//   node app/scripts/story-board.mjs <board folder>
// It reads the folder's .pino/build/<hash>/ and .pino/routes/<key>/ and writes that one file. docs/images/README.md
// says when to run it again.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(app, '..', 'site/stories/simple-blinker.board.js')

/** The builds and routes the story shows, by the name the story gives them. */
const BUILDS = { h4: 'c29cdce03645', h5: 'af39f066a6c0', h7: 'f66177b10123', h9: '04a2f6f95346' }
const ROUTES = { r1: 'eeb94dc44068', r2: 'c8a53b923557', r3: '7d855e483413' }

const folder = process.argv[2] && resolve(process.argv[2])
if (!folder || !existsSync(join(folder, '.pino'))) {
  console.error('usage: node app/scripts/story-board.mjs <board folder>')
  process.exit(2)
}

// The app's board reader is TypeScript; vite loads it as the app's tests do, with no server listening.
const vite = await createServer({ root: app, configFile: false, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, entries: [] } })
const { readBoard } = await vite.ssrLoadModule('/src/shared/board/board.ts')
const { padPolygons } = await vite.ssrLoadModule('/src/shared/board/outlines.ts')
const { rotate, simplify } = await vite.ssrLoadModule('/src/shared/board/geom.ts')
const { toKicad } = await vite.ssrLoadModule('/src/shared/board/coords.ts')
const { parseSexpr, kid, kids, num } = await vite.ssrLoadModule('/src/shared/board/sexpr.ts')
const { edgeLoops, arrivalTracks } = await vite.ssrLoadModule('/src/renderer/board/scene.ts')
await vite.close()

const r2 = (v) => Math.round(v * 100) / 100
const f = (v) => String(r2(v))
const poly = (pts) => 'M' + pts.map((p) => f(p.x) + ' ' + f(p.y)).join('L') + 'Z'
const line = (a, b) => 'M' + f(a.x) + ' ' + f(a.y) + 'L' + f(b.x) + ' ' + f(b.y)

/** The shapes of a footprint in its own frame: what turns and moves with it. */
function localOf(fp) {
  const toLocal = (p) => rotate({ x: p.x - fp.pos.x, y: p.y - fp.pos.y }, -fp.angle)
  // A pad's round corners are walked to a micrometre; at the size the story draws them, 10 µm is enough.
  const pads = fp.pads.filter((p) => p.copper.length).flatMap((p) => padPolygons(p).map((pts) => poly(simplify([...pts, pts[0]], 0.01).slice(0, -1).map(toLocal)))).join('')
  const holes = fp.pads.filter((p) => p.drill).map((p) => { const c = toLocal(p.pos); return [r2(c.x), r2(c.y), r2(Math.min(p.drill.w, p.drill.h) / 2)] })
  const silk = fp.graphics.filter((g) => g.layer === 'F.SilkS').map((g) => {
    const s = g.shape
    if (s.k === 'line') return line(toLocal(s.a), toLocal(s.b))
    if (s.k === 'circle') { const c = toLocal(s.c); return 'M' + f(c.x + s.r) + ' ' + f(c.y) + 'a' + f(s.r) + ' ' + f(s.r) + ' 0 1 0 ' + f(-2 * s.r) + ' 0a' + f(s.r) + ' ' + f(s.r) + ' 0 1 0 ' + f(2 * s.r) + ' 0' }
    if (s.k === 'poly') return 'M' + s.pts.map((p) => { const q = toLocal(p); return f(q.x) + ' ' + f(q.y) }).join('L') + (s.fill ? 'Z' : '')
    if (s.k === 'arc') { const a = toLocal(s.s), b = toLocal(s.e); return line(a, b) }
    return ''
  }).join('')
  return { pads, holes, silk }
}

/** Where each footprint's reference is printed: KiCad keeps it in the footprint's frame, its angle on the board. */
function labelsOf(src) {
  const labels = {}
  for (const n of kids(parseSexpr(src), 'footprint')) {
    const at = kid(n, 'at')
    const pos = { x: Number(at[1]), y: Number(at[2]) }, angle = Number(at[3] ?? 0)
    for (const p of kids(n, 'property')) {
      if (p[1] !== 'Reference' || kid(p, 'hide')?.[1] === 'yes') continue
      const pa = kid(p, 'at'), q = rotate({ x: Number(pa[1]), y: Number(pa[2]) }, angle)
      const size = num(kid(kid(p, 'effects'), 'font'), 'size')
      labels[p[2]] = [r2(pos.x + q.x), r2(pos.y + q.y), Number(pa[3] ?? 0), size || 1]
    }
  }
  return labels
}

// A part's shapes, once for each footprint it has had: a part that only moved or turned keeps its key, so the story
// can move it; one whose footprint changed gets a new one, and is drawn out and in.
const shapes = {}
const libs = {}
const keyOf = (fp) => {
  const what = fp.lib + '|' + fp.side
  const known = Object.keys(libs).find((k) => k.startsWith(fp.ref + '/') && libs[k] === what)
  if (known) return known
  const k = fp.ref + '/' + Object.keys(libs).filter((x) => x.startsWith(fp.ref + '/')).length
  libs[k] = what
  shapes[k] = localOf(fp)
  return k
}

const pourOf = (board) => board.zones.filter((z) => !z.keepout && !z.teardrop).flatMap((z) => z.fills.map((fl) => ({ net: z.net, layer: fl.layer, d: poly(fl.pts) })))

let box = null, edge = null
const builds = {}
for (const [name, hash] of Object.entries(BUILDS)) {
  const dir = join(folder, '.pino/build', hash)
  const src = readFileSync(join(dir, 'board.kicad_pcb'), 'utf8')
  const board = readBoard(src)
  const filled = readBoard(readFileSync(join(dir, 'filled/board.kicad_pcb'), 'utf8'))
  if (!edge) {
    edge = edgeLoops(board).map(poly).join('')
    box = [board.box.x0, board.box.y0, board.box.x1, board.box.y1].map(r2)
  }
  const placement = JSON.parse(readFileSync(join(dir, 'placement.json'), 'utf8'))
  const rats = placement.edges.map(([, a, b]) => line(toKicad({ x: a[0], y: a[1] }), toKicad({ x: b[0], y: b[1] }))).join('')
  // The ratsnest's ends are pads of the build: a check that the two frames meet.
  const centres = board.footprints.flatMap((fp) => fp.pads.map((p) => p.center))
  for (const end of placement.edges.flatMap(([, a, b]) => [a, b])) {
    const p = toKicad({ x: end[0], y: end[1] })
    if (!centres.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 0.6)) throw new Error(`${name}: a ratsnest end at ${end} is on no pad`)
  }
  const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'))
  builds[name] = {
    hash,
    counts: { parts: result.counts.parts, nets: result.counts.nets, unrouted: result.counts.unrouted, errors: result.counts.errors },
    parts: Object.fromEntries(board.footprints.map((fp) => [fp.ref, [r2(fp.pos.x), r2(fp.pos.y), fp.angle, keyOf(fp)]])),
    labels: labelsOf(src),
    rats,
    pour: pourOf(filled)
  }
}

const routes = {}
for (const [name, key] of Object.entries(ROUTES)) {
  const dir = join(folder, '.pino/routes', key)
  const board = readBoard(readFileSync(join(dir, 'board.kicad_pcb'), 'utf8'))
  const filled = readBoard(readFileSync(join(dir, 'filled/board.kicad_pcb'), 'utf8'))
  const route = JSON.parse(readFileSync(join(dir, 'route.json'), 'utf8'))
  // Tracks in the order the app draws them in: net by net, each from its pads outwards; runs of one net, layer and
  // width are one path.
  const tracks = []
  for (const t of arrivalTracks(board)) {
    const last = tracks[tracks.length - 1]
    const seg = line(t.a, t.b)
    if (last && last.net === t.net && last.layer === t.layer && last.w === r2(t.w)) last.d += seg
    else tracks.push({ net: t.net, layer: t.layer, w: r2(t.w), d: seg })
  }
  routes[name] = {
    key,
    build: Object.keys(BUILDS).find((b) => BUILDS[b] === route.build) ?? route.build,
    counts: route.counts,
    tracks,
    vias: board.vias.map((v) => [r2(v.pos.x), r2(v.pos.y), r2(v.size / 2), r2(v.drill / 2)]),
    pour: pourOf(filled),
    // Where an error is on the board, in the board's frame; one said of no place on the board is not drawn.
    errors: route.findings.filter((x) => x.severity === 'error' && x.at?.space === 'board').map((x) => { const p = toKicad(x.at); return [r2(p.x), r2(p.y)] })
  }
}

// A route that kept another's copper names it in place of a copy.
const names = Object.keys(routes)
names.forEach((name, i) => {
  for (const what of ['tracks', 'pour']) {
    const same = names.slice(0, i).find((n) => typeof routes[n][what] !== 'string' && JSON.stringify(routes[n][what]) === JSON.stringify(routes[name][what]))
    if (same) routes[name][what] = same
  }
})

const data = { box, edge, shapes, builds, routes }
const text = '// Made by app/scripts/story-board.mjs from the builds and routes of the board in the story; do not edit.\n' +
  'PinoStory.board(\'simple-blinker\', ' + JSON.stringify(data) + ')\n'
if (/\/home\/|\/Users\//.test(text)) throw new Error('a home folder is in the data')
writeFileSync(out, text)
console.log(`${out}: ${(text.length / 1024).toFixed(1)} KB, ${Object.keys(shapes).length} part shapes, ${Object.keys(builds).length} builds, ${Object.keys(routes).length} routes`)
