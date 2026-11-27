import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildResult, BuildState, KeptCause } from '../shared/build'
import { fx, readJson, tempProject, FAKE_KERNEL } from '../test/fixtures'
import { Builds, readBuildHistory, watchProject, type OnChange } from './builds'
import { kernelHolder, startKernel, type KernelClient } from './kernel/client'

let project: ReturnType<typeof tempProject>
const done: Array<() => Promise<unknown> | void> = []

beforeEach(() => (project = tempProject()))
afterEach(async () => {
  for (const undo of done.splice(0).reverse()) await undo()
  project.remove()
})

const info = () => ({ id: 'p000000000001', dir: project.dir, name: 'board' })

/** The loop over the stand-in, with a watcher the test works by hand and a clock it moves. */
function loop(env: () => Record<string, string> = () => ({}), deps: Partial<ConstructorParameters<typeof Builds>[0]> = {}) {
  let tell: OnChange = () => {}
  let seen: () => void = () => {}
  let time = 1_000_000
  const asked: string[] = []
  let starts = 0
  const holder = kernelHolder(() => {
    starts += 1
    const k = startKernel([process.execPath, FAKE_KERNEL, 'serve'], { env: { ...process.env, ...env() }, cwd: project.root })
    const build = k.build.bind(k)
    k.build = (dir, opts) => {
      asked.push(dir)
      return build(dir, opts)
    }
    return k
  })
  const builds = new Builds({
    kernel: () => holder.get(),
    watch: (_dir, cb, _debounce, onSeen) => {
      tell = cb
      seen = onSeen ?? (() => {})
      return () => {}
    },
    now: () => time,
    ...deps
  })
  const states: BuildState[] = []
  const results: BuildResult[] = []
  builds.onState((s) => states.push(structuredClone(s)))
  builds.onResult((_id, r) => results.push(r))
  done.push(
    () => builds.close(info().id),
    () => holder.dispose()
  )
  return {
    builds,
    states,
    results,
    asked,
    starts: () => starts,
    save: (names = ['board.py']) => tell(names.map((n) => join(project.dir, n))),
    seen: () => seen(),
    later: (ms: number) => (time += ms),
    settled: () => builds.whenSettled(info().id, time + 60_000)
  }
}

