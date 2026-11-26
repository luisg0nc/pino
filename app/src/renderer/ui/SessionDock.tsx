import type { ProjectInfo } from '../../shared/project'
import { useStore } from '../state/store'
import { sessionWord } from './sessionWords'

/** The session dock at the right: Claude Code working on the open project. */
export function SessionDock({ project }: { project: ProjectInfo }) {
  const status = useStore((s) => s.session?.status)
  return (
    <>
      <header className="panel-head session-head">
        <h2 className="panel-title">Claude Code</h2>
        <span className="session-state">
          <span className="session-status" role="status" data-status={status}>
            <span className="status-dot" />
            {sessionWord(status)}
          </span>
        </span>
      </header>
      <div className="session-body" data-project={project.id} />
    </>
  )
}
