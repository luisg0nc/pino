// Routing as main runs it: one route job a project, its progress told in the build state, and a build when it ends, so
// that the build's own `routing` is the one truth of where the copper stands. The trial tools go through here too.

import { isRecord, type RouteProgress, type RoutingState } from '../shared/build'
import { ENGINE_STARTING } from '../shared/fab'
import type { ProjectInfo } from '../shared/project'
import { engineMayWrite, type Builds } from './builds'
import type { KernelClient } from './kernel/client'

// Why routing is refused, in words that say what is missing: Claude reads them and acts on them.
export const routingTooOld = (serve: number): string => `The engine is too old for routing: it speaks protocol ${serve}, and routing needs 2. Update pino's engine (its kernel/ folder).`
export const NO_BOARD_TO_ROUTE = 'No built board yet: routing works on a built board. Save board.py and wait for it to build.'

export interface Started {
  job: number
  /** The number of the build being routed. */
  build: number
  /** A route was running already: this is that one. */
  already: boolean
}

interface Job {
  started: Promise<Started>
  done: Promise<void>
  finish: () => void
  /** The engine's id for it, once it is asked. */
  id?: number
  /** Its project was closed: nothing of it is told any more. */
  dropped: boolean
  progress: RouteProgress | null
}

const number = (v: unknown, otherwise: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : otherwise)

/** The progress after one of the engine's events; null for an event that says nothing of it (a log line). */
function after(was: RouteProgress, event: Record<string, unknown>): RouteProgress | null {
  const step = typeof event.step === 'string' ? event.step : was.step
  if (event.event === 'step') return { job: was.job, startedAt: was.startedAt, step, index: 0, of: 0 }
  if (event.event === 'net') return { job: was.job, startedAt: was.startedAt, step, index: number(event.index, was.index), of: number(event.of, was.of), ...(typeof event.net === 'string' ? { net: event.net } : {}) }
  if (event.event === 'step_done') return { ...was, step, ...(typeof event.routed === 'number' ? { routed: event.routed } : {}) }
  return null
}

export class Routing {
  private readonly jobs = new Map<string, Job>()
  private readonly words = new Map<string, string>()
  private readonly now: () => number

  constructor(private readonly deps: { kernel: () => KernelClient; builds: Builds; now?: () => number }) {
    this.now = deps.now ?? Date.now
  }

  /**
   * Why the project cannot be routed or tried, or null when it can: routing is of a built board, by the build loop's
   * engine, which routes from protocol 2.
   */
  refusal(projectId: string): string | null {
    const state = this.deps.builds.state(projectId)
    const engine = state?.engine
    if (engine?.state === 'failed') return engine.reason
    if (engine?.state === 'ready' && engine.serve < 2) return routingTooOld(engine.serve)
    if (!state?.latest) return NO_BOARD_TO_ROUTE
    return engine?.state === 'ready' ? null : ENGINE_STARTING
  }

  private need(p: ProjectInfo): void {
    const why = this.refusal(p.id)
    if (why) throw new Error(why)
  }

  start(p: ProjectInfo): Promise<Started> {
    const held = this.jobs.get(p.id)
    if (held) return held.started.then((s) => ({ ...s, already: true }))
    let finish: () => void = () => {}
    const done = new Promise<void>((resolve) => (finish = resolve))
    const job = { done, finish, dropped: false, progress: null } as unknown as Job
    // Held before anything is waited for, so that a second start finds this one.
    this.jobs.set(p.id, job)
    job.started = this.begin(p, job)
    job.started.catch(() => this.end(p.id, job))
    return job.started
  }

  private async begin(p: ProjectInfo, job: Job): Promise<Started> {
    this.need(p)
    await engineMayWrite(p.dir)
    const drawn = this.deps.builds.lastGood(p.id)
    if (!drawn) throw new Error(NO_BOARD_TO_ROUTE)
    const startedAt = this.now()
    const asked = this.deps.kernel().job<unknown>('route', { project: p.dir }, (event) => {
      if (job.dropped || !job.progress) return
      const next = after(job.progress, event)
      if (!next) return
      job.progress = next
      this.deps.builds.patch(p.id, { route: next })
    })
    job.id = asked.id
    job.progress = { job: asked.id, step: 'start', index: 0, of: 0, startedAt }
    this.words.delete(p.id)
    this.deps.builds.patch(p.id, { route: job.progress })
    void asked.done
      .then(
        (result) => (isRecord(result) && typeof result.headline === 'string' ? result.headline : 'The route ended.'),
        (e: Error) => `Routing stopped: ${e.message}`
      )
      .then((words) => {
        if (job.dropped) return this.end(p.id, job)
        this.words.set(p.id, words)
        this.end(p.id, job)
        this.deps.builds.patch(p.id, { route: null })
        // The engine answers this one from its cache: the build then says where the copper stands.
        this.deps.builds.rebuild(p.id)
      })
    return { job: asked.id, build: drawn.number, already: false }
  }

  private end(projectId: string, job: Job): void {
    if (this.jobs.get(projectId) === job) this.jobs.delete(projectId)
    job.finish()
  }

  /** Cancels the running route; false when none runs. */
  async cancel(p: ProjectInfo): Promise<boolean> {
    const job = this.jobs.get(p.id)
    if (!job) return false
    await job.started
    return job.id !== undefined && this.deps.kernel().cancel(job.id)
  }

  /** Where the copper stands on the newest board, as the engine's build says it. */
  async status(p: ProjectInfo): Promise<RoutingState | null> {
    this.need(p)
    return this.deps.builds.latest(p.id)?.routing ?? null
  }

  progress(projectId: string): RouteProgress | null {
    return this.jobs.get(projectId)?.progress ?? null
  }

  /** The engine's headline for the last route that ended in this run. */
  lastWords(projectId: string): string | null {
    return this.words.get(projectId) ?? null
  }

  /** When the running route, if any, has ended. */
  whenDone(projectId: string): Promise<void> {
    return this.jobs.get(projectId)?.done ?? Promise.resolve()
  }

  /** A project that is closed: its route is cancelled and no longer told of. */
  drop(projectId: string): void {
    this.words.delete(projectId)
    const job = this.jobs.get(projectId)
    if (!job) return
    job.dropped = true
    void job.started.then(() => (job.id !== undefined ? this.deps.kernel().cancel(job.id) : false)).catch(() => {})
  }

  /** `route_net`, `nudge` and `keep`: each tries something and answers a pino.trial/1; nothing of the project changes. */
  async trial(p: ProjectInfo, op: 'route_net' | 'nudge' | 'keep', args: Record<string, unknown>): Promise<unknown> {
    this.need(p)
    await engineMayWrite(p.dir)
    const asked = { ...args, project: p.dir }
    const kernel = this.deps.kernel()
    // What routes is a job of the engine's, which streams; the rest answers in its turn.
    if (op === 'route_net' || (op === 'nudge' && args.route === true)) return kernel.job(op, asked, () => {}).done
    return (await kernel.request<{ result: unknown }>(op, asked)).result
  }
}