describe('the build loop', () => {
  it('builds a project when it is opened and says what it did', async () => {
    const l = loop()
    expect(l.builds.open(info())).toMatchObject({ projectId: info().id, latest: null, building: true })
    const state = await l.settled()
    expect(state.latest!.number).toBe(1)
    expect(state.lastGood!.hash).toBe(state.latest!.hash)
    expect(state.engine).toEqual({ state: 'ready', kernel: '0.1.1-fake', serve: 1 })
    expect(state.building).toBe(false)
    expect(state.problem).toBeNull()
    expect(state.history).toMatchObject([{ number: 1, hash: state.latest!.hash, verdict: 'ok', kept: true }])
    expect(l.states.some((s) => s.building && s.history.some((e) => e.verdict === 'running'))).toBe(true)
    expect(l.builds.startedAt(info().id)).toBeDefined()
    expect(l.builds.endedAt(info().id)).toBeDefined()
  })

  it('builds nothing, and starts no engine, for a folder with no board.py yet', async () => {
    rmSync(join(project.dir, 'board.py'))
    const l = loop()
    l.builds.open(info())
    await l.settled()
    expect(l.starts()).toBe(0)
    project.touch()
    l.save()
    expect((await l.settled()).latest!.number).toBe(1)
  })

  it('three saves in one burst build once', async () => {
    const l = loop()
    l.builds.open(info())
    await l.settled()
    l.save(['board.py', 'parts.py', 'outline.json'])
    await l.settled()
    expect(l.asked).toHaveLength(2)
  })

  it('a save during a build queues exactly one more', async () => {
    const l = loop(() => ({ FAKE_KERNEL_DELAY_MS: '200' }))
    l.builds.open(info())
    await expect.poll(() => l.asked.length).toBe(1)
    l.save()
    l.save()
    expect((await l.settled()).latest!.number).toBe(2)
    expect(l.asked).toHaveLength(2)
    expect(l.results.map((r) => r.number)).toEqual([1, 2])
  })

  it('a result that lands after a newer one is not shown', async () => {
    const reference = readJson<BuildResult>(fx('result.json'))
    const numbers = [3, 2]
    const fake = {
      alive: true,
      onExit: () => () => {},
      ping: async () => ({ kernel: 'x', schema: 'pino.build/1', serve: 1 }),
      build: async () => ({ ...reference, number: numbers.shift()! })
    } as unknown as KernelClient
    let tell: OnChange = () => {}
    const builds = new Builds({ kernel: () => fake, watch: (_d, cb) => ((tell = cb), () => {}), readHistory: async () => [] })
    const results: number[] = []
    builds.onResult((_id, r) => results.push(r.number))
    builds.open(info())
    await builds.whenSettled(info().id, Date.now() + 5000)
    tell([join(project.dir, 'board.py')])
    await builds.whenSettled(info().id, Date.now() + 5000)
    expect(builds.latest(info().id)!.number).toBe(3)
    expect(results).toEqual([3])
  })

  // `uv` waiting on a lock, or a sync that hangs: the engine is there and says nothing.
  it('gives up on an engine that starts and never answers, ends it, and says why', async () => {
    let killed = 0
    const mute = { alive: true, onExit: () => () => {}, ping: () => new Promise(() => {}), kill: () => void killed++ } as unknown as KernelClient
    const builds = new Builds({ kernel: () => mute, watch: () => () => {}, readHistory: async () => [], pingTimeoutMs: 50 })
    writeFileSync(join(project.dir, 'board.py'), '')
    builds.open(info())
    const state = await builds.whenSettled(info().id, Date.now() + 5000)
    expect(state).toMatchObject({ building: false, engine: { state: 'failed', reason: 'The engine did not start: it did not answer within 0 s' } })
    expect(killed).toBe(1)
    builds.close(info().id)
  })

  it('a failed build keeps the last good one for the views', async () => {
    const l = loop(() => ({ FAKE_KERNEL_FAIL_ON: '2' }))
    l.builds.open(info())
    await l.settled()
    project.touch()
    l.save()
    const state = await l.settled()
    expect(state.latest!.verdict).toBe('failed')
    expect(state.lastGood!.number).toBe(1)
    expect(state.problem).toBe('h2 failed: invalid syntax, board.py line 12')
    expect(l.builds.lastGood(info().id)!.number).toBe(1)
    expect(state.history.map((e) => [e.number, e.verdict, e.kept])).toEqual([
      [1, 'ok', true],
      [2, 'failed', false]
    ])
  })

  it('an engine that will not start is said in plain words and tried again on the next save', async () => {
    let die = true
    const l = loop((): Record<string, string> => (die ? { FAKE_KERNEL_DIE: 'start' } : {}))
    l.builds.open(info())
    const state = await l.settled()
    expect(state.engine).toEqual({ state: 'failed', reason: 'The engine did not start: fake kernel died at start' })
    expect(state.problem).toBe('The engine did not start: fake kernel died at start')
    expect(state.building).toBe(false)
    die = false
    l.later(10_001)
    l.save()
    const again = await l.settled()
    expect(again.engine.state).toBe('ready')
    expect(again.latest!.number).toBe(1)
    expect(again.problem).toBeNull()
    expect(l.starts()).toBe(2)
  })

  it('starts the engine again at most once in ten seconds, and then builds what was saved meanwhile', async () => {
    const l = loop(() => ({ FAKE_KERNEL_DIE: 'start' }))
    l.builds.open(info())
    await l.settled()
    l.later(2000)
    l.save()
    l.save()
    await l.settled()
    expect(l.starts()).toBe(1)
  })

  it('says an engine that stops in the middle of a build', async () => {
    const l = loop(() => ({ FAKE_KERNEL_DIE: 'build' }))
    l.builds.open(info())
    const state = await l.settled()
    expect(state.engine).toEqual({ state: 'failed', reason: 'The engine stopped: fake kernel died during a build' })
  })

  it('asks no engine to write through a .pino that is a link', async () => {
    const outside = join(project.root, 'elsewhere')
    mkdirSync(outside)
    symlinkSync(outside, join(project.dir, '.pino'))
    const l = loop()
    l.builds.open(info())
    const state = await l.settled()
    expect(l.asked).toEqual([])
    expect(state.problem).toContain('is a link')
  })

  it('asks no engine to write through a build folder that is a link', async () => {
    mkdirSync(join(project.dir, '.pino'))
    symlinkSync(project.root, join(project.dir, '.pino', 'build'))
    const l = loop()
    l.builds.open(info())
    expect((await l.settled()).problem).toContain('is a link')
    expect(l.asked).toEqual([])
  })

  it('says nothing more of a project once it is closed', async () => {
    const l = loop(() => ({ FAKE_KERNEL_DELAY_MS: '200' }))
    l.builds.open(info())
    await expect.poll(() => l.asked.length).toBe(1)
    const said = l.states.length
    l.builds.close(info().id)
    await new Promise((r) => setTimeout(r, 400))
    expect(l.states).toHaveLength(said)
    expect(l.results).toEqual([])
    expect(l.builds.state(info().id)).toBeUndefined()
  })

  it('waits no longer than it is told for a build to settle', async () => {
    const l = loop(() => ({ FAKE_KERNEL_DELAY_MS: '2000' }))
    l.builds.open(info())
    expect((await l.builds.whenSettled(info().id, 1_000_000 + 50)).building).toBe(true)
  })

  it('counts a save seen but not settled as one to wait for', async () => {
    const l = loop()
    l.builds.open(info())
    await l.settled()
    expect(l.builds.pending(info().id)).toBe(false)
    l.seen()
    expect(l.builds.pending(info().id)).toBe(true)
    let settled: BuildState | null = null
    const waiting = l.builds.whenSettled(info().id, 1_000_000 + 60_000).then((s) => (settled = s))
    await new Promise((r) => setTimeout(r, 50))
    expect(settled).toBeNull()
    l.save()
    await waiting
    expect(settled!.latest!.number).toBe(2)
    expect(l.builds.pending(info().id)).toBe(false)
  })

  it('builds again when asked to', async () => {
    const l = loop()
    l.builds.open(info())
    await l.settled()
    l.builds.rebuild(info().id)
    expect((await l.settled()).latest!.number).toBe(2)
  })
})

