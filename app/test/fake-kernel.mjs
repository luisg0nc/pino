// Stands in for pino's engine in tests: `pino-kernel serve` over JSON lines, drawing every build from the fixture
// in fixtures/reference-build/ (what the real engine wrote for the reference board). It writes only into the
// project's .pino/, as the engine does. Run as `node fake-kernel.mjs serve` (PINO_KERNEL_CMD), or with `version`.
//
//   ping                answers {pong: {kernel: '0.1.1-fake', schema: 'pino.build/1'}}, with `serve: 2` from protocol 2
//   build               copies the fixture into .pino/build/<hash>/ (hash aaaaaaaa<n as 4 hex>), adds the build to
//                       .pino/builds.json and answers the fixture's result with the number counted up
//   diff                from its own log of what each build moved
//   shutdown
// With FAKE_KERNEL_SERVE=2 it also routes (the engine's routing stage):
//   route               streams a step, one `net` event per net of the ratsnest and `step_done`, writes
//                       .pino/routes/<key>/ (the build's filled board plus one F.Cu segment per ratsnest edge, and a
//                       board.glb: the build's with one board_via mesh more) and answers a pino.route/1 result; builds answer `routing`, current until a part moves
//   route_status, route_cancel, route_net, nudge, keep   canned, in the engine's shapes
// With FAKE_KERNEL_SERVE=3 it also does parts and fab files (the fab stage); `cancel` is `route_cancel`:
//   fab_profiles        the profiles in fixtures/fab-profiles.json (the engine's own, to_json)
//   parts               canned pino.parts/1: C25804 (maps to Device:R), C51118 (no KiCad part); a search finds two
//   release_status      ready for 1.0.0, or blocked by release_not_routed (FAKE_KERNEL_RELEASE=refused)
//   release             the steps gates, parts, gerbers, write, then `released` with fab/v1.0.0/README.md written in
//                       the project (a release writes outside .pino/ there, and only there)
//
// Switches:
//   FAKE_KERNEL_SERVE=1|2|3      the protocol it speaks (1: no routing, and no `serve` in the pong; 3: fab files)
//   FAKE_KERNEL_RELEASE=refused|unchanged|broken   how a release ends, instead of `released`
//   FAKE_KERNEL_RELEASE_MS=<ms>  between two steps of a release
//   FAKE_KERNEL_PARTS=offline    parts answer from a cache of 2026-11-20, saying jlcsearch was not reached
//   FAKE_KERNEL_PARTS=unreachable  jlcsearch is not reached and nothing is kept: no part, a parts_unavailable error
//   FAKE_KERNEL_DELAY_MS=<ms>    how long a build takes
//   FAKE_KERNEL_FAIL_ON=<n>      build n fails: board.py, "invalid syntax", line 12
//   FAKE_KERNEL_DIE=start|build  exits 1 with a line on stderr, at start or at the first build
//   FAKE_KERNEL_MOVE=<ref>:<dx>,<dy>  once board.py is no longer what the first build read, that footprint stands
//                                dx, dy board millimetres (y up) from where the fixture has it
//   FAKE_KERNEL_ROUTE_MS=<ms>    between two `net` events of a route
//   FAKE_KERNEL_NO_ROUTE_GLB=1   a route writes and lists no board.glb, as one made before routes had a model
//   FAKE_KERNEL_LOG=<file>       every request line it reads is added to the file
//   FAKE_KERNEL_NO_KICAD=1       `version` answers that kicad-cli is not there

import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const FOLDER = '.pino'
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'reference-build')
const FILES = ['board.kicad_pcb', 'filled/board.kicad_pcb', 'schematic.svg', 'sheet.json', 'circuit.json', 'placement.json', 'drc.json', 'board.glb']
const VERSION = '0.1.1-fake'
const env = process.env
const SERVE = env.FAKE_KERNEL_SERVE === '3' ? 3 : env.FAKE_KERNEL_SERVE === '2' ? 2 : 1
const PROFILES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fab-profiles.json')

