import { expect, it } from 'vitest'
import { FAKE_KERNEL } from '../test/fixtures'
import { readEngine, versionCommand } from './engineInfo'

const ask = (env: Record<string, string> = {}, command = [process.execPath, FAKE_KERNEL, 'serve']) =>
  readEngine(versionCommand(command), { env: { ...process.env, ...env }, cwd: process.cwd() })

it('asks the engine the way it is served, for its version', () => {
  expect(versionCommand(['uv', 'run', 'pino-kernel', 'serve'])).toEqual(['uv', 'run', 'pino-kernel', 'version'])
  expect(versionCommand(['my-kernel'])).toEqual(['my-kernel', 'version'])
})

it("reads the engine's version and KiCad's", async () => {
  expect(await ask()).toEqual({ kernel: '0.1.1-fake', kicad: '10.0.6', problem: null })
})

it('says KiCad is not there when the engine finds none', async () => {
  expect(await ask({ FAKE_KERNEL_NO_KICAD: '1' })).toEqual({ kernel: '0.1.1-fake', kicad: null, problem: null })
})

it('says why the engine did not answer', async () => {
  expect(await ask({}, ['/nonexistent/uv', 'serve'])).toEqual({ kernel: null, kicad: null, problem: '/nonexistent/uv was not found' })
  expect((await ask({}, [process.execPath, '-e', 'console.error("no module named pino_kernel"); process.exit(1)', 'serve'])).problem).toBe('no module named pino_kernel')
})
