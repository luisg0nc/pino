// The engine's stand-in speaks the serve protocol as the engine does. Every process here is one this file started.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { buildResultOf, type BuildResult } from './shared/build'
import { readingOf } from './shared/cards'
import type { PartsResult } from './shared/fab'
import { FAKE_KERNEL } from './test/fixtures'

type Reply = Record<string, any>

let dir: string
let project: string
const children: ChildProcessWithoutNullStreams[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pino-fake-kernel-'))
  project = dir
  writeFileSync(join(project, 'board.py'), 'b = 1\n')
})

afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null) c.kill('SIGKILL')
  rmSync(dir, { recursive: true, force: true })
})

function serve(env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [FAKE_KERNEL, 'serve'], { env: { ...process.env, ...env } })
  children.push(child)
  const lines: Reply[] = []
  const waiting: Array<() => void> = []
  createInterface({ input: child.stdout }).on('line', (line) => {
    lines.push(JSON.parse(line) as Reply)
    for (const w of waiting.splice(0)) w()
  })
  let id = 0
  const send = (message: Reply): number => {
    child.stdin.write(`${JSON.stringify({ id: ++id, ...message })}\n`)
    return id
  }
  const final = async (rid: number): Promise<Reply> => {
    for (;;) {
      const hit = lines.find((l) => l.id === rid && !('event' in l))
      if (hit) return hit
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
  }
  const call = (message: Reply) => final(send(message))
  const build = async (): Promise<BuildResult> => buildResultOf((await call({ op: 'build', project })).result)!
  return { child, lines, send, final, call, build }
}

const boardOf = (hash: string, name = 'board.kicad_pcb') => readFileSync(join(project, '.pino/build', hash, name), 'utf8')

