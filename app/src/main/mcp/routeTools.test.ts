import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tempProject } from '../../test/fixtures'
import { toolsOver } from '../../test/mcp'
import { routedLoop } from '../../test/routing'
import { Models } from '../model'

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

async function tools(env: Record<string, string> = {}) {
  const loop = routedLoop(project, env)
  done.push(loop.dispose)
  await loop.built()
  const models = new Models()
  const mcp = await toolsOver(
    {
      project: () => loop.info,
      state: (id) => loop.builds.state(id),
      model: async (p) => {
        const drawn = loop.builds.lastGood(p.id)
        return drawn ? models.get(p, drawn) : null
      },
      routing: loop.routing
    },
    loop.info.id
  )
  return { ...mcp, loop }
}

const TRIALS: Array<[string, Record<string, unknown>]> = [
  ['route_net', { net: 'VBUS' }],
  ['nudge', { part: 'U2', by: [1, 0] }],
  ['keep', { net: 'VBUS' }]
]

describe('the route tools', () => {
  /** Every route tool refuses in these words. */
  const allSay = async (t: Awaited<ReturnType<typeof tools>>, why: string): Promise<void> => {
    for (const action of ['start', 'status', 'cancel']) expect(await t.call('route', { action })).toBe(why)
    for (const [name, args] of TRIALS) expect(await t.call(name, args)).toBe(why)
  }

  it('say the engine is too old when it speaks protocol 1', async () => {
    await allSay(await tools({ FAKE_KERNEL_SERVE: '1' }), "The engine is too old for routing: it speaks protocol 1, and routing needs 2. Update pino's engine (its kernel/ folder).")
  })

  it('say there is no built board yet in a project with no board', async () => {
    rmSync(join(project.dir, 'board.py'))
    await allSay(await tools(), 'No built board yet: routing works on a built board. Save board.py and wait for it to build.')
  })

  it('say the engine did not start, and why', async () => {
    await allSay(await tools({ FAKE_KERNEL_DIE: 'start' }), 'The engine did not start: fake kernel died at start')
  })

  it('start a route, say how far it is, and say where the copper stands when it is done', async () => {
    const t = await tools({ FAKE_KERNEL_ROUTE_MS: '60' })
    expect(await t.call('route', { action: 'status' })).toBe('h1 is not routed. Call route with start.')
    expect(await t.call('route', { action: 'start' })).toBe('Routing h1 started. It takes minutes; the view shows its progress. Call route with status to follow it.')
    expect(await t.call('route', { action: 'start' })).toMatch(/^A route is already running\. Routing in the background/)
    await expect.poll(() => t.call('route', { action: 'status' })).toMatch(/^Routing in the background: net \d+ of \d+ \([\w+]+\), step signals, \d+ s so far\.$/)
    await t.loop.routing.whenDone(t.loop.info.id)
    await t.loop.built()
    expect(await t.call('route', { action: 'status' })).toMatch(/^h2 is routed \(route r1\): every connection made, 0 DRC errors, the router did 100 % in [\d.]+ s\.$/)
  })

  it('say whether there was a route to cancel', async () => {
    const t = await tools({ FAKE_KERNEL_ROUTE_MS: '200' })
    expect(await t.call('route', { action: 'cancel' })).toBe('No route is running.')
    await t.call('route', { action: 'start' })
    expect(await t.call('route', { action: 'cancel' })).toBe('The route is cancelled.')
    await t.loop.routing.whenDone(t.loop.info.id)
    await t.loop.built()
    expect(await t.call('route', { action: 'status' })).toMatch(/^h2 is not routed\. The last route: Route r1: cancelled after [\d.]+ s\. Call route with start\.$/)
  })

  it('say that the copper no longer fits, and why', async () => {
    const t = await tools({ FAKE_KERNEL_MOVE: 'U2:1,0' })
    await t.call('route', { action: 'start' })
    await t.loop.routing.whenDone(t.loop.info.id)
    await t.loop.built()
    writeFileSync(join(project.dir, 'board.py'), 'second')
    t.loop.builds.rebuild(t.loop.info.id)
    await t.loop.built()
    expect(await t.call('route', { action: 'status' })).toBe('The copper of r1 no longer fits h3: parts moved. Call route with start.')
  })

  it('answer a trial with what it would do and the lines to write into board.py', async () => {
    const t = await tools()
    expect(await t.call('route_net', { net: 'VBUS', layers: ['F.Cu'] })).toBe(
      [
        'route_net VBUS: done',
        'before: net_complete no, unrouted_nets 3, drc_errors 0',
        'after: net_complete yes, unrouted_nets 2, drc_errors 0',
        'Write this into board.py:',
        'b.route_hint("VBUS", layers=["F.Cu"])'
      ].join('\n')
    )
    const nudged = await t.call('nudge', { part: 'U2', by: [1, 0] })
    expect(nudged).toContain('before: crossings 4, length_mm 190, score 12')
    expect(nudged.endsWith('It replaces line 91.')).toBe(true)
    expect(await t.call('keep', { net: 'VBUS' })).toContain('b.keep_route("VBUS"')
  })
})
