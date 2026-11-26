import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { pressed } from '../../../shared/keys'
import type { ViewName } from '../../../shared/view'

// The still cube of the compass: an iso picture whose faces are buttons for the standard views, with a corner for Iso and
// "···" for the three views behind it.

/** The three faces seen from the corner, with where they are in the picture (100 × 100). */
const FACES = [
  { view: 'top', label: 'Top', points: '50,8 90,30 50,52 10,30', at: [50, 31] },
  { view: 'front', label: 'Front', points: '10,30 50,52 50,94 10,72', at: [30, 66] },
  { view: 'right', label: 'Right', points: '90,30 50,52 50,94 90,72', at: [70, 66] }
] as const satisfies readonly { view: ViewName; label: string; points: string; at: readonly [number, number] }[]

/** The views behind the dots. */
export const MORE_VIEWS: readonly { view: ViewName; label: string }[] = [
  { view: 'back', label: 'Back' },
  { view: 'left', label: 'Left' },
  { view: 'bottom', label: 'Bottom' }
]

/**
 * Where a face's button stands over the picture (100 × 100): the box of its polygon, cut to the polygon, so that a press lands on
 * the face and the middle of the button is on it.
 */
function buttonBox(points: string): CSSProperties {
  const corners = points.split(' ').map((p) => p.split(',').map(Number) as [number, number])
  const x0 = Math.min(...corners.map((c) => c[0]))
  const y0 = Math.min(...corners.map((c) => c[1]))
  const w = Math.max(...corners.map((c) => c[0])) - x0
  const h = Math.max(...corners.map((c) => c[1])) - y0
  const clip = corners.map(([x, y]) => `${((x - x0) / w) * 100}% ${((y - y0) / h) * 100}%`).join(', ')
  return { left: `${x0}%`, top: `${y0}%`, width: `${w}%`, height: `${h}%`, clipPath: `polygon(${clip})` }
}

/**
 * The cube: a face is a real button with its view's name, so the cube is reached by keys as any button is. `on` is the
 * standard view on screen, which has the accent wash and `data-on`.
 */
export function ViewCube({ on, go }: { on: ViewName | null; go: (view: ViewName) => void }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const more = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moreOpen) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? pressed(e, 'menu.close') : !more.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [moreOpen])

  return (
    <>
      <div className="cube-picture">
        {/* What is seen: the faces and what is written on them. The buttons over it are what is pressed. */}
        <svg viewBox="0 0 100 100" aria-hidden="true">
          {FACES.map(({ view, label, points, at }) => (
            <g key={view} className="cube-face-drawn" data-on={on === view ? '' : undefined}>
              <polygon className="face" points={points} />
              <text x={at[0]} y={at[1] + 3}>
                {label}
              </text>
            </g>
          ))}
          <circle className="corner" cx="50" cy="52" r="5" />
        </svg>
        {FACES.map(({ view, label, points }) => (
          <button
            key={view}
            type="button"
            className="cube-face"
            style={buttonBox(points)}
            aria-label={`${label} view`}
            aria-current={on === view ? 'true' : undefined}
            title={`${label} view`}
            data-view={view}
            data-on={on === view ? '' : undefined}
            onClick={() => go(view)}
          />
        ))}
        <button type="button" className="cube-corner" aria-label="Iso view" title="Iso view" data-view="iso" onClick={() => go('iso')} />
      </div>
      <div className="cube-more" ref={more}>
        <button type="button" className="cube-dots" aria-label="More views" title="Back, left and bottom" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
          <span aria-hidden="true">···</span>
        </button>
        {moreOpen && (
          <div className="menu cube-menu" role="menu">
            {MORE_VIEWS.map((v) => (
              <button
                key={v.view}
                type="button"
                role="menuitem"
                className="menu-item"
                data-view={v.view}
                aria-current={v.view === on ? 'true' : undefined}
                onClick={() => {
                  go(v.view)
                  setMoreOpen(false)
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
