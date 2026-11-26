import { useEffect, useState } from 'react'
import { APP } from '../../shared/app'
import { readyLines, type ReadyLine } from '../../shared/ready'
import { numbered } from './numbered'
import { Plate } from './plate/Plate'
import { PinOneDrawing } from './plate/PinOneDrawing'
import { nameOf } from './openFolder'
import { actions, useStore } from '../state/store'

/**
 * The first screen, while no folder is open: the dyed plate at the left (780 of 1440), and at the right, on the surface,
 * the way in, in two states. On a first run (no folder opened lately): the folder idea in a sentence and the folder
 * dialog (an empty folder is fine). Coming back: the folders opened lately first (one that is gone is struck and cannot
 * be pressed), then the same way in. The window has no frame here either, so the top 40 px is its drag strip
 * (`welcome-drag`), with the window controls over its right end.
 */
export function Welcome({ busy, onPick, onOpen }: { busy: boolean; onPick: () => void; onOpen: (root: string) => void }) {
  const recent = useStore((s) => s.recent)
  const problem = useStore((s) => s.problem)

  // A disk that was not mounted may be there now: the list is read again whenever the window is come back to.
  useEffect(() => {
    // A list that cannot be read is none: the screen is not left at its head.
    const read = (): void => void window.pino.project.recent().then(actions.setRecent, () => {})
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [])

  const [ready, setReady] = useState<ReadyLine[] | null>(null)
  useEffect(() => {
    let here = true
    void window.pino.build.engineInfo().then(
      (info) => here && setReady(readyLines(info)),
      () => {}
    )
    return () => {
      here = false
    }
  }, [])

  const returning = recent.length > 0

  return (
    <main className="welcome-page" data-region="viewport">
      <div className="welcome-drag" aria-hidden="true" />
      <Plate>
        <PinOneDrawing />
        <h1 className="plate-headline">{APP.name}</h1>
        <p className="plate-lead">
          <strong>Make circuit boards with an AI agent.</strong> It writes the board in Python; you point at what to change.
        </p>
      </Plate>
      <div className="welcome-side">
        {returning ? (
          <nav className="welcome-recent" aria-label="Recent folders">
            <h2 className="welcome-title">Recent folders</h2>
            <ul>
              {recent.map((folder) => (
                <li key={folder.root} data-missing={folder.missing ? '' : undefined}>
                  <button type="button" className="recent-row" disabled={busy || folder.missing} title={folder.missing ? `${folder.root} was not found` : folder.root} onClick={() => onOpen(folder.root)}>
                    <span className="recent-name">{nameOf(folder.root)}</span>
                    <span className="recent-path num">
                      <bdi>{folder.root}</bdi>
                    </span>
                  </button>
                  {folder.missing && (
                    <span className="recent-gone-side">
                      <span className="recent-gone">Not found</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ) : (
          <>
            <h2 className="welcome-title">Open a folder to work in</h2>
            <p className="welcome-lead">A project is one folder with a board in it. An empty folder is fine.</p>
          </>
        )}
        <div className="welcome-ways">
          <button type="button" className="button button-primary" disabled={busy} onClick={onPick}>
            Open folder
          </button>
        </div>
        <ul className="welcome-ready" aria-label="What pino needs">
          {ready === null ? (
            <li>Looking for Claude Code and KiCad.</li>
          ) : (
            ready.map((line) => (
              <li key={line.text} data-ok={line.ok}>
                {numbered(line.text)}
              </li>
            ))
          )}
        </ul>
        {problem !== null && (
          <p className="welcome-problem" role="alert">
            {problem}
          </p>
        )}
        <p className="welcome-foot">
          pino itself writes only into a <span className="num">.pino</span> folder inside the project.
        </p>
      </div>
    </main>
  )
}