function atOf(board: string, ref: string): number[] {
  const block = board.split(/\n\t(?=\(footprint )/).find((b) => b.includes(`(property "Reference" "${ref}"`))!
  return /\n\t\t\(at ([-\d. ]+)\)/.exec(block)![1].split(' ').map(Number)
}

it('builds into the project and counts up', async () => {
  const k = serve()
  // as the engine does, which names its protocol only from 2 on
  expect((await k.call({ op: 'ping' })).pong).toEqual({ kernel: '0.1.1-fake', schema: 'pino.build/1' })
  const a = await k.build()
  writeFileSync(join(project, 'board.py'), 'b = 2\n')
  const b = await k.build()
  expect([a.number, b.number]).toEqual([1, 2])
  expect(a.hash).toMatch(/^[0-9a-f]{12}$/)
  expect(b.hash).not.toBe(a.hash)
  expect(a.artifacts.board).toBe(`.pino/build/${a.hash}/board.kicad_pcb`)
  for (const h of [a.hash!, b.hash!]) {
    expect(existsSync(join(project, '.pino/build', h, 'board.kicad_pcb'))).toBe(true)
    expect(existsSync(join(project, '.pino/build', h, 'result.json'))).toBe(true)
  }
  const history = JSON.parse(readFileSync(join(project, '.pino/builds.json'), 'utf8'))
  expect(history.schema).toBe('pino.builds/1')
  expect(history.builds.map((e: Reply) => e.number)).toEqual([1, 2])
  expect(b.headline.startsWith('On h2: ')).toBe(true)
  expect(b.routing).toBeUndefined()
})

it('moves a part once the board file is no longer the first one built', async () => {
  const k = serve({ FAKE_KERNEL_MOVE: 'R4:1.5,0.5' })
  const a = await k.build()
  writeFileSync(join(project, 'board.py'), 'b = 2\n')
  const b = await k.build()
  for (const name of ['board.kicad_pcb', 'filled/board.kicad_pcb']) {
    const [x0, y0] = atOf(boardOf(a.hash!, name), 'R4')
    const [x1, y1] = atOf(boardOf(b.hash!, name), 'R4')
    expect(x1).toBeCloseTo(x0 + 1.5, 6)
    expect(y1).toBeCloseTo(y0 - 0.5, 6) // board y is up, the file's is down
  }
  expect(b.changes.layout.join(' ')).toContain('R4')
  const diff = await k.call({ op: 'diff', project, from: a.hash, to: b.hash })
  expect(diff.changes.layout.join(' ')).toContain('R4')
  rmSync(join(project, '.pino/build', a.hash!), { recursive: true })
  expect((await k.call({ op: 'diff', project, from: a.hash, to: b.hash })).error).toBe(`build ${a.hash} is no longer kept`)
})

it('fails the build it is told to, with a place in board.py', async () => {
  const k = serve({ FAKE_KERNEL_FAIL_ON: '1' })
  const r = await k.build()
  expect([r.verdict, r.hash]).toEqual(['failed', null])
  expect(r.findings[0]).toMatchObject({ source: 'board.py', message: 'invalid syntax', at: { file: 'board.py', line: 12 } })
})

it('says why it dies', async () => {
  const k = serve({ FAKE_KERNEL_DIE: 'build' })
  let said = ''
  k.child.stderr.on('data', (d) => (said += d))
  k.send({ op: 'build', project })
  const code = await new Promise((resolve) => k.child.on('close', resolve))
  expect(code).toBe(1)
  expect(said).toContain('fake kernel died during a build')
})

it('streams a route, answers current, then stale after a move', async () => {
  const k = serve({ FAKE_KERNEL_SERVE: '2', FAKE_KERNEL_MOVE: 'R4:1.5,0' })
  expect((await k.call({ op: 'ping' })).pong.serve).toBe(2)
  expect((await k.build()).routing!.state).toBe('none')
  const id = k.send({ op: 'route', project })
  const done = await k.final(id)
  const events = k.lines.filter((l) => l.id === id && l.event).map((l) => l.event)
  expect(events[0]).toEqual({ event: 'step', step: 'signals', index: 1, of: 1 })
  const nets = events.filter((e) => e.event === 'net')
  expect(nets.length).toBeGreaterThan(5)
  expect(nets.at(-1)).toMatchObject({ index: nets.length, of: nets.length })
  expect(done.result).toMatchObject({ schema: 'pino.route/1', state: 'done', complete: true })
  const current = await k.build()
  expect(current.routing).toMatchObject({ state: 'current', unrouted: 0 })
  expect(current.counts.unrouted).toBe(0)
  const routed = readFileSync(join(project, current.routing!.route!, 'filled/board.kicad_pcb'), 'utf8')
  expect(routed.split('(segment').length - 1).toBeGreaterThan(5)
  writeFileSync(join(project, 'board.py'), 'b = 2\n')
  const stale = await k.build()
  expect(stale.routing).toMatchObject({ state: 'stale', stale_because: ['parts moved'], route_key: current.routing!.route_key })
  expect((await k.call({ op: 'route_status', project })).status.state).toBe('stale')
})

it('cancels a route', async () => {
  const k = serve({ FAKE_KERNEL_SERVE: '2', FAKE_KERNEL_ROUTE_MS: '100' })
  await k.build()
  const id = k.send({ op: 'route', project })
  expect((await k.call({ op: 'route_cancel', job: id })).cancelled).toBe(true)
  expect((await k.final(id)).result.state).toBe('cancelled')
  expect((await k.call({ op: 'route_cancel', job: 999 })).cancelled).toBe(false)
})

it('answers a part it cannot ask jlcsearch about as the engine does: no part, and a finding that says why', async () => {
  const k = serve({ FAKE_KERNEL_SERVE: '3', FAKE_KERNEL_PARTS: 'unreachable' })
  const { result } = await k.call({ op: 'parts', action: 'get', lcsc: 'C25804' })
  expect(result.parts).toEqual([])
  expect(result.findings).toMatchObject([{ code: 'parts_unavailable', severity: 'error' }])
  expect(result.headline).toBe('Parts: jlcsearch could not be reached')
  expect(readingOf(result as PartsResult, 'C25804', new Date())).toEqual({ refused: 'jlcsearch could not be reached' })
})

it('answers shutdown and ends', async () => {
  const k = serve()
  const closed = new Promise((resolve) => k.child.on('close', resolve))
  expect((await k.call({ op: 'shutdown' })).ok).toBe(true)
  expect(await closed).toBe(0)
})
