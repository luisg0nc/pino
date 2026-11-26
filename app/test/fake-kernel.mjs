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
//                       .pino/routes/<key>/ (the build's filled board plus one F.Cu segment per ratsnest edge) and
//                       answers a pino.route/1 result; builds answer `routing`, current until a part moves
//   route_status, route_cancel, route_net, nudge, keep   canned, in the engine's shapes
//
// Switches:
//   FAKE_KERNEL_SERVE=1|2        the protocol it speaks (1: no routing, and no `serve` in the pong)
//   FAKE_KERNEL_DELAY_MS=<ms>    how long a build takes
//   FAKE_KERNEL_FAIL_ON=<n>      build n fails: board.py, "invalid syntax", line 12
//   FAKE_KERNEL_DIE=start|build  exits 1 with a line on stderr, at start or at the first build
//   FAKE_KERNEL_MOVE=<ref>:<dx>,<dy>  once board.py is no longer what the first build read, that footprint stands
//                                dx, dy board millimetres (y up) from where the fixture has it
//   FAKE_KERNEL_ROUTE_MS=<ms>    between two `net` events of a route
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
const SERVE = env.FAKE_KERNEL_SERVE === '2' ? 2 : 1

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

const running = new Map() // job id -> { cancelled }

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
  if (SERVE === 2) {
    result.routing = routingOf(memory, isMoved, [...running.values()].some((j) => j.project === project && !j.cancelled))
    if (result.routing.state === 'current') result.counts.unrouted = 0
    result.waiting = result.routing.state === 'current' ? [] : [result.routing.state === 'stale' ? 'routing: stale (parts moved)' : result.routing.state === 'running' ? 'routing: running' : 'routing: not started']
  }
  const clause = SERVE === 2 && result.routing.state === 'current' ? `; routed r${result.routing.number}, 0 left, DRC clean` : SERVE === 2 && result.routing.state === 'stale' ? '; copper stale (parts moved)' : ''
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

async function route(id, project) {
  const job = { project, cancelled: false }
  running.set(id, job)
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
  write(join(folder, 'route.json'), `${JSON.stringify(result, null, 1)}\n`)
  const fresh = memoryOf(project)
  fresh.routes = number
  fresh.route = { key, number, seconds: result.counts.nets ? seconds() : 0 }
  write(memoryPath(project), JSON.stringify(fresh))
  return { ok: true, result }
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
      return { ok: true, pong: { kernel: VERSION, schema: 'pino.build/1', ...(SERVE === 2 ? { serve: 2, route_schema: 'pino.route/1' } : {}) } }
    case 'build':
      return build(req.project)
    case 'diff':
      return diff(req)
    default:
      break
  }
  if (SERVE === 2) {
    if (req.op === 'route_status') {
      const memory = memoryOf(req.project)
      const isMoved = memory.builds.at(-1)?.moved ?? false
      return { ok: true, status: routingOf(memory, isMoved, [...running.values()].some((j) => j.project === req.project)) }
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
    if (SERVE === 2 && req.op === 'route_cancel') {
      const job = running.get(req.job)
      if (job) job.cancelled = true
      send({ id: req.id, ok: true, cancelled: !!job })
      return
    }
    if (SERVE === 2 && req.op === 'route') {
      queue = queue.then(() => {
        const done = route(req.id, req.project).then((reply) => send({ id: req.id, ...reply }))
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

const command = process.argv[2] ?? 'serve'
if (command === 'serve') serve()
else {
  process.stderr.write(`fake kernel: unknown command ${command}\n`)
  process.exit(2)
}
