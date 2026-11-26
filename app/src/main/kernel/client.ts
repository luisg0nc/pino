// pino's side of `pino-kernel serve`: JSON lines on the child's pipes (kernel/README.md). The shape is torno's
// KernelClient; the protocol is pino's own. The child leads a process group of its own, so that `uv` and the Python
// under it go together.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { envName } from '../../shared/app'
import { buildResultOf, isRecord, type BuildResult } from '../../shared/build'
import { withoutSession } from '../sessions/agentEnv'

const STDERR_KEPT = 4000
const SHUTDOWN_GRACE_MS = 2000
const TERM_GRACE_MS = 2000

/** The command that runs the engine: PINO_KERNEL_CMD split on spaces, else uv on the kernel beside the app. */
export function kernelCommand(env: NodeJS.ProcessEnv, appPath: string): string[] {
  const said = env[envName('KERNEL_CMD')]?.trim()
  if (said) return said.split(/\s+/)
  return ['uv', 'run', '--directory', env[envName('KERNEL_DIR')] ?? resolve(appPath, '..', 'kernel'), 'pino-kernel', 'serve']
}

/** `refused`: the engine answered that it cannot. `stopped`: it exited, or never started. */
export class KernelError extends Error {
  constructor(
    message: string,
    readonly kind: 'refused' | 'stopped'
  ) {
    super(message)
    this.name = 'KernelError'
  }
}

export interface Pong {
  kernel: string
  schema: string
  /** The protocol: 2 routes. 1 when the engine does not say. */
  serve: number
}

export interface KernelJob<T> {
  id: number
  done: Promise<T>
}

export interface KernelClient {
  readonly pid: number | undefined
  /** It has not exited. */
  readonly alive: boolean
  ping(): Promise<Pong>
  build(project: string, opts?: { timeout?: number }): Promise<BuildResult>
  /** Any other op: what the engine answered, without `id` and `ok`. */
  request<T = unknown>(op: string, args: Record<string, unknown>): Promise<T>
  /** An op that streams events before its result. */
  job<T = unknown>(op: string, args: Record<string, unknown>, onEvent: (e: Record<string, unknown>) => void): KernelJob<T>
  cancel(jobId: number): Promise<boolean>
  onExit(cb: (code: number | null) => void): () => void
  /** The end of what the engine wrote to stderr. */
  stderrTail(): string
  dispose(): Promise<void>
  /** Ends the whole process group at once, for a quit that cannot wait. */
  kill(): void
}

interface Waiting {
  answer: (reply: Record<string, unknown>) => void
  fail: (error: KernelError) => void
  event?: (e: Record<string, unknown>) => void
}

