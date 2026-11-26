import { actions, useStore } from '../state/store'
import { Chevron } from './Chevron'
import { FolderMenu, type FolderChoice } from './FolderMenu'
import { Logo } from './Logo'
import { useMenu } from './useMenu'
import { WindowControls } from './WindowControls'

/**
 * The window's title bar, across the top (a drag region; every control in it is no-drag): the logo, the workspace as a
 * crumb with its menu, on a project `/` and the project as a crumb with the menu of the workspace's projects, and at
 * the right the window controls. On the page of projects only the workspace shows.
 */
export function TitleBar({ disabled, onWorkspace, onProject, onAll, onNew }: { disabled: boolean; onWorkspace: (choice: FolderChoice) => void; onProject: (name: string) => void; onAll: () => void; onNew: () => void }) {
  const workspace = useStore((s) => s.workspace)
  const project = useStore((s) => (s.page === 'project' ? s.project : null))
  return (
    <header className="title-row" data-region="title">
      <span className="title-vise" aria-hidden="true">
        <Logo size={20} />
      </span>
      {workspace && <FolderMenu open={workspace} disabled={disabled} onChoose={onWorkspace} />}
      {project && (
        <>
          <span className="crumb-slash" aria-hidden="true">
            /
          </span>
          <ProjectMenu name={project.name} disabled={disabled} onOpen={onProject} onAll={onAll} onNew={onNew} />
        </>
      )}
      <span className="title-grow" />
      <WindowControls />
    </header>
  )
}

/** The project crumb (`blinky ▾`) and its menu: New project and All projects at its head, then the workspace's projects. */
function ProjectMenu({ name, disabled, onOpen, onAll, onNew }: { name: string; disabled: boolean; onOpen: (name: string) => void; onAll: () => void; onNew: () => void }) {
  const projects = useStore((s) => s.workspace?.projects ?? [])
  const { shown, setShown, button, menu, onKeyDown } = useMenu(projects.length)

  /** Lists the workspace again, then shows the menu whole. One that cannot be listed shows what was known. */
  const show = (): void => {
    void window.pino.workspace
      .list()
      .then(actions.setWorkspace, () => {})
      .then(() => setShown(true))
  }

  return (
    <div className="folder-menu-host">
      <button ref={button} type="button" className="crumb crumb-project" aria-label={`Project ${name}`} aria-haspopup="menu" aria-expanded={shown} disabled={disabled} onClick={() => (shown ? setShown(false) : show())}>
        <span className="crumb-name">{name}</span>
        <Chevron />
      </button>
      {shown && (
        <div ref={menu} className="menu project-menu" role="menu" aria-label="Projects" onKeyDown={onKeyDown}>
          <button
            type="button"
            role="menuitem"
            className="menu-item project-item"
            onClick={() => {
              setShown(false)
              onNew()
            }}
          >
            <span className="project-name">New project…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item project-item"
            onClick={() => {
              setShown(false)
              onAll()
            }}
          >
            <span className="project-name">All projects</span>
          </button>
          <hr className="menu-rule" />
          {projects.map((p) => (
            <button
              key={p.name}
              type="button"
              role="menuitem"
              className="menu-item project-item"
              aria-current={p.name === name ? 'true' : undefined}
              title={p.dir}
              onClick={() => {
                setShown(false)
                if (p.name !== name) onOpen(p.name)
              }}
            >
              <span className="project-name">{p.name}</span>
              {(p.name === name || p.empty) && <span className="project-said">{p.name === name ? 'current' : 'empty'}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Only the window controls, over the first screen, which has no title bar of its own. */
export function BareControls() {
  return (
    <div className="title-bare">
      <WindowControls />
    </div>
  )
}