const fixture = (name) => readFileSync(join(FIXTURE, name), 'utf8')
const reference = () => JSON.parse(fixture('result.json'))
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const die = (why) => {
  process.stderr.write(`fake kernel ${why}\n`)
  process.exit(1)
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, text)
  renameSync(`${path}.tmp`, path)
}

function readJson(path, otherwise) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return otherwise
  }
}

/** What the stand-in remembers of a project between runs of it: the engine keeps the same in its build folders. */
const memoryPath = (project) => join(project, FOLDER, 'fake-kernel.json')
const memoryOf = (project) => readJson(memoryPath(project), { first: null, builds: [], route: null, routes: 0 })

const move = (() => {
  const m = /^([^:]+):(-?[\d.]+),(-?[\d.]+)$/.exec(env.FAKE_KERNEL_MOVE ?? '')
  return m ? { ref: m[1], dx: Number(m[2]), dy: Number(m[3]) } : null
})()

const round = (v) => Math.round(v * 1e6) / 1e6

/** The board with the footprint of the given reference moved; the file's y is down. */
function moved(board) {
  const parts = board.split(/\n(?=\t\(footprint )/)
  return parts
    .map((block) => {
      if (!block.includes(`(property "Reference" "${move.ref}"`)) return block
      return block.replace(/(\n\t\t\(at )(-?[\d.]+) (-?[\d.]+)/, (_, head, x, y) => `${head}${round(Number(x) + move.dx)} ${round(Number(y) - move.dy)}`)
    })
    .join('\n')
}

function placementAfter(isMoved) {
  const placement = JSON.parse(fixture('placement.json'))
  const pose = isMoved ? placement.poses[move.ref] : undefined
  if (pose) {
    pose.x = round(pose.x + move.dx)
    pose.y = round(pose.y + move.dy)
  }
  return placement
}

const netsOf = (placement) => [...new Set(placement.edges.map((e) => e[0]))].sort()

function failed(number) {
  const finding = { source: 'board.py', code: 'syntax_error', severity: 'error', message: 'invalid syntax', at: { space: 'source', file: 'board.py', line: 12 } }
  return {
    ...reference(),
    number,
    hash: null,
    verdict: 'failed',
    headline: `On h${number}: board.py failed at line 12: invalid syntax`,
    counts: { errors: 1, warnings: 0, infos: 0, parts: 0, nets: 0, unrouted: 0, crossings: 0 },
    findings: [finding],
    artifacts: {},
    changes: { circuit: [], layout: [] },
    placement: null
  }
}

const routeKeyOf = (isMoved) => (isMoved ? 'cccccccc00000002' : 'cccccccc00000001')

function routingOf(memory, isMoved, running) {
  const base = { state: 'none', key: routeKeyOf(isMoved), route: null, route_key: null, number: null, stale_because: [], complete: null, unrouted: null, router_share: null, router_seconds: null, drc_errors: null, copper_errors: null, verdict: null }
  const route = memory.route
  if (!route) return running ? { ...base, state: 'running' } : base
  const of = { ...base, route: `${FOLDER}/routes/${route.key}`, route_key: route.key, number: route.number, complete: true, unrouted: 0, router_share: 1, router_seconds: route.seconds, drc_errors: 0, copper_errors: 0, verdict: 'ok' }
  if (route.key === routeKeyOf(isMoved)) return { ...of, state: 'current' }
  if (running) return { ...of, state: 'running' }
  return { ...of, state: 'stale', stale_because: ['parts moved'] }
}

const running = new Map() // job id -> { project, op, cancelled }
const routingNow = (project) => [...running.values()].some((j) => j.op === 'route' && j.project === project && !j.cancelled)

async function build(project) {
  if (env.FAKE_KERNEL_DIE === 'build') die('died during a build')
  if (!existsSync(project) || !statSync(project).isDirectory()) return { ok: false, error: `no project folder at ${project}` }
  if (env.FAKE_KERNEL_DELAY_MS) await sleep(Number(env.FAKE_KERNEL_DELAY_MS))
  const memory = memoryOf(project)
  const historyPath = join(project, FOLDER, 'builds.json')
  const history = readJson(historyPath, { schema: 'pino.builds/1', builds: [] })
  const number = history.builds.reduce((most, b) => Math.max(most, b.number), 0) + 1
  const record = (hash, verdict) => {
    history.builds.push({ number, hash, verdict, at: new Date().toISOString() })
    write(historyPath, `${JSON.stringify(history, null, 1)}\n`)
  }
  if (Number(env.FAKE_KERNEL_FAIL_ON) === number) {
    record(null, 'failed')
    return { ok: true, result: failed(number) }
  }

  const source = createHash('sha1')
  try {
    source.update(readFileSync(join(project, 'board.py')))
  } catch {
    source.update('no board.py')
  }
  const digest = source.digest('hex')
  memory.first ??= digest
  const isMoved = !!move && digest !== memory.first
  const hash = `aaaaaaaa${number.toString(16).padStart(4, '0')}`
  const folder = join(project, FOLDER, 'build', hash)
  for (const name of FILES) {
    mkdirSync(dirname(join(folder, name)), { recursive: true })
    if (isMoved && name.endsWith('.kicad_pcb')) writeFileSync(join(folder, name), moved(fixture(name)))
    else if (isMoved && name === 'placement.json') writeFileSync(join(folder, name), JSON.stringify(placementAfter(true), null, 1))
    else copyFileSync(join(FIXTURE, name), join(folder, name))
  }

  const result = reference()
  // The fixture is the real engine's, which routes: an engine of protocol 1 says nothing of routing.
  if (SERVE < 2) delete result.routing
  const previous = memory.builds.at(-1)
  result.number = number
  result.hash = hash
  result.cached = false
  result.artifacts = Object.fromEntries(
    Object.entries(result.artifacts).map(([name, path]) => [name, String(path).replace(/\.pino\/build\/[0-9a-f]+\//, `${FOLDER}/build/${hash}/`)])
  )
  result.changes = !previous
    ? { circuit: ['first build'], layout: [] }
    : { circuit: [], layout: previous.moved !== isMoved ? [`moves 1 part: ${move.ref}`] : [] }
  if (SERVE >= 2) {
    result.routing = routingOf(memory, isMoved, routingNow(project))
    if (result.routing.state === 'current') result.counts.unrouted = 0
    result.waiting = result.routing.state === 'current' ? [] : [result.routing.state === 'stale' ? 'routing: stale (parts moved)' : result.routing.state === 'running' ? 'routing: running' : 'routing: not started']
  }
  const clause = SERVE >= 2 && result.routing.state === 'current' ? `; routed r${result.routing.number}, 0 left, DRC clean` : SERVE >= 2 && result.routing.state === 'stale' ? '; copper stale (parts moved)' : ''
  const { errors, warnings, unrouted } = result.counts
  result.headline = `On h${number}: ${errors} errors, ${warnings} warnings${unrouted ? `, ${unrouted} unrouted` : ''}${clause}`
  memory.builds.push({ number, hash, moved: isMoved })
  write(memoryPath(project), JSON.stringify(memory))
  write(join(folder, 'result.json'), `${JSON.stringify(result, null, 1)}\n`)
  record(hash, result.verdict)
  return { ok: true, result }
}

function diff({ project, from, to }) {
  const memory = memoryOf(project)
  const of = (hash) => memory.builds.find((b) => b.hash === hash && existsSync(join(project, FOLDER, 'build', hash)))
  for (const hash of [from, to]) {
    if (!/^[0-9a-f]{12}$/.test(String(hash))) return { ok: false, error: 'not a build hash' }
    if (!of(hash)) return { ok: false, error: `build ${hash} is no longer kept` }
  }
  return { ok: true, changes: { circuit: [], layout: of(from).moved !== of(to).moved ? [`moves 1 part: ${move.ref}`] : [] } }
}

function routeResult(state, number, key, build, nets, seconds) {
  return {
    schema: 'pino.route/1', kernel_version: VERSION, router: { name: 'KiCadRoutingTools', version: 'fake', commit: '0000000' },
    key, build, number, state, verdict: state === 'done' ? 'ok' : 'failed',
    headline: state === 'done' ? `Route r${number}: router ${nets}/${nets} nets in ${seconds} s, 0 left, DRC clean` : `Route r${number}: cancelled after ${seconds} s`,
    complete: state === 'done', counts: { nets, unrouted: state === 'done' ? 0 : nets, tracks: nets, vias: 0, track_mm: 100, drc_errors: 0, drc_warnings: 0, copper_errors: 0, copper_warnings: 0 },
    share: null, findings: [], truncated: 0, steps: [], timings: [], artifacts: {}, cached: false
  }
}

/** One F.Cu segment for each line of the ratsnest, in the file's frame. */
function copperFor(placement) {
  return placement.edges
    .map(([net, a, b], i) => {
      const at = ([x, y]) => `${round(x + 100)} ${round(100 - y)}`
      return `\t(segment\n\t\t(start ${at(a)})\n\t\t(end ${at(b)})\n\t\t(width 0.25)\n\t\t(layer "F.Cu")\n\t\t(net "${net}")\n\t\t(uuid "dddddddd-0000-4000-8000-${String(i + 1).padStart(12, '0')}")\n\t)\n`
    })
    .join('')
}

/** The fixture's model with one mesh more, a copy of its pads under the name KiCad gives vias: the routed one. */
function routedGlb() {
  const bytes = readFileSync(join(FIXTURE, 'board.glb'))
  const length = bytes.readUInt32LE(12)
  const gltf = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'))
  const pads = gltf.meshes.findIndex((m) => m.name === 'board_pad')
  const node = gltf.nodes.findIndex((n) => n.mesh === pads)
  const parent = gltf.nodes.find((n) => n.children?.includes(node))
  gltf.meshes.push({ ...gltf.meshes[pads], name: 'board_via' })
  gltf.nodes.push({ ...gltf.nodes[node], name: 'fake_vias', mesh: gltf.meshes.length - 1 })
  parent.children.push(gltf.nodes.length - 1)
  const text = JSON.stringify(gltf)
  const json = Buffer.from(text + ' '.repeat((4 - (Buffer.byteLength(text) % 4)) % 4))
  const head = Buffer.from(bytes.subarray(0, 20))
  head.writeUInt32LE(bytes.length - length + json.length, 8)
  head.writeUInt32LE(json.length, 12)
  return Buffer.concat([head, json, bytes.subarray(20 + length)])
}

async function route(id, project) {
  const job = running.get(id) // there since its line was read, so that a cancel sent right after it finds it
  const started = Date.now()
  const seconds = () => Math.round((Date.now() - started) / 100) / 10
  const memory = memoryOf(project)
  const last = memory.builds.at(-1)
  if (!last) {
    running.delete(id)
    return { ok: false, error: 'save board.py first: there is no build to route' }
  }
  const number = memory.routes + 1
  const key = routeKeyOf(last.moved)
  const placement = placementAfter(last.moved)
  const nets = netsOf(placement)
  const event = (e) => send({ id, event: e })
  event({ event: 'step', step: 'signals', index: 1, of: 1 })
  for (const [i, net] of nets.entries()) {
    await sleep(Number(env.FAKE_KERNEL_ROUTE_MS ?? 0) || 1)
    if (job.cancelled) break
    event({ event: 'net', step: 'signals', index: i + 1, of: nets.length, net })
  }
  running.delete(id)
  if (job.cancelled) return { ok: true, result: routeResult('cancelled', number, null, last.hash, nets.length, seconds()) }
  event({ event: 'step_done', step: 'signals', routed: nets.length })
  const folder = join(project, FOLDER, 'routes', key)
  for (const name of ['board.kicad_pcb', 'filled/board.kicad_pcb']) {
    const board = readFileSync(join(project, FOLDER, 'build', last.hash, 'filled', 'board.kicad_pcb'), 'utf8')
    const end = board.lastIndexOf(')')
    write(join(folder, name), `${board.slice(0, end)}${copperFor(placement)})\n`)
  }
  const result = routeResult('done', number, key, last.hash, nets.length, seconds())
  if (!env.FAKE_KERNEL_NO_ROUTE_GLB) {
    write(join(folder, 'board.glb'), routedGlb())
    result.artifacts.glb = `${FOLDER}/routes/${key}/board.glb`
  }
  write(join(folder, 'route.json'), `${JSON.stringify(result, null, 1)}\n`)
  const fresh = memoryOf(project)
  fresh.routes = number
  fresh.route = { key, number, seconds: result.counts.nets ? seconds() : 0 }
  write(memoryPath(project), JSON.stringify(fresh))
  return { ok: true, result }
}

const FAKE_PARTS = {
  C25804: { lcsc: 'C25804', mfr: '0603WAF1002T5E', package: '0603', description: '10kΩ 100mW Thick Film Resistor ±1% 0603 Chip Resistor - Surface Mount ROHS', stock: 1234567, price: 0.0024, class: 'basic', checked_at: '2026-11-26T05:00:00.000Z', fetched_at: '2026-11-26T06:00:00+00:00' },
  C51118: { lcsc: 'C51118', mfr: 'AP2112K-3.3TRG1', package: 'SOT-25-5', description: '3.3V 600mA Linear Voltage Regulator', stock: null, price: 0.09, class: 'extended', checked_at: '2026-11-03T22:33:00.000Z', fetched_at: '2026-11-26T06:00:00+00:00' }
}

function parts(req) {
  // jlcsearch not reached and nothing kept: no part, and the finding that says so (the engine's parts_unavailable).
  if (env.FAKE_KERNEL_PARTS === 'unreachable') {
    const findings = [{ source: 'parts', code: 'parts_unavailable', severity: 'error', message: 'jlcsearch could not be reached, and no answer is kept.' }]
    return { ok: true, result: { schema: 'pino.parts/1', kind: req.action, query: {}, parts: [], resolved: [], findings, source: { url: 'https://jlcsearch.tscircuit.com', fresh: false, fetched_at: null }, headline: 'Parts: jlcsearch could not be reached' } }
  }
  const offline = env.FAKE_KERNEL_PARTS === 'offline'
  const found = req.action === 'search' ? Object.values(FAKE_PARTS).slice(0, req.limit ?? 8) : [FAKE_PARTS[String(req.lcsc).toUpperCase()]].filter(Boolean)
  const shown = offline ? found.map((p) => ({ ...p, checked_at: null, fetched_at: '2026-11-20T06:00:00+00:00' })) : found
  const resolved = req.action === 'search' ? [] : shown.map((p) => (p.lcsc === 'C25804' ? { lcsc: p.lcsc, how: 'kicad-rule', symbol: 'Device:R', footprint: 'Resistor_SMD:R_0603_1608Metric', notes: [] } : { lcsc: p.lcsc, how: null, symbol: null, footprint: null, notes: ['no KiCad mapping: pass symbol= and footprint= in board.py'] }))
  const first = shown[0]
  const headline = offline
    ? 'Parts: jlcsearch could not be reached; stock from 2026-11-20'
    : req.action === 'search'
      ? `Parts: ${shown.length} found for ${req.q}${req.basic ? ' (basic only)' : ''}, stock from jlcsearch now`
      : first
        ? `Parts: ${first.lcsc} is ${first.class}, ${first.package}`
        : `Parts: JLC has no part ${req.lcsc}`
  return { ok: true, result: { schema: 'pino.parts/1', kind: req.action, query: {}, parts: shown, resolved, findings: [], source: { url: 'https://jlcsearch.tscircuit.com', fresh: !offline, fetched_at: first?.fetched_at ?? null }, headline } }
}

const releaseGate = (code, message) => ({ source: 'release', code, severity: 'error', message })

function readinessOf(project) {
  const memory = memoryOf(project)
  const last = memory.builds.at(-1)
  const build = last ? { number: last.number ?? memory.builds.length, hash: last.hash } : null
  if (env.FAKE_KERNEL_RELEASE === 'refused') {
    return { ready: false, build, route: null, blockers: [releaseGate('release_not_routed', 'the board is not routed: route it first')], warnings: [], next_version: null, bump: null, why: [] }
  }
  return { ready: true, build, route: { number: 1, key: 'cccccccc00000001' }, blockers: [], warnings: [], next_version: '1.0.0', bump: null, why: ['first release'] }
}

function releaseResult(state, project, extra) {
  const { build } = readinessOf(project)
  return {
    schema: 'pino.release/1', kernel_version: VERSION, state, version: null, previous: null, bump: null, why: [], build, route: { number: 1, key: 'cccccccc00000001' }, folder: null, files: [],
    counts: { assembled: 20, bom_lines: 12, hand_fit: 1, dnp: 1, basic: 9, preferred: 0, extended: 3, easyeda: 0, gerbers: 9, drills: 2 },
    findings: [], truncated: 0, headline: '', timings: [], ...extra
  }
}

/** A finding at a part of the fixture's placement, so that a release's findings have somewhere to be pinned. */
function atPart(ref, code, severity, message) {
  const pose = JSON.parse(fixture('placement.json')).poses[ref]
  return { source: 'release', code, severity, message, at: { space: 'board', x: pose.x, y: pose.y, layer: 'F.Cu' }, refs: [ref] }
}

async function release(id, project) {
  const job = running.get(id)
  const wait = Number(env.FAKE_KERNEL_RELEASE_MS ?? 0) || 1
  for (const step of ['gates', 'parts', 'gerbers', 'write']) {
    send({ id, event: { event: 'step', step } })
    await sleep(wait)
    if (job.cancelled) break
  }
  running.delete(id)
  if (job.cancelled) return { ok: true, result: releaseResult('cancelled', project, { headline: 'Release cancelled: nothing was written' }) }
  const how = env.FAKE_KERNEL_RELEASE
  if (how === 'broken') return { ok: false, error: 'release job stopped: the release job broke' }
  if (how === 'refused') {
    return { ok: true, result: releaseResult('refused', project, { headline: 'Release refused: 1 error (U2 has no LCSC number)', findings: [atPart('U2', 'part_no_lcsc', 'error', 'U2 has no LCSC number, so JLC cannot place it: add lcsc=, or hand_fit=True')] }) }
  }
  if (how === 'unchanged') return { ok: true, result: releaseResult('unchanged', project, { why: ['the same files as v1.0.0'], headline: 'Nothing to release: h1 makes the same files as v1.0.0' }) }
  const readme = '# fake v1.0.0, fab files for JLCPCB\n'
  write(join(project, 'fab', 'v1.0.0', 'README.md'), readme)
  return {
    ok: true,
    result: releaseResult('released', project, {
      version: '1.0.0', why: ['first release'], folder: 'fab/v1.0.0',
      headline: 'Release v1.0.0 (h1, r1): JLC places 20 parts in 12 BOM lines, 1 by hand: fab/v1.0.0/',
      files: [{ path: 'fab/v1.0.0/README.md', bytes: Buffer.byteLength(readme), sha256: createHash('sha256').update(readme).digest('hex') }, { path: 'fab/v1.0.0/fake-v1.0.0-gerbers.zip', bytes: 26322, sha256: '0'.repeat(64) }],
      findings: [atPart('U2', 'rotation_unchecked', 'info', "Check U2's rotation in JLC's preview: its rule was never checked there"), { source: 'release', code: 'part_stock_unknown', severity: 'warning', message: 'stock of C51118 not known: last checked 2026-11-03 (U2)', refs: ['U2'] }]
    })
  }
}

function trial(kind, req) {
  const subject = kind === 'nudge' ? req.part : req.net
  const snippet =
    kind === 'route_net' ? `b.route_hint("${req.net}"${req.layers ? `, layers=${JSON.stringify(req.layers)}` : ''})`
    : kind === 'nudge' ? `b.place(b.part("${req.part}"), at=(1, 2), rot=0)`
    : `b.keep_route("${req.net}", frm=b.part("J1")["VBUS"], to=b.part("U2")["VIN"], layer="F.Cu", width=0.5, points=[(1, 2), (3, 2)])`
  return {
    schema: 'pino.trial/1', kind, base: { build: 'aaaaaaaa0001', route: null }, number: 1, ok: true,
    headline: `${kind} ${subject}: done`,
    before: kind === 'nudge' ? { crossings: 4, length_mm: 190, score: 12 } : { net_complete: false, unrouted_nets: 3, drc_errors: 0 },
    after: kind === 'nudge' ? { crossings: 3, length_mm: 184, score: 11 } : { net_complete: true, unrouted_nets: 2, drc_errors: 0 },
    findings: [], truncated: 0, snippet, replaces_line: kind === 'nudge' ? 91 : null, artifacts: {}, seconds: 0.2
  }
}

async function answer(req) {
  switch (req.op) {
    case 'ping':
      return { ok: true, pong: { kernel: VERSION, schema: 'pino.build/1', ...(SERVE >= 2 ? { serve: SERVE, route_schema: 'pino.route/1' } : {}), ...(SERVE >= 3 ? { parts_schema: 'pino.parts/1', release_schema: 'pino.release/1' } : {}) } }
    case 'build':
      return build(req.project)
    case 'diff':
      return diff(req)
    default:
      break
  }
  if (SERVE >= 3) {
    if (req.op === 'fab_profiles') return { ok: true, profiles: JSON.parse(readFileSync(PROFILES, 'utf8')) }
    if (req.op === 'release_status') return { ok: true, status: readinessOf(req.project) }
    if (req.op === 'parts') return parts(req)
  }
  if (SERVE >= 2) {
    if (req.op === 'route_status') {
      const memory = memoryOf(req.project)
      const isMoved = memory.builds.at(-1)?.moved ?? false
      return { ok: true, status: routingOf(memory, isMoved, routingNow(req.project)) }
    }
    if (req.op === 'keep' || req.op === 'nudge' || req.op === 'route_net') return { ok: true, result: trial(req.op, req) }
  }
  return { ok: false, error: `unknown op '${req.op}'` }
}

function serve() {
  if (env.FAKE_KERNEL_DIE === 'start') die('died at start')
  let queue = Promise.resolve() // ordered ops are answered in the order they came
  const lines = createInterface({ input: process.stdin })
  const jobs = new Set()
  const stop = async (id) => {
    for (const job of running.values()) job.cancelled = true
    await Promise.all(jobs)
    if (id !== undefined) send({ id, ok: true })
    process.stdout.write('', () => process.exit(0))
  }
  lines.on('line', (line) => {
    if (!line.trim()) return
    if (env.FAKE_KERNEL_LOG) appendFileSync(env.FAKE_KERNEL_LOG, `${line}\n`)
    let req
    try {
      req = JSON.parse(line)
    } catch (error) {
      send({ id: null, ok: false, error: `that line is not JSON: ${error.message}` })
      return
    }
    if ((SERVE >= 2 && req.op === 'route_cancel') || (SERVE >= 3 && req.op === 'cancel')) {
      const job = running.get(req.job)
      if (job) job.cancelled = true
      send({ id: req.id, ok: true, cancelled: !!job })
      return
    }
    if ((SERVE >= 2 && req.op === 'route') || (SERVE >= 3 && req.op === 'release')) {
      running.set(req.id, { project: req.project, op: req.op, cancelled: false })
      queue = queue.then(() => {
        const done = (req.op === 'route' ? route : release)(req.id, req.project).then((reply) => send({ id: req.id, ...reply }))
        jobs.add(done)
        void done.finally(() => jobs.delete(done))
      })
      return
    }
    queue = queue.then(async () => {
      if (req.op === 'shutdown') return stop(req.id)
      try {
        send({ id: req.id, ...(await answer(req)) })
      } catch (error) {
        send({ id: req.id, ok: false, error: `the fake engine failed: ${error.message}` })
      }
    })
  })
  lines.on('close', () => void queue.then(() => stop(undefined)))
}

/** What `pino-kernel version` prints: the engine's own shape. */
function version() {
  const found = !env.FAKE_KERNEL_NO_KICAD
  const libraries = found ? { KICAD10_SYMBOL_DIR: '/usr/share/kicad/symbols' } : null
  send({ kernel: VERSION, schema: 'pino.build/1', kicad_cli: found ? '10.0.6' : null, libraries })
}

const command = process.argv[2] ?? 'serve'
if (command === 'serve') serve()
else if (command === 'version') version()
else {
  process.stderr.write(`fake kernel: unknown command ${command}\n`)
  process.exit(2)
}
