import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJson, tempProject } from '../../test/fixtures'
import { toolsOver } from '../../test/mcp'
import { routedLoop } from '../../test/routing'
import type { FabProfile } from '../../shared/fab'
import { Fab } from '../fab'
import type { ToolDeps } from './tools'

let project: ReturnType<typeof tempProject>
const done: Array<() => Promise<unknown> | void> = []

beforeEach(() => {
  project = tempProject()
  writeFileSync(join(project.dir, 'board.py'), 'first')
})
afterEach(async () => {
  for (const undo of done.splice(0).reverse()) await undo()
  project.remove()
})

const [TWO_LAYER] = readJson<FabProfile[]>('test/fixtures/fab-profiles.json')

async function tools(env: Record<string, string> = {}, over: Partial<ToolDeps> = {}) {
  const loop = routedLoop(project, { FAKE_KERNEL_SERVE: '3', ...env })
  done.push(loop.dispose)
  await loop.built()
  const fab = new Fab({ kernel: () => loop.kernel(), running: loop.running, builds: loop.builds, engine: () => loop.builds.state(loop.info.id)!.engine, onState: () => {} })
  const mcp = await toolsOver({ project: () => loop.info, state: (id) => loop.builds.state(id), fab, ...over }, loop.info.id)
  return { ...mcp, loop, fab }
}

