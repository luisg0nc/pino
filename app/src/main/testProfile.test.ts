import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTestProfile } from './testProfile'

// Under test Electron's profile is a folder of the run in the temporary folder, never ~/.config/pino.

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A pid that was a process and is one no more. */
function deadPid(): number {
  const done = spawnSync('sh', ['-c', 'echo $$'], { encoding: 'utf8' })
  return Number(done.stdout.trim())
}

describe('the profile of a test run', () => {
  it('is a new folder of this process in the temporary folder, not under the home', () => {
    const temp = mkdtempSync(join(tmpdir(), 'pino-profiles-'))
    made.push(temp)
    const profile = makeTestProfile(temp)
    expect(profile.startsWith(join(temp, `pino-test-${process.pid}-`))).toBe(true)
    expect(existsSync(profile)).toBe(true)
    expect(profile.startsWith(join(homedir(), '.config'))).toBe(false)
    expect(makeTestProfile(temp)).not.toBe(profile)
  })

  it('clears away those of runs whose process is gone, and nothing else', () => {
    const temp = mkdtempSync(join(tmpdir(), 'pino-profiles-'))
    made.push(temp)
    const dead = join(temp, `pino-test-${deadPid()}-abc123`)
    mkdirSync(join(dead, 'Cache'), { recursive: true })
    writeFileSync(join(dead, 'Cache', 'data'), 'x')
    // A run still going (this very process stands for one), and what is no profile of pino's.
    const alive = join(temp, `pino-test-${process.ppid}-def456`)
    mkdirSync(alive)
    for (const other of ['pino-test-', 'pino-test-x-1', 'pino-e2e-quit-1', 'something']) mkdirSync(join(temp, other))
    const profile = makeTestProfile(temp)
    expect(readdirSync(temp).sort()).toEqual([profile.slice(temp.length + 1), 'something', 'pino-e2e-quit-1', 'pino-test-', `pino-test-${process.ppid}-def456`, 'pino-test-x-1'].sort())
  })
})