describe('the build a route was made on', () => {
  it('is the first one seen with that route current', async () => {
    const reference = readJson<BuildResult>(fx('result.json'))
    const states = ['current', 'current', 'stale']
    let number = 4
    const fake = {
      alive: true,
      onExit: () => () => {},
      ping: async () => ({ kernel: 'x', schema: 'pino.build/1', serve: 2 }),
      build: async () => ({ ...reference, number: ++number, routing: { state: states.shift(), route_key: 'cccccccc00000001' } })
    } as unknown as KernelClient
    const builds = new Builds({ kernel: () => fake, watch: () => () => {}, readHistory: async () => [] })
    builds.open(info())
    await builds.whenSettled(info().id, Date.now() + 5000)
    for (let i = 0; i < 2; i++) {
      builds.rebuild(info().id)
      await builds.whenSettled(info().id, Date.now() + 5000)
    }
    expect(builds.routedOn(info().id, 'cccccccc00000001')).toBe(5)
    expect(builds.routedOn(info().id, 'cccccccc00000002')).toBeUndefined()
  })
})

describe('the history', () => {
  it('reads the history and marks pruned builds as not kept', async () => {
    const pino = join(project.dir, '.pino')
    mkdirSync(join(pino, 'build', 'aaaaaaaa0002'), { recursive: true })
    writeFileSync(join(pino, 'build', 'aaaaaaaa0002', 'result.json'), '{}')
    writeFileSync(
      join(pino, 'builds.json'),
      JSON.stringify({ schema: 'pino.builds/1', builds: [
        { number: 1, hash: 'aaaaaaaa0001', verdict: 'ok', at: 't1' },
        { number: 2, hash: 'aaaaaaaa0002', verdict: 'errors', at: 't2' },
        { number: 'x' },
        { number: 3, hash: '../../x', verdict: 'ok', at: 't3' }
      ] })
    )
    expect(await readBuildHistory(project.dir)).toEqual([
      { number: 1, hash: 'aaaaaaaa0001', verdict: 'ok', at: 't1', kept: false },
      { number: 2, hash: 'aaaaaaaa0002', verdict: 'errors', at: 't2', kept: true },
      { number: 3, hash: null, verdict: 'ok', at: 't3', kept: false }
    ])
  })

  it('is empty when there is none, or the file is not one', async () => {
    expect(await readBuildHistory(project.dir)).toEqual([])
    mkdirSync(join(project.dir, '.pino'))
    writeFileSync(join(project.dir, '.pino', 'builds.json'), '{nope')
    expect(await readBuildHistory(project.dir)).toEqual([])
  })
})

