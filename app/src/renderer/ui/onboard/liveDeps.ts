import { actions, store } from '../../state/store'
import { onboarding } from '../../state/onboard'
import type { ProjectInfo } from '../../../shared/project'
import type { MakeDeps } from './make'

/**
 * What `makeProject` leans on, as the window has it: main's calls, the store, the draft. `onShow` puts a project main
 * has open on show, as a click on its card does.
 */
export function liveMakeDeps(onShow: (project: ProjectInfo) => void): MakeDeps {
  const root = store.getState().workspace?.root
  const show = async (project: ProjectInfo): Promise<void> => onShow(project)
  return {
    create: (req) => window.pino.project.create(req),
    // The first prompt is sent by Start, which is not on yet.
    onboard: () => Promise.reject(new Error('Start is not here yet')),
    listed: async () => {
      const info = await window.pino.workspace.list()
      actions.setWorkspace(info)
      return info.projects.map((p) => p.name)
    },
    show,
    open: async (name) => {
      const project = await window.pino.project.open(name)
      await show(project)
      return project
    },
    sameWorkspace: () => store.getState().workspace?.root === root,
    folderOf: (name) => `${root}/${name}`,
    discard: () => onboarding.discard(),
    hold: (id, held) => onboarding.hold(id, held)
  }
}
