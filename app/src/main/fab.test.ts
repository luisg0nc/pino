// The Fab holder over the engine's stand-in: availability, profiles, readiness, and a release as a job.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tempProject } from '../test/fixtures'
import { routedLoop } from '../test/routing'
import type { FabState } from '../shared/fab'
import { Fab } from './fab'
import type { KernelClient } from './kernel/client'

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

async function fabOn(env: Record<string, string> = {}) {
  const log = join(project.root, 'kernel-log.jsonl')
  const loop = routedLoop(project, { FAKE_KERNEL_SERVE: '3', FAKE_KERNEL_LOG: log, ...env })
  done.push(loop.dispose)
  const states: FabState[] = []
  const fab = new Fab({ kernel: () => loop.kernel(), builds: loop.builds, engine: () => loop.builds.state(loop.info.id)?.engine ?? { state: 'starting' }, onState: (s) => states.push(structuredClone(s)) })
  await loop.built()
  const asked = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { op: string }) : [])
  return { fab, loop, states, asked }
}

describe('the fab holder', () => {
  it('says fab files are not there on serve 2', async () => {
    const { fab, loop } = await fabOn({ FAKE_KERNEL_SERVE: '2' })
    expect(fab.available()).toBe(false)
    await expect(fab.release(loop.info)).rejects.toThrow('The engine is too old for parts and fab files: it speaks protocol 2')
    await expect(fab.readiness(loop.info)).rejects.toThrow('The engine is too old')
    expect(await fab.profiles()).toEqual([])
  })

  it('says there is no built board yet, to a release of a project with no board', async () => {
    rmSync(join(project.dir, 'board.py'))
    const { fab, loop } = await fabOn()
    const why = 'No built board yet: fab files are made from a build. Save board.py and wait for it to build.'
    await expect(fab.release(loop.info)).rejects.toThrow(why)
    await expect(fab.readiness(loop.info)).rejects.toThrow(why)
  })

  it('says the engine did not start, to a release', async () => {
    const { fab, loop } = await fabOn({ FAKE_KERNEL_DIE: 'start' })
    await expect(fab.release(loop.info)).rejects.toThrow('The engine did not start: fake kernel died at start')
    await expect(fab.readiness(loop.info)).rejects.toThrow('The engine did not start: fake kernel died at start')
  })

  it('ends an engine that never answers a parts lookup, and says so', async () => {
    rmSync(join(project.dir, 'board.py'))
    const loop = routedLoop(project)
    done.push(loop.dispose)
    let killed = 0
    const silent = { ping: () => new Promise<never>(() => {}), kill: () => void (killed += 1) } as unknown as KernelClient
    const fab = new Fab({ kernel: () => silent, builds: loop.builds, engine: () => ({ state: 'starting' }), onState: () => {}, pingTimeoutMs: 20 })
    await expect(fab.parts(loop.info, { lcsc: 'C25804' })).rejects.toThrow('The engine did not start: it did not answer within 0 s')
    expect(killed).toBe(1)
  })

  it('asks for the fab profiles once an engine', async () => {
    const { fab, asked } = await fabOn()
    expect(fab.available()).toBe(true)
    const two = await fab.profiles()
    await fab.profiles()
    expect(two.map((p) => p.name)).toEqual(['jlc-standard-2layer', 'jlc-standard-4layer'])
    expect(asked().filter((r) => r.op === 'fab_profiles')).toHaveLength(1)
    expect(fab.profileOf('jlc-standard-4layer')!.layers).toBe(4)
    expect(fab.profileOf(null)).toBeNull()
  })

  it('runs a release as a job, tells each step, keeps the result and asks readiness again', async () => {
    const { fab, loop, states, asked } = await fabOn({ FAKE_KERNEL_RELEASE_MS: '20' })
    const result = await fab.release(loop.info)
    expect(result.state).toBe('released')
    expect(result.folder).toBe('fab/v1.0.0')
    expect(existsSync(join(project.dir, 'fab', 'v1.0.0', 'README.md'))).toBe(true)
    expect(states.filter((s) => s.running).map((s) => s.step)).toEqual(expect.arrayContaining(['gates', 'parts', 'gerbers', 'write']))
    expect(fab.state(loop.info.id)).toMatchObject({ running: false, step: null, result: { state: 'released' } })
    expect(fab.state(loop.info.id).readiness).not.toBeNull()
    expect(asked().map((r) => r.op)).toContain('release_status')
  })

  it('keeps one release a project', async () => {
    const { fab, loop, asked } = await fabOn({ FAKE_KERNEL_RELEASE_MS: '60' })
    const [a, b] = await Promise.all([fab.release(loop.info), fab.release(loop.info)])
    expect(a).toEqual(b)
    expect(asked().filter((r) => r.op === 'release')).toHaveLength(1)
  })

  it('cancels a running release', async () => {
    const { fab, loop } = await fabOn({ FAKE_KERNEL_RELEASE_MS: '200' })
    const running = fab.release(loop.info)
    await expect.poll(() => fab.state(loop.info.id).step).toBe('gates')
    expect(await fab.cancel(loop.info)).toBe(true)
    expect((await running).state).toBe('cancelled')
    expect(await fab.cancel(loop.info)).toBe(false)
  })

  it('says what blocks a release, and forgets it when a build lands', async () => {
    const { fab, loop } = await fabOn({ FAKE_KERNEL_RELEASE: 'refused' })
    const readiness = await fab.readiness(loop.info)
    expect(readiness.ready).toBe(false)
    expect(readiness.blockers.map((b) => b.code)).toEqual(['release_not_routed'])
    fab.buildLanded(loop.info.id)
    expect(fab.state(loop.info.id).readiness).toBeNull()
  })

  it("keeps what went wrong when the engine can't release", async () => {
    const { fab, loop } = await fabOn({ FAKE_KERNEL_RELEASE: 'broken' })
    await expect(fab.release(loop.info)).rejects.toThrow('the release job broke')
    expect(fab.state(loop.info.id)).toMatchObject({ running: false, error: expect.stringContaining('the release job broke') })
  })

  it('answers parts through the engine', async () => {
    const { fab, loop, asked } = await fabOn()
    const result = await fab.parts(loop.info, { lcsc: 'C25804' })
    expect(result.parts[0].lcsc).toBe('C25804')
    expect(asked().find((r) => r.op === 'parts')).toMatchObject({ action: 'get', lcsc: 'C25804' })
    await fab.parts(loop.info, { search: '10k 0603', basic: true })
    expect(asked().filter((r) => r.op === 'parts').at(-1)).toMatchObject({ action: 'search', q: '10k 0603', basic: true })
  })

  it('drops a closed project', async () => {
    const { fab, loop, states } = await fabOn({ FAKE_KERNEL_RELEASE_MS: '200' })
    const running = fab.release(loop.info)
    await expect.poll(() => fab.state(loop.info.id).running).toBe(true)
    fab.drop(loop.info.id)
    const told = states.length
    await running.catch(() => {})
    expect(states).toHaveLength(told)
    expect(fab.state(loop.info.id)).toMatchObject({ running: false, result: null })
  })
})
