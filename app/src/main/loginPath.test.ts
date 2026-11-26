import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { applyLoginPath, mergedPath, pathBetweenMarkers, shellPath } from './loginPath'

const home = '/srv/me'

describe('mergedPath', () => {
  it('puts the shell first, then the rest of the current PATH, then the fallbacks that exist', () => {
    const exists = (dir: string): boolean => dir === '/usr/local/bin' || dir === `${home}/.local/bin`
    expect(mergedPath('/a:/b', '/b:/usr/bin', home, exists)).toBe(`/a:/b:/usr/bin:${home}/.local/bin:/usr/local/bin`)
  })
  it('has no entry twice and none empty or relative', () => {
    expect(mergedPath('/a::rel:/a', ':/c:bin', home, () => false)).toBe('/a:/c')
  })
  it('without a shell takes the current PATH and the fallbacks', () => {
    expect(mergedPath(null, '/usr/bin:/bin', home, () => true)).toBe(`/usr/bin:/bin:${home}/.local/bin:/usr/local/bin:${home}/.claude/local`)
  })
})

describe('pathBetweenMarkers', () => {
  it('ignores what the rc files print', () => {
    expect(pathBetweenMarkers('hello\n__PINO_PATH__/x:/y__PINO_PATH__\n')).toBe('/x:/y')
    expect(pathBetweenMarkers('noise')).toBeNull()
    expect(pathBetweenMarkers('__PINO_PATH__/x')).toBeNull()
  })
})

function shellScript(body: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'pino-shell-')), 'sh')
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}

describe('shellPath', () => {
  it('reads the PATH after the noise', async () => {
    const shell = shellScript('echo "welcome from rc"; printf "\\n__PINO_PATH__/q:/r__PINO_PATH__\\n"')
    expect(await shellPath(shell)).toBe('/q:/r')
  })
  it('kills a shell that hangs', async () => {
    const shell = shellScript('exec sleep 30')
    const t = Date.now()
    expect(await shellPath(shell, 300)).toBeNull()
    expect(Date.now() - t).toBeLessThan(5000)
  })
  it('gives null for a shell that does not exist', async () => {
    expect(await shellPath('/no/such/shell')).toBeNull()
  })
})

describe('applyLoginPath', () => {
  const login = (): NodeJS.ProcessEnv => ({ PATH: '/usr/bin', SHELL: shellScript('printf "__PINO_PATH__/z__PINO_PATH__"') })
  it('does nothing under test', async () => {
    const env: NodeJS.ProcessEnv = { ...login(), PINO_TEST: '1' }
    await applyLoginPath(env)
    expect(env.PATH).toBe('/usr/bin')
  })
  it("sets the PATH to the login shell's", async () => {
    const env = login()
    await applyLoginPath(env)
    expect(env.PATH!.startsWith('/z:/usr/bin')).toBe(true)
  })
  it('on failure keeps the current PATH, says so without the shell output, and still adds fallbacks', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const shell = shellScript('echo secret-output; exit 1')
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', SHELL: shell }
    await applyLoginPath(env)
    expect(env.PATH!.startsWith('/usr/bin')).toBe(true)
    expect(err).toHaveBeenCalledOnce()
    expect(String(err.mock.calls[0][0])).toContain(shell)
    expect(String(err.mock.calls[0][0])).not.toContain('secret-output')
    err.mockRestore()
  })
})