describe('the watch', () => {
  it('tells once of a burst, and only of Python and the outline outside the ignored folders', async () => {
    const heard: string[][] = []
    mkdirSync(join(project.dir, 'parts'))
    for (const folder of ['.pino', '__pycache__', 'fab', 'reference', 'node_modules', '.venv']) mkdirSync(join(project.dir, folder))
    const stop = watchProject(project.dir, (paths) => heard.push(paths.map((p) => p.slice(project.dir.length + 1)).sort()), 100)
    done.push(stop)
    await new Promise((r) => setTimeout(r, 300)) // the watch is set up
    for (const name of ['board.py', 'parts/usb.py', 'outline.json', 'notes.md', 'brief.md', '.pino/x.py', '__pycache__/a.py', 'fab/b.py', 'reference/c.py', '.hidden.py', 'node_modules/d.py']) {
      writeFileSync(join(project.dir, name), 'x\n')
    }
    await expect.poll(() => heard.length, { timeout: 3000 }).toBe(1)
    await new Promise((r) => setTimeout(r, 250))
    expect(heard).toEqual([['board.py', 'outline.json', 'parts/usb.py']])
  })

  it('says a save at once, before the burst has settled', async () => {
    const order: string[] = []
    done.push(watchProject(project.dir, () => order.push('settled'), 150, () => order.push('seen')))
    await new Promise((r) => setTimeout(r, 300))
    project.touch('b = 3\n')
    await expect.poll(() => order.includes('settled'), { timeout: 3000 }).toBe(true)
    expect(order[0]).toBe('seen')
  })

  it('watches a project whose own folder is named like an ignored one', async () => {
    const odd = tempProject('reference')
    done.push(() => odd.remove())
    const heard: string[][] = []
    done.push(watchProject(odd.dir, (paths) => heard.push(paths), 50))
    await new Promise((r) => setTimeout(r, 300))
    odd.touch('b = 2\n')
    await expect.poll(() => heard.length, { timeout: 3000 }).toBe(1)
  })
})

