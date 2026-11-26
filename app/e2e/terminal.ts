// The processes a spec's app started, found by the folder they run in. Linux only (`/proc`). The file keeps torno's
// name for it, though pino has no terminal view yet.
import { execFileSync } from 'node:child_process'
import { readlinkSync } from 'node:fs'

/** The working folder of a process, from `/proc`. Null when it is gone or not ours. */
export function cwdOf(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`)
  } catch {
    return null
  }
}

/** The stand-in agents running in a folder (given by its real path, which is how a process sees its cwd), by pid. */
export function agentsIn(dir: string): number[] {
  let pids: number[]
  try {
    pids = execFileSync('pgrep', ['-f', 'fake-agent.mjs'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number)
  } catch {
    return [] // pgrep exits 1 when nothing matches
  }
  return pids.filter((pid) => cwdOf(pid) === dir)
}
