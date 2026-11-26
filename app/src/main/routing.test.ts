// Routing as main runs it, over the engine's stand-in: one job a project, its progress told, a build when it ends.

import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { referenceModel } from '../test/marks'
import { tempProject } from '../test/fixtures'
import { routedLoop } from '../test/routing'

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

const loop = (env: Record<string, string> = {}) => {
  const l = routedLoop(project, env)
  done.push(l.dispose)
  return l
}
const edgeNets = new Set(referenceModel().placement!.edges.map((e) => e[0])).size

describe('routing', () => {
  /** Routing refused, in these words, however it is asked for. */
  const refuses = async (l: ReturnType<typeof loop>, why: string): Promise<void> => {
    await l.built()
    expect(l.routing.refusal(l.info.id)).toBe(why)
    await expect(l.routing.start(l.info)).rejects.toThrow(why)
    await expect(l.routing.status(l.info)).rejects.toThrow(why)
    await expect(l.routing.trial(l.info, 'keep', { net: 'VBUS' })).rejects.toThrow(why)
  }

  it('says the engine is too old, with one that speaks protocol 1', async () => {
    await refuses(loop({ FAKE_KERNEL_SERVE: '1' }), "The engine is too old for routing: it speaks protocol 1, and routing needs 2. Update pino's engine (its kernel/ folder).")
  })

  it('says there is no built board yet, in a project with no board', async () => {
    rmSync(join(project.dir, 'board.py'))
    await refuses(loop(), 'No built board yet: routing works on a built board. Save board.py and wait for it to build.')
  })

  it('says the engine did not start, and why', async () => {
    await refuses(loop({ FAKE_KERNEL_DIE: 'start' }), 'The engine did not start: fake kernel died at start')
  })

  it('says the engine is starting, of a board that has been built', async () => {
    const l = loop()
    await l.built()
    l.builds.patch(l.info.id, { engine: { state: 'starting' } })
    expect(l.routing.refusal(l.info.id)).toBe('The engine is starting. Try again in a moment.')
    await expect(l.routing.start(l.info)).rejects.toThrow('The engine is starting. Try again in a moment.')
  })

  it('has no board to route when the only build failed', async () => {
    const l = loop({ FAKE_KERNEL_FAIL_ON: '1' })
    await l.built()
    await expect(l.routing.start(l.info)).rejects.toThrow('No built board yet: routing works on a built board.')
  })

  it('starts a route, tells its progress, and builds once it is done', async () => {
    const l = loop()
    await l.built()
    expect(await l.routing.start(l.info)).toMatchObject({ build: 1, already: false })
    await l.routing.whenDone(l.info.id)
    await l.built()
    const nets = l.states.flatMap((s) => (s.route?.net ? [s.route] : []))
    expect(nets.at(-1)).toMatchObject({ step: 'signals', index: edgeNets, of: edgeNets })
    expect(l.builds.state(l.info.id)!.route).toBeNull()
    expect(l.builds.latest(l.info.id)!.routing).toMatchObject({ state: 'current', number: 1 })
    expect(l.builds.latest(l.info.id)!.number).toBe(2)
    expect(l.routing.lastWords(l.info.id)).toContain('Route r1: router')
  })

  it('keeps one route a project, and cancels it', async () => {
    const l = loop({ FAKE_KERNEL_ROUTE_MS: '200' })
    await l.built()
    const first = await l.routing.start(l.info)
    expect(await l.routing.start(l.info)).toMatchObject({ job: first.job, already: true })
    expect(await l.routing.cancel(l.info)).toBe(true)
    await l.routing.whenDone(l.info.id)
    expect(l.routing.progress(l.info.id)).toBeNull()
    expect(l.routing.lastWords(l.info.id)).toContain('cancelled')
    expect(await l.routing.cancel(l.info)).toBe(false)
  })

  it('says the copper is stale after a save that moves a part, and why', async () => {
    const l = loop({ FAKE_KERNEL_MOVE: 'U2:1,0' })
    await l.built()
    await l.routing.start(l.info)
    await l.routing.whenDone(l.info.id)
    await l.built()
    writeFileSync(join(project.dir, 'board.py'), 'second')
    l.builds.rebuild(l.info.id)
    await l.built()
    expect(l.builds.latest(l.info.id)!.routing).toMatchObject({ state: 'stale', stale_because: ['parts moved'] })
    expect((await l.routing.status(l.info))!.state).toBe('stale')
  })

  it('answers a trial with the engine\'s own words, a nudge that routes as a job', async () => {
    const log = join(project.root, 'asked.jsonl')
    const l = loop({ FAKE_KERNEL_LOG: log })
    await l.built()
    expect(await l.routing.trial(l.info, 'route_net', { net: 'VBUS', layers: ['F.Cu'] })).toMatchObject({ kind: 'route_net', snippet: 'b.route_hint("VBUS", layers=["F.Cu"])' })
    expect(await l.routing.trial(l.info, 'nudge', { part: 'U2', by: [1, 0] })).toMatchObject({ kind: 'nudge', replaces_line: 91 })
    expect(await l.routing.trial(l.info, 'keep', { net: 'VBUS' })).toMatchObject({ kind: 'keep' })
    const asked = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(asked.filter((r) => r.op === 'route_net')).toMatchObject([{ project: project.dir, net: 'VBUS', layers: ['F.Cu'] }])
  })

  it('asks the engine for nothing while a folder it writes in leads out of the project', async () => {
    const l = loop()
    await l.built()
    mkdirSync(join(project.root, 'elsewhere'))
    symlinkSync(join(project.root, 'elsewhere'), join(project.dir, '.pino', 'trials'))
    await expect(l.routing.trial(l.info, 'keep', { net: 'VBUS' })).rejects.toThrow(/\.pino/)
    await expect(l.routing.start(l.info)).rejects.toThrow(/\.pino/)
  })

  it('lets go of a project that is closed, and cancels its route', async () => {
    const l = loop({ FAKE_KERNEL_ROUTE_MS: '500' })
    await l.built()
    await l.routing.start(l.info)
    l.routing.drop(l.info.id)
    await l.routing.whenDone(l.info.id)
    expect(l.routing.progress(l.info.id)).toBeNull()
    expect(l.builds.latest(l.info.id)!.number).toBe(1)
  })
})

describe('the build a route’s copper is said to be from', () => {
  // One rule for the band, the card and what Claude is told: the first build that showed that copper as its own.
  it('is the build that was routed, in the state the window is told', async () => {
    const l = loop({ FAKE_KERNEL_MOVE: 'U2:1,0' })
    await l.built()
    expect(l.builds.state(l.info.id)!.copperFrom).toBeNull()
    await l.routing.start(l.info)
    await l.routing.whenDone(l.info.id)
    await l.built()
    expect(l.builds.state(l.info.id)!.copperFrom).toBe(2)
    writeFileSync(join(project.dir, 'board.py'), 'second')
    l.builds.rebuild(l.info.id)
    await l.built()
    const state = l.builds.state(l.info.id)!
    expect(state.latest!.routing!.state).toBe('stale')
    expect(state.copperFrom).toBe(2)
    expect(l.builds.routedOn(l.info.id, state.latest!.routing!.route_key!)).toBe(2)
  })
})