export function startKernel(command: string[], opts: { env: NodeJS.ProcessEnv; cwd: string }): KernelClient {
  let stderr = ''
  let ids = 0
  /** Why nothing more will be answered, once the child has gone. */
  let gone: KernelError | undefined
  const waiting = new Map<number, Waiting>()
  const exitListeners = new Set<(code: number | null) => void>()

  const env = withoutSession(opts.env as Record<string, string | undefined>)
  const child: ChildProcessWithoutNullStreams = spawn(command[0], command.slice(1), { cwd: opts.cwd, env, detached: true, stdio: 'pipe' })

  const lastLine = (): string => stderr.trim().split('\n').at(-1)?.trim() ?? ''
  let exited: () => void = () => {}
  const closed = new Promise<void>((done) => (exited = done))

  const ended = (code: number | null, why: string): void => {
    if (gone) return
    gone = new KernelError(why, 'stopped')
    for (const one of waiting.values()) one.fail(gone)
    waiting.clear()
    for (const cb of [...exitListeners]) cb(code)
    exited()
  }

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (text: string) => (stderr = (stderr + text).slice(-STDERR_KEPT)))
  // A write to a child that has gone is heard of by its exit.
  child.stdin.on('error', () => {})
  createInterface({ input: child.stdout }).on('line', (line) => {
    let reply: unknown
    try {
      reply = JSON.parse(line)
    } catch {
      console.error(`the engine said a line that is not JSON: ${line.slice(0, 200)}`)
      return
    }
    if (!isRecord(reply) || typeof reply.id !== 'number') return
    const one = waiting.get(reply.id)
    if (!one) return
    if (isRecord(reply.event)) {
      one.event?.(reply.event)
      return
    }
    waiting.delete(reply.id)
    if (reply.ok === true) one.answer(reply)
    else one.fail(new KernelError(typeof reply.error === 'string' ? reply.error : 'the engine refused without saying why', 'refused'))
  })
  child.on('error', (e: NodeJS.ErrnoException) => {
    // Only a start that failed comes here with no process: anything else is heard of by the exit.
    if (child.pid === undefined) ended(null, e.code === 'ENOENT' ? `${command[0]} was not found` : e.message)
  })
  // `close`, not `exit`: by then everything it said, its last words included, has been read.
  child.on('close', (code, signal) => ended(code, lastLine() || (signal ? `it was ended by ${signal}` : `it exited with ${code}`)))

  const send = <T>(message: Record<string, unknown>, take: (reply: Record<string, unknown>) => T, event?: Waiting['event']): KernelJob<T> => {
    const id = ++ids
    const done = new Promise<T>((resolve, reject) => {
      if (gone) {
        reject(gone)
        return
      }
      waiting.set(id, {
        answer: (reply) => {
          try {
            resolve(take(reply))
          } catch (e) {
            reject(e)
          }
        },
        fail: reject,
        ...(event ? { event } : {})
      })
      child.stdin.write(`${JSON.stringify({ id, ...message })}\n`)
    })
    return { id, done }
  }

  const body = <T>(reply: Record<string, unknown>): T => {
    const { id: _id, ok: _ok, ...rest } = reply
    return rest as T
  }

  /** Signals the group: the child and whatever it started. */
  const signal = (name: NodeJS.Signals): void => {
    if (child.pid === undefined) return
    try {
      process.kill(-child.pid, name)
    } catch {
      // The group has gone.
    }
  }

  const within = (ms: number): Promise<boolean> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms)
      void closed.then(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })

  return {
    get pid() {
      return child.pid
    },
    get alive() {
      return gone === undefined
    },
    ping: () =>
      send({ op: 'ping' }, (reply) => {
        const pong = isRecord(reply.pong) ? reply.pong : {}
        return { kernel: String(pong.kernel ?? ''), schema: String(pong.schema ?? ''), serve: typeof pong.serve === 'number' ? pong.serve : 1 }
      }).done,
    build: (project, options) =>
      send({ op: 'build', project, ...(options?.timeout ? { options: { timeout: options.timeout } } : {}) }, (reply) => {
        const result = buildResultOf(reply.result)
        if (!result) throw new KernelError('the engine answered with something that is not a build result', 'refused')
        return result
      }).done,
    request: <T>(op: string, args: Record<string, unknown>) => send({ ...args, op }, (reply) => body<T>(reply)).done,
    job: <T>(op: string, args: Record<string, unknown>, onEvent: (e: Record<string, unknown>) => void) => send({ ...args, op }, (reply) => reply.result as T, onEvent),
    cancel: (jobId) => send({ op: 'route_cancel', job: jobId }, (reply) => reply.cancelled === true).done,
    onExit(cb) {
      exitListeners.add(cb)
      return () => exitListeners.delete(cb)
    },
    stderrTail: () => stderr,
    async dispose() {
      if (gone) return
      send({ op: 'shutdown' }, () => null).done.catch(() => {})
      child.stdin.end()
      if (await within(SHUTDOWN_GRACE_MS)) return
      signal('SIGTERM')
      if (await within(TERM_GRACE_MS)) return
      signal('SIGKILL')
      await within(TERM_GRACE_MS)
    },
    kill() {
      if (!gone) signal('SIGKILL')
    }
  }
}

/** The one engine of a run: started when first asked for, and started anew when the one before has gone. */
export interface KernelHolder {
  get(): KernelClient
  /** The one there is, when one is running. */
  current(): KernelClient | undefined
  dispose(): Promise<void>
  kill(): void
}

export function kernelHolder(start: () => KernelClient): KernelHolder {
  let client: KernelClient | undefined
  const current = () => (client?.alive ? client : undefined)
  return {
    get: () => current() ?? (client = start()),
    current,
    dispose: async () => current()?.dispose(),
    kill: () => current()?.kill()
  }
}
