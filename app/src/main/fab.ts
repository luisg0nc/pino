// Parts and fab files as main runs them: the fab's limits, whether a release would go through, one release job a
// project with its steps told to the window, and parts lookups for Claude. The engine writes fab/v<version>/ and
// nothing else outside .pino/; main only reads it.

import type { EngineState } from '../shared/build'
import { FAB_UNAVAILABLE, type FabProfile, type FabState, type PartsQuery, type PartsResult, type Readiness, type ReleaseResult } from '../shared/fab'
import type { ProjectInfo } from '../shared/project'
import { engineMayWrite, type Builds } from './builds'
import type { KernelClient } from './kernel/client'

export interface FabDeps {
  kernel: () => KernelClient
  builds: Pick<Builds, 'state'>
  engine: () => EngineState
  onState: (s: FabState) => void
}

interface Job {
  done: Promise<ReleaseResult>
  /** The engine's id for it, once it is asked. */
  asked: Promise<number | undefined>
  /** Its project was closed: nothing of it is told any more. */
  dropped: boolean
}

const idle = (projectId: string): FabState => ({ projectId, running: false, step: null, result: null, readiness: null, error: null })

export class Fab {
  private readonly states = new Map<string, FabState>()
  private readonly jobs = new Map<string, Job>()
  private known: FabProfile[] = []
  private asked: { client: KernelClient; list: Promise<FabProfile[]> } | null = null

  constructor(private readonly deps: FabDeps) {}

  /** Whether the engine that answers makes fab files: serve protocol 3. */
  available(): boolean {
    const engine = this.deps.engine()
    return engine.state === 'ready' && engine.serve >= 3
  }

  private need(): void {
    if (!this.available()) throw new Error(FAB_UNAVAILABLE)
  }

  /** The engine's fab profiles, asked once for each engine that runs. */
  profiles(): Promise<FabProfile[]> {
    if (!this.available()) return Promise.resolve([])
    const client = this.deps.kernel()
    if (this.asked?.client !== client) {
      const list = client.request<{ profiles: FabProfile[] }>('fab_profiles', {}).then((r) => (this.known = r.profiles))
      this.asked = { client, list }
      list.catch(() => {
        if (this.asked?.list === list) this.asked = null
      })
    }
    return this.asked.list
  }

  /** The profile of this name, among those the engine gave. */
  profileOf(name: string | null | undefined): FabProfile | null {
    return this.known.find((p) => p.name === name) ?? null
  }

  state(projectId: string): FabState {
    return this.states.get(projectId) ?? idle(projectId)
  }

  private patch(projectId: string, change: Partial<FabState>): void {
    const next = { ...this.state(projectId), ...change }
    this.states.set(projectId, next)
    this.deps.onState(next)
  }

  async readiness(p: ProjectInfo): Promise<Readiness> {
    this.need()
    await engineMayWrite(p.dir)
    const { status } = await this.deps.kernel().request<{ status: Readiness }>('release_status', { project: p.dir })
    this.patch(p.id, { readiness: status })
    return status
  }

  /** A release: one at a time for a project, so a second call gets the first one's result. */
  release(p: ProjectInfo, bump?: 'patch' | 'minor' | 'major'): Promise<ReleaseResult> {
    const held = this.jobs.get(p.id)
    if (held) return held.done
    try {
      this.need()
    } catch (e) {
      return Promise.reject(e as Error)
    }
    let told: (id: number | undefined) => void = () => {}
    const job: Job = { asked: new Promise((resolve) => (told = resolve)), dropped: false, done: Promise.resolve(null as never) }
    this.jobs.set(p.id, job)
    job.done = this.run(p, job, told, bump).finally(() => {
      told(undefined)
      if (this.jobs.get(p.id) === job) this.jobs.delete(p.id)
    })
    return job.done
  }

  private async run(p: ProjectInfo, job: Job, told: (id: number | undefined) => void, bump?: string): Promise<ReleaseResult> {
    try {
      await engineMayWrite(p.dir)
      if (!job.dropped) this.patch(p.id, { running: true, step: 'start', result: null, error: null })
      const started = this.deps.kernel().job<ReleaseResult>('release', { project: p.dir, options: { network: true, ...(bump ? { bump } : {}) } }, (event) => {
        if (!job.dropped && event.event === 'step' && typeof event.step === 'string') this.patch(p.id, { step: event.step })
      })
      told(started.id)
      const result = await started.done
      if (job.dropped) return result
      this.patch(p.id, { running: false, step: null, result })
      // What the next release would be has changed.
      await this.readiness(p).catch((e: Error) => console.error(`cannot ask what a release would be: ${e.message}`))
      return result
    } catch (e) {
      if (!job.dropped) this.patch(p.id, { running: false, step: null, error: (e as Error).message })
      throw e
    }
  }

  /** Cancels the running release; false when none runs. */
  async cancel(p: ProjectInfo): Promise<boolean> {
    const job = this.jobs.get(p.id)
    if (!job) return false
    const id = await job.asked
    return id !== undefined && this.deps.kernel().cancel(id)
  }

  /** One part by its LCSC number, or a search. */
  async parts(p: ProjectInfo, q: PartsQuery): Promise<PartsResult> {
    this.need()
    await engineMayWrite(p.dir)
    const asked = q.lcsc ? { action: 'get', lcsc: q.lcsc } : { action: 'search', q: q.search, package: q.package, basic: q.basic, limit: q.limit }
    return this.deps.kernel().job<PartsResult>('parts', asked, () => {}).done
  }

  /** A new build: what a release would be is asked again when someone wants to know. */
  buildLanded(projectId: string): void {
    if (this.states.get(projectId)?.readiness) this.patch(projectId, { readiness: null })
  }

  /** A closed project: its release is cancelled and no longer told of. */
  drop(projectId: string): void {
    const job = this.jobs.get(projectId)
    this.states.delete(projectId)
    if (!job) return
    job.dropped = true
    this.jobs.delete(projectId)
    void job.asked.then((id) => (id !== undefined ? this.deps.kernel().cancel(id) : false)).catch(() => {})
    job.done.catch(() => {})
  }
}
