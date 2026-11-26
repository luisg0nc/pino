// Routing as main runs it, over the engine's stand-in: one job a project, its progress told, a build when it ends.

import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { referenceModel } from '../test/marks'
import { tempProject } from '../test/fixtures'
import { routedLoop } from '../test/routing'
import { ROUTING_UNAVAILABLE } from './routing'

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
  it('is not there with an engine that speaks protocol 1', async () => {
    const l = loop({ FAKE_KERNEL_SERVE: '1' })
    await l.built()
    expect(l.routing.available(l.info.id)).toBe(false)
    await expect(l.routing.start(l.info)).rejects.toThrow(ROUTING_UNAVAILABLE)
    await expect(l.routing.trial(l.info, 'keep', { net: 'VBUS' })).rejects.toThrow(ROUTING_UNAVAILABLE)
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
