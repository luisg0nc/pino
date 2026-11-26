// What the engine says of itself, asked once a run for the first screen: `pino-kernel version`.

import { execFile } from 'node:child_process'
import { isRecord } from '../shared/build'
import type { EngineInfo } from '../shared/ready'
import { withoutSession } from './sessions/agentEnv'

/** The first run of an engine under uv makes its environment, which takes a while. */
const TIMEOUT_MS = 120_000
const MOST_REASON = 200

/** The command that asks the engine its version: the one that serves it, with `version` in the place of `serve`. */
export const versionCommand = (command: readonly string[]): string[] => [...(command.at(-1) === 'serve' ? command.slice(0, -1) : command), 'version']

export function readEngine(command: readonly string[], opts: { env: NodeJS.ProcessEnv; cwd: string }): Promise<Omit<EngineInfo, 'claude'>> {
  const failed = (problem: string) => ({ kernel: null, kicad: null, problem: problem.slice(0, MOST_REASON) })
  return new Promise((done) => {
    const env = withoutSession(opts.env as Record<string, string | undefined>)
    execFile(command[0], command.slice(1), { env, cwd: opts.cwd, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code
        return done(failed(code === 'ENOENT' ? `${command[0]} was not found` : (stderr.trim().split('\n').at(-1) ?? error.message)))
      }
      try {
        const said: unknown = JSON.parse(stdout)
        if (!isRecord(said) || typeof said.kernel !== 'string') return done(failed('it did not answer with its version'))
        const kicad = typeof said.kicad_cli === 'string' && isRecord(said.libraries) ? said.kicad_cli : null
        done({ kernel: said.kernel, kicad, problem: null })
      } catch {
        done(failed('it did not answer with its version'))
      }
    })
  })
}
