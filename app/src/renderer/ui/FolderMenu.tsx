import { useState } from 'react'
import type { ProjectInfo, RecentFolder } from '../../shared/project'
import { Chevron } from './Chevron'
import { nameOf } from './openFolder'
import { useMenu } from './useMenu'

/** What the menu asks for: a folder by its path, the one still to be chosen in the dialog, or the project closed. */
export type FolderChoice = { root: string } | 'pick' | 'close'

/**
 * The project crumb of the title bar (`blinky ▾`), and the menu that hangs from it: the folders opened lately (the open
 * one marked with a check and the word "current"; one that is not found struck), then the folder dialog, and the way
 * back to the first screen. The list is read when the menu opens, each time (`useMenu`: arrows, Home and End move
 * among the items; Escape and Tab put it away).
 */
export function FolderMenu({ open: current, disabled, onChoose }: { open: ProjectInfo; disabled: boolean; onChoose: (choice: FolderChoice) => void }) {
  const [recent, setRecent] = useState<RecentFolder[]>([])
  const { shown, setShown, button, menu, onKeyDown } = useMenu(recent.length)

  /** Asks for the list, then shows the menu whole: it does not come up with the dialog alone and fill in after. */
  const show = (): void => {
    void window.pino.project
      .recent()
      .catch(() => [] as RecentFolder[])
      .then((list) => {
        setRecent(list)
        setShown(true)
      })
  }

  const choose = (choice: FolderChoice): void => {
    setShown(false)
    onChoose(choice)
  }

  return (
    <div className="folder-menu-host">
      <button ref={button} type="button" className="crumb crumb-project" aria-label={`Project ${current.name}`} title={current.dir} aria-haspopup="menu" aria-expanded={shown} disabled={disabled} onClick={() => (shown ? setShown(false) : show())}>
        <span className="crumb-name">{current.name}</span>
        <Chevron />
      </button>
      {shown && (
        <div ref={menu} className="menu folder-menu" role="menu" aria-label="Projects" onKeyDown={onKeyDown}>
          {recent.length > 0 && (
            <>
              <p className="menu-title">Recent folders</p>
              {recent.map((folder) => (
                <div key={folder.root} className="folder-row" data-missing={folder.missing ? '' : undefined} data-open={folder.root === current.dir ? '' : undefined}>
                  <button type="button" role="menuitem" className="menu-item folder-item" disabled={folder.missing || folder.root === current.dir} title={folder.missing ? `${folder.root} was not found` : folder.root} onClick={() => choose({ root: folder.root })}>
                    <span className="folder-name">{nameOf(folder.root)}</span>
                    <span className="folder-path num">
                      <bdi>{folder.root}</bdi>
                    </span>
                  </button>
                  {folder.root === current.dir && (
                    <span className="folder-said">
                      <svg className="folder-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m3.5 8.5 3 3 6-7" />
                      </svg>
                      current
                    </span>
                  )}
                  {folder.missing && <span className="folder-said">Not found</span>}
                </div>
              ))}
              <hr className="menu-rule" />
            </>
          )}
          <button type="button" role="menuitem" className="menu-item" onClick={() => choose('pick')}>
            Open folder…
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => choose('close')}>
            Close project
          </button>
        </div>
      )}
    </div>
  )
}