describe('what made each build', () => {
  const agent: KeptCause = { cause: 'agent', turn: { prompt: 'u7', conversation: 'c1' } }
  /** The causes as the window is told them, by build number. */
  const told = (s: BuildState) => s.history.map((e) => [e.number, e.cause, e.turn])
  const written = () => {
    const files: Array<Map<number, KeptCause>> = []
    return { files, writeCauses: async (_dir: string, causes: ReadonlyMap<number, KeptCause>) => void files.push(new Map(causes)) }
  }

  it('says a save during a turn came from the agent, with the turn', async () => {
    const w = written()
    let now: KeptCause = { cause: 'person' }
    const l = loop(() => ({}), { causeNow: () => now, writeCauses: w.writeCauses, readCauses: async () => new Map() })
    l.builds.open(info())
    await l.settled()
    now = agent
    l.seen()
    l.save()
    const state = await l.settled()
    expect(told(state)).toEqual([[1, 'unknown', undefined], [2, 'agent', agent.turn]])
    expect(w.files.at(-1)).toEqual(new Map([[1, { cause: 'unknown' }], [2, agent]]))
  })

  it('says a save between turns came from the person, and has no turn on it', async () => {
    const l = loop(() => ({}), { causeNow: () => ({ cause: 'person' }), writeCauses: written().writeCauses, readCauses: async () => new Map() })
    l.builds.open(info())
    await l.settled()
    l.seen()
    l.save()
    const state = await l.settled()
    expect(state.history[1]).toMatchObject({ number: 2, cause: 'person' })
    expect('turn' in state.history[1]).toBe(false)
  })

  it('does not know what made the opening build, or a Rebuild', async () => {
    const l = loop(() => ({}), { causeNow: () => agent, writeCauses: written().writeCauses, readCauses: async () => new Map() })
    l.builds.open(info())
    await l.settled()
    l.builds.rebuild(info().id)
    const state = await l.settled()
    expect(told(state)).toEqual([[1, 'unknown', undefined], [2, 'unknown', undefined]])
  })

  it('stamps the build a route asked for with the route cause', async () => {
    const l = loop(() => ({}), { writeCauses: written().writeCauses, readCauses: async () => new Map() })
    l.builds.open(info())
    await l.settled()
    l.builds.rebuild(info().id, { cause: 'route' })
    expect(told(await l.settled())[1]).toEqual([2, 'route', undefined])
  })

  it('tells the running build its cause while it runs', async () => {
    const l = loop(() => ({ FAKE_KERNEL_DELAY_MS: '100' }), { causeNow: () => agent, writeCauses: written().writeCauses, readCauses: async () => new Map() })
    l.builds.open(info())
    await l.settled()
    l.seen()
    l.save()
    await l.settled()
    const running = l.states.flatMap((s) => s.history.filter((e) => e.verdict === 'running'))
    expect(running.map((e) => [e.number, e.cause, e.turn])).toEqual([[1, 'unknown', undefined], [2, 'agent', agent.turn]])
  })

  it('lets the highest cause win, whole, when several fold into one build', async () => {
    const causes: KeptCause[] = [{ cause: 'person' }, agent, { cause: 'person' }]
    const l = loop(() => ({ FAKE_KERNEL_DELAY_MS: '150' }), { causeNow: () => causes.shift() ?? { cause: 'person' }, writeCauses: written().writeCauses, readCauses: async () => new Map() })
    l.builds.open(info())
    await expect.poll(() => l.asked.length).toBe(1)
    // While the first build runs: a person's save, then Claude's, then a person's again, all for the next one.
    l.seen()
    l.seen()
    l.seen()
    l.save()
    expect(told(await l.settled())[1]).toEqual([2, 'agent', agent.turn])
    // A route beats a person's save, and an agent beats a route.
    l.builds.rebuild(info().id)
    await expect.poll(() => l.asked.length).toBe(3)
    l.seen()
    l.builds.rebuild(info().id, { cause: 'route' })
    l.save()
    expect(told(await l.settled())[3]).toEqual([4, 'route', undefined])
  })

  it('puts a save heard while a build runs on the next build, not the running one', async () => {
    const l = loop(() => ({ FAKE_KERNEL_DELAY_MS: '200' }), { causeNow: () => agent, writeCauses: written().writeCauses, readCauses: async () => new Map() })
    l.builds.open(info())
    await expect.poll(() => l.asked.length).toBe(1)
    l.seen()
    l.save()
    const state = await l.settled()
    expect(told(state)).toEqual([[1, 'unknown', undefined], [2, 'agent', agent.turn]])
  })

  it('puts a save heard before the engine is asked, while the build starts, on the next build', async () => {
    // The causes on file are read before the engine is asked: held here, that is the moment an engine's first ping takes.
    let release: () => void = () => {}
    const held = new Promise<Map<number, KeptCause>>((resolve) => (release = () => resolve(new Map())))
    const l = loop(() => ({}), { causeNow: () => ({ cause: 'person' }), writeCauses: written().writeCauses, readCauses: () => held })
    l.builds.open(info())
    l.seen()
    l.save()
    release()
    await expect.poll(() => l.asked.length).toBe(2)
    expect(told(await l.settled())).toEqual([[1, 'unknown', undefined], [2, 'person', undefined]])
  })

  it('keeps a burst that has not settled off the build that starts', async () => {
    let release: () => void = () => {}
    const held = new Promise<Map<number, KeptCause>>((resolve) => (release = () => resolve(new Map())))
    const l = loop(() => ({}), { causeNow: () => agent, writeCauses: written().writeCauses, readCauses: () => held })
    l.builds.open(info())
    l.seen()
    release()
    await expect.poll(() => l.asked.length).toBe(1)
    l.save()
    expect(told(await l.settled())).toEqual([[1, 'unknown', undefined], [2, 'agent', agent.turn]])
  })

  it('forgets what wanted a build that a folder with no board.py did not make', async () => {
    rmSync(join(project.dir, 'board.py'))
    let now: KeptCause = agent
    const l = loop(() => ({}), { causeNow: () => now, writeCauses: written().writeCauses, readCauses: async () => new Map() })
    l.builds.open(info())
    await l.settled()
    // Claude saves another Python file in a turn: nothing is built.
    l.seen()
    l.save(['calc.py'])
    await l.settled()
    expect(l.starts()).toBe(0)
    // Later the person writes board.py: its build is theirs, not that turn's.
    now = { cause: 'person' }
    project.touch()
    l.seen()
    l.save()
    expect(told(await l.settled())).toEqual([[1, 'person', undefined]])
  })

  it('tells the causes it had on file for the builds the engine lists, and none for the others', async () => {
    const l = loop(() => ({}), {
      readCauses: async () => new Map<number, KeptCause>([[1, { cause: 'person' }], [5, agent]]),
      writeCauses: written().writeCauses
    })
    mkdirSync(join(project.dir, '.pino'), { recursive: true })
    writeFileSync(join(project.dir, '.pino', 'builds.json'), JSON.stringify({ schema: 'pino.builds/1', builds: [{ number: 1, hash: null, verdict: 'ok', at: 't' }, { number: 2, hash: null, verdict: 'ok', at: 't' }] }))
    l.builds.open(info())
    const state = await l.settled()
    expect(told(state)).toEqual([[1, 'person', undefined], [2, undefined, undefined], [3, 'unknown', undefined]])
    expect('cause' in state.history[1] || 'turn' in state.history[1]).toBe(false)
  })

  it('keeps the causes in a file that a fresh loop reads back', async () => {
    const first = loop(() => ({}), { causeNow: () => agent })
    first.builds.open(info())
    await first.settled()
    first.seen()
    first.save()
    await first.settled()
    await expect.poll(() => existsSync(join(project.dir, '.pino', 'build-causes.json'))).toBe(true)
    await expect.poll(() => readJson<{ builds: unknown[] }>(join(project.dir, '.pino', 'build-causes.json')).builds.length).toBe(2)
    first.builds.close(info().id)
    const again = loop()
    again.builds.open(info())
    const state = await again.settled()
    expect(told(state)).toEqual([[1, 'unknown', undefined], [2, 'agent', agent.turn], [3, 'unknown', undefined]])
  })

  it('does not hold up a build for a write that fails', async () => {
    const l = loop(() => ({}), { writeCauses: () => Promise.reject(new Error('disk full')), readCauses: async () => new Map() })
    l.builds.open(info())
    expect((await l.settled()).latest!.number).toBe(1)
  })
})
