import type { ProjectInfo } from '../../shared/project'
import { FolderMenu, type FolderChoice } from './FolderMenu'
import { Logo } from './Logo'
import { WindowControls } from './WindowControls'

/**
 * The window's title bar, across the top (a drag region; every control in it is no-drag): the logo, the project as a
 * crumb with its menu, and at the right the window controls.
 */
export function TitleBar({ project, disabled, onChoose }: { project: ProjectInfo; disabled: boolean; onChoose: (choice: FolderChoice) => void }) {
  return (
    <header className="title-row" data-region="title">
      <span className="title-vise" aria-hidden="true">
        <Logo />
      </span>
      <FolderMenu open={project} disabled={disabled} onChoose={onChoose} />
      <span className="title-grow" />
      <WindowControls />
    </header>
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
