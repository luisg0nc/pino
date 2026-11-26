import { useEffect, useState } from 'react'
import { APP } from '../../shared/app'
import { numbered } from './numbered'
import { useReady } from './useReady'
import { Plate } from './plate/Plate'
import { PinOneDrawing } from './plate/PinOneDrawing'
import { nameOf } from './openFolder'
import { actions, useStore } from '../state/store'

/**
 * The first screen, while no folder of boards is open: the dyed plate at the left (780 of 1440), and at the right, on
 * the surface, the ways in, in two states. On a first run (no workspace opened lately): what the folder is for in a
 * sentence. Coming back: the workspaces opened lately in its place (one that is gone is struck and cannot be pressed).
 * Under either, `~/boards` and the folder dialog. The window has no frame here either, so the top 40 px is its drag
 * strip (`welcome-drag`), with the window controls over its right end.
 */
export function Welcome({ busy, onPick, onSuggested, onOpen }: { busy: boolean; onPick: () => void; onSuggested: () => void; onOpen: (root: string) => void }) {
  const recent = useStore((s) => s.recent)
  const problem = useStore((s) => s.problem)
  const [suggested, setSuggested] = useState<{ path: string; exists: boolean } | null>(null)

  // A disk that was not mounted may be there now: the list is read again whenever the window is come back to.
  useEffect(() => {
    // A list that cannot be read is none: the screen is not left at its head.
    const read = (): void => {
      void window.pino.workspace.recent().then(actions.setRecent, () => {})
      void window.pino.workspace.suggested().then(setSuggested, () => {})
    }
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [])

  const ready = useReady()
  const returning = recent.length > 0
  // The home folder is written as `~`, as the chat writes it.
  const home = window.pino.home
  const shortened = suggested === null ? '~/boards' : home && suggested.path.startsWith(`${home}/`) ? `~${suggested.path.slice(home.length)}` : suggested.path

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
          <nav className="welcome-recent" aria-label="Recent workspaces">
            <h2 className="welcome-title">Recent workspaces</h2>
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
            <h2 className="welcome-title">Choose a folder for your boards</h2>
            <p className="welcome-lead">Each board is a folder in it. Nothing is written there until you start a board.</p>
          </>
        )}
        <div className="welcome-ways">
          <button type="button" className="button button-primary" disabled={busy} onClick={onSuggested}>
            {suggested?.exists ? 'Open' : 'Use'} {shortened}
          </button>
          <button type="button" className="button" disabled={busy} onClick={onPick}>
            Choose folder…
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
          pino writes only into a <span className="num">.pino</span> folder inside each board, and makes a board&apos;s folder when you start one.
        </p>
      </div>
    </main>
  )
}
