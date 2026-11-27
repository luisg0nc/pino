// The client against the engine's stand-in. Every process here is one this file started, and each is checked gone.

import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alive, FAKE_KERNEL, tempProject } from '../../test/fixtures'
import { KernelError, kernelCommand, kernelEnv, kernelHolder, startKernel, type KernelClient } from './client'

let project: ReturnType<typeof tempProject>
const clients: KernelClient[] = []

beforeEach(() => (project = tempProject()))
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.dispose()))
  project.remove()
})

function start(env: Record<string, string> = {}, command = [process.execPath, FAKE_KERNEL, 'serve']): KernelClient {
  const client = startKernel(command, { env: { ...process.env, ...env }, cwd: project.root })
  clients.push(client)
  return client
}

describe('the kernel client', () => {
  it('pings, builds and says serve 1 when the engine does not name it', async () => {
    const k = start()
    expect(await k.ping()).toEqual({ kernel: '0.1.1-fake', schema: 'pino.build/1', serve: 1 })
    expect((await k.build(project.dir)).number).toBe(1)
    const pid = k.pid!
    await k.dispose()
    expect(alive(pid)).toBe(false)
    expect(k.alive).toBe(false)
  })

  it('says serve 2 of an engine that routes', async () => {
    expect((await start({ FAKE_KERNEL_SERVE: '2' }).ping()).serve).toBe(2)
  })

  it('passes a project path with spaces and accents as one string', async () => {
    const odd = tempProject('my board ação')
    try {
      const log = join(odd.root, 'asked.jsonl')
      await start({ FAKE_KERNEL_LOG: log }).build(odd.dir)
      expect(JSON.parse(readFileSync(log, 'utf8').split('\n')[0]).project).toBe(odd.dir)
    } finally {
      odd.remove()
    }
  })

  it('answers a refusal as a refusal, in the engine words', async () => {
    const error = await start().build(join(project.root, 'nowhere')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(KernelError)
    expect(error).toMatchObject({ kind: 'refused', message: `no project folder at ${join(project.root, 'nowhere')}` })
  })

  it('rejects every waiting call with the last stderr line when the engine dies', async () => {
    const k = start({ FAKE_KERNEL_DIE: 'build' })
    const exits: Array<number | null> = []
    k.onExit((code) => exits.push(code))
    const waiting = [k.build(project.dir), k.build(project.dir)].map((p) => p.catch((e: KernelError) => [e.kind, e.message]))
    expect(await Promise.all(waiting)).toEqual([
      ['stopped', 'fake kernel died during a build'],
      ['stopped', 'fake kernel died during a build']
    ])
    expect(exits).toEqual([1])
    await expect(k.ping()).rejects.toThrow('fake kernel died during a build')
    expect(k.stderrTail()).toContain('fake kernel died')
  })

  it('says a command that is not there, and waits for nothing', async () => {
    const k = start({}, ['pino-no-such-engine', 'serve'])
    await expect(k.ping()).rejects.toThrow('pino-no-such-engine was not found')
    expect(k.alive).toBe(false)
  })

  it('names the dev command from the engine folder, or PINO_KERNEL_CMD', () => {
    expect(kernelCommand({}, '/r/kernel')).toEqual(['uv', 'run', '--directory', '/r/kernel', 'pino-kernel', 'serve'])
    expect(kernelCommand({ PINO_KERNEL_DIR: '/k' }, '/r/kernel')).toEqual(['uv', 'run', '--directory', '/k', 'pino-kernel', 'serve'])
    expect(kernelCommand({ PINO_KERNEL_CMD: 'node /x/fake.mjs' }, '/r/kernel', true)).toEqual(['node', '/x/fake.mjs'])
  })

  it('is frozen and without the tests dependencies when packaged', () => {
    expect(kernelCommand({}, '/res/kernel', true)).toEqual(['uv', 'run', '--frozen', '--no-dev', '--directory', '/res/kernel', 'pino-kernel', 'serve'])
  })

  it("puts the engine's environment under userData when packaged, with no bytecode, and adds nothing otherwise", () => {
    expect(kernelEnv({ packaged: true, userData: '/u/pino' })).toEqual({ UV_PROJECT_ENVIRONMENT: '/u/pino/kernel-env', PYTHONDONTWRITEBYTECODE: '1' })
    expect(isAbsolute(kernelEnv({ packaged: true, userData: 'rel/pino' }).UV_PROJECT_ENVIRONMENT)).toBe(true)
    expect(kernelEnv({ packaged: false, userData: '/u/pino' })).toEqual({})
  })

  it("relays a job's events, then its result", async () => {
    const k = start({ FAKE_KERNEL_SERVE: '2' })
    await k.build(project.dir)
    const events: Array<Record<string, unknown>> = []
    const job = k.job<{ state: string }>('route', { project: project.dir }, (e) => events.push(e))
    expect((await job.done).state).toBe('done')
    expect(events[0]).toEqual({ event: 'step', step: 'signals', index: 1, of: 1 })
    expect(events.at(-1)).toMatchObject({ event: 'step_done' })
  })

  it('cancels a job', async () => {
    const k = start({ FAKE_KERNEL_SERVE: '2', FAKE_KERNEL_ROUTE_MS: '100' })
    await k.build(project.dir)
    const job = k.job<{ state: string }>('route', { project: project.dir }, () => {})
    expect(await k.cancel(job.id)).toBe(true)
    expect((await job.done).state).toBe('cancelled')
  })

  it('answers other ops whole', async () => {
    const k = start({ FAKE_KERNEL_SERVE: '2' })
    await k.build(project.dir)
    expect(await k.request<{ status: { state: string } }>('route_status', { project: project.dir })).toMatchObject({ status: { state: 'none' } })
  })
})

describe('the one kernel of a run', () => {
  it('is started when first asked for, kept, and started anew once it has gone', async () => {
    const started: KernelClient[] = []
    const holder = kernelHolder(() => {
      const k = start()
      started.push(k)
      return k
    })
    expect(holder.current()).toBeUndefined()
    const first = holder.get()
    expect(holder.get()).toBe(first)
    await first.dispose()
    expect(holder.get()).not.toBe(first)
    expect(started).toHaveLength(2)
    const pid = holder.current()!.pid!
    await holder.dispose()
    expect(alive(pid)).toBe(false)
  })

  it('kills its process group at once when there is no time left', async () => {
    const holder = kernelHolder(() => start({ FAKE_KERNEL_DELAY_MS: '5000' }))
    const k = holder.get()
    await k.ping()
    const pid = k.pid!
    holder.kill()
    await expect.poll(() => alive(pid)).toBe(false)
  })
})
