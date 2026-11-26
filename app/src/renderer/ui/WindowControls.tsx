import { useEffect, useState } from 'react'

/** The three window controls, which the platform gives none of: minimise, maximise or put back, close. */
export function WindowControls() {
  const [maximised, setMaximised] = useState(false)
  useEffect(() => window.pino.window.onMaximized(setMaximised), [])
  const win = window.pino.window
  return (
    <div className="window-controls">
      <button type="button" className="window-control" aria-label="Minimize" onClick={() => win.minimize()}>
        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M1 5h8" />
        </svg>
      </button>
      <button type="button" className="window-control" aria-label={maximised ? 'Restore' : 'Maximize'} onClick={() => win.toggleMaximize()}>
        {maximised ? (
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="1.5" y="3" width="5.5" height="5.5" />
            <path d="M3 3V1.5h5.5V7H7" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" />
          </svg>
        )}
      </button>
      <button type="button" className="window-control" aria-label="Close" onClick={() => win.close()}>
        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="m1.5 1.5 7 7m0-7-7 7" />
        </svg>
      </button>
    </div>
  )
}
