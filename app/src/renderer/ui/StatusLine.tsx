import type { ProjectInfo } from '../../shared/project'
import { useStore } from '../state/store'
import { sessionWord } from './sessionWords'

/** The foot of the window: the project's folder, how its build stands, what there is to say once, and its session. */
export function StatusLine({ project }: { project: ProjectInfo }) {
  const session = useStore((s) => s.session)
  const notice = useStore((s) => s.notice)
  return (
    <footer className="status" data-region="status">
      <span className="status-name num" title={project.dir}>
        {project.name}
      </span>
      <span className="status-build">No build yet</span>
      {/* There before anything is said, so that what is said later is announced. */}
      <span className="status-notice" role="status" title={notice ?? undefined}>
        {notice}
      </span>
      <span className="status-session" data-status={session?.status}>
        {sessionWord(session?.status)}
      </span>
    </footer>
  )
}
