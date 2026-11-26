// The build loop and routing over the engine's stand-in, for the tests of routing and of Claude's route tools.

import type { BuildState } from '../shared/build'
import { Builds } from '../main/builds'
import { kernelHolder, startKernel } from '../main/kernel/client'
import { Routing } from '../main/routing'
import { FAKE_KERNEL, type tempProject } from './fixtures'

export function routedLoop(project: ReturnType<typeof tempProject>, env: Record<string, string> = {}) {
  const info = { id: 'p000000000001', dir: project.dir, name: 'board' }
  const holder = kernelHolder(() => startKernel([process.execPath, FAKE_KERNEL, 'serve'], { env: { ...process.env, FAKE_KERNEL_SERVE: '2', ...env }, cwd: project.root }))
  // No watcher: a test says when a build is wanted.
  const builds = new Builds({ kernel: () => holder.get(), watch: () => () => {} })
  const states: BuildState[] = []
  builds.onState((s) => states.push(structuredClone(s)))
  const routing = new Routing({ kernel: () => holder.get(), builds })
  builds.open(info)
  return {
    info,
    builds,
    routing,
    states,
    built: () => builds.whenSettled(info.id, Date.now() + 10_000),
    async dispose() {
      builds.close(info.id)
      await holder.dispose()
    }
  }
}