describe('parts', () => {
  it('answers a part by number with its class, stock and price, and the line for board.py', async () => {
    const t = await tools()
    const said = await t.call('parts', { lcsc: 'c25804' })
    expect(said).toContain('C25804 · basic · 0603 · ')
    expect(said).toContain('stock 1,234,567 at JLC (checked 2026-11-26) · $0.0024 each')
    expect(said).toContain('In board.py: lcsc="C25804" (pino maps it to Device:R and Resistor_SMD:R_0603_1608Metric)')
  })

  it('says when pino has no KiCad part for a number', async () => {
    const t = await tools()
    expect(await t.call('parts', { lcsc: 'C51118' })).toContain('In board.py: lcsc="C51118" with symbol= and footprint=: pino has no KiCad part for it')
  })

  it('searches, with a line for each part', async () => {
    const t = await tools()
    const said = await t.call('parts', { search: '10k 0603', basic: true, limit: 2 })
    expect(said.split('\n')[0]).toBe('Parts: 2 found for 10k 0603 (basic only), stock from jlcsearch now')
    expect(said.split('\n').filter((l) => /^C\d+ · /.test(l))).toHaveLength(2)
    expect(said).toContain('stock not known at JLC')
  })

  it('says a jlcsearch failure with the cached answer and its date', async () => {
    const t = await tools({ FAKE_KERNEL_PARTS: 'offline' })
    const said = await t.call('parts', { lcsc: 'C25804' })
    expect(said.split('\n')[0]).toBe('Parts: jlcsearch could not be reached; stock from 2026-11-20')
    expect(said).toContain('C25804 · basic')
  })

  it('refuses both lcsc and search at once, and neither', async () => {
    const t = await tools()
    for (const args of [{ lcsc: 'C1', search: 'x' }, {}]) {
      const said = await t.call('parts', args)
      expect(said).toBe('Give lcsc (a part number) or search (words), one of the two.')
    }
  })

  // A new project: Claude looks parts up before it writes board.py, so nothing has been built and no engine runs yet.
  it('answers in a project with no board, and writes nothing in it', async () => {
    rmSync(join(project.dir, 'board.py'))
    const log = join(project.root, 'kernel-log.jsonl')
    const t = await tools({ FAKE_KERNEL_LOG: log })
    expect(t.loop.builds.state(t.loop.info.id)!.engine.state).toBe('starting')
    // Several at once, as Claude asks them: one engine, pinged once.
    const said = await Promise.all(['C25804', 'C51118', 'C25804'].map((lcsc) => t.call('parts', { lcsc })))
    expect(said[0]).toContain('C25804 · basic')
    expect(said[1]).toContain('C51118 · extended')
    const ops = readFileSync(log, 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as { op: string }).op)
    expect(ops.filter((op) => op === 'ping')).toHaveLength(1)
    expect(ops).not.toContain('build')
    expect(existsSync(join(project.dir, '.pino'))).toBe(false)
  })

  it('says the engine is too old, on an engine of protocol 2', async () => {
    const t = await tools({ FAKE_KERNEL_SERVE: '2' })
    expect(await t.call('parts', { lcsc: 'C25804' })).toBe("The engine is too old for parts and fab files: it speaks protocol 2, and they need 3. Update pino's engine (its kernel/ folder).")
  })

  it('says the engine did not start, and why', async () => {
    rmSync(join(project.dir, 'board.py'))
    const t = await tools({ FAKE_KERNEL_DIE: 'start' })
    expect(await t.call('parts', { lcsc: 'C25804' })).toBe('The engine did not start: fake kernel died at start')
    // The next lookup, right after, says the same and starts nothing.
    expect(await t.call('parts', { lcsc: 'C25804' })).toBe('The engine did not start: fake kernel died at start')
    expect(t.loop.started.size).toBe(1)
  })

  it('puts the fab limits in the project answer', async () => {
    const t = await tools({}, { fabProfile: async () => TWO_LAYER })
    expect(await t.call('project', {})).toContain('Fab: JLC standard 2-layer. Tracks and gaps 0.10 mm or more')
  })

  it('leaves the project answer alone when no build names a fab', async () => {
    const t = await tools({}, { fabProfile: async () => null })
    expect(await t.call('project', {})).not.toContain('Fab:')
  })

  // The limits come before any choice about layers or copper, and those are made before there is a board.py.
  it("gives the default fab's limits in a project with no board, and says that they are the default", async () => {
    rmSync(join(project.dir, 'board.py'))
    const log = join(project.root, 'kernel-log.jsonl')
    const t = await tools({ FAKE_KERNEL_LOG: log }, { fabProfile: async () => null })
    const said = await t.call('project', {})
    expect(said).toContain("No board.py yet, so these are the default fab's limits: what a board that names no fab gets. That is for 2 layers; with layers=4 it gets JLC standard 4-layer.")
    expect(said).toContain('Fab: JLC standard 2-layer. Tracks and gaps 0.10 mm or more')
    await t.call('project', {})
    const ops = readFileSync(log, 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as { op: string }).op)
    expect(ops.filter((op) => op === 'fab_profiles')).toHaveLength(1)
    expect(ops).not.toContain('build')
    expect(existsSync(join(project.dir, '.pino'))).toBe(false)
  })

  // A first start under uv may take minutes: `project` is what Claude calls first, and it does not wait for that.
  it('answers without the limits while the engine is slow to give them, and gives them once it has', async () => {
    rmSync(join(project.dir, 'board.py'))
    let give: () => void = () => {}
    const given = new Promise<void>((done) => (give = done))
    const slow = { parts: () => Promise.reject(new Error('not asked')), state: () => null as never, defaultFab: () => given.then(() => ({ profile: TWO_LAYER, profiles: [TWO_LAYER] })) }
    const t = await tools({}, { fabProfile: async () => null, fab: slow, fabWaitMs: 20 })
    const first = await t.call('project', {})
    expect(first).toContain('board.py: absent')
    expect(first).toContain("The fab's limits are still being fetched, as the engine is slow to answer: call project again in a moment, before you offer any choice about layers, copper, holes or tracks.")
    expect(first).not.toContain('Fab: ')
    give()
    expect(await t.call('project', {})).toContain('Fab: JLC standard 2-layer.')
  })

  it("says why the default limits are not known, and still answers", async () => {
    rmSync(join(project.dir, 'board.py'))
    for (const [env, why] of [[{ FAKE_KERNEL_DIE: 'start' }, 'The engine did not start: fake kernel died at start'], [{ FAKE_KERNEL_SERVE: '2' }, 'The engine is too old for parts and fab files']] as const) {
      const t = await tools(env, { fabProfile: async () => null })
      const answer = await t.result('project', {})
      expect(answer.isError).toBeFalsy()
      const said = answer.content.map((c) => c.text).join('\n')
      expect(said).toContain('board.py: absent')
      expect(said).toContain(`The fab's limits are not known: ${why}`)
    }
  })
})
