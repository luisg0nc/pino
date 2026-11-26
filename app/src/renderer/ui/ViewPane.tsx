import { useRef, type KeyboardEvent } from 'react'
import { pressed } from '../../shared/keys'
import { actions, useStore, type ViewTab } from '../state/store'
import { Plate } from './plate/Plate'

const TABS: ReadonlyArray<{ tab: ViewTab; label: string }> = [
  { tab: 'schematic', label: 'Schematic' },
  { tab: 'board', label: 'Board' },
  { tab: '3d', label: '3D' }
]

/**
 * The middle of the window: the three views over one build of the board. Nothing is built yet, so each is an empty view
 * on the dye. One view's tab is in the tab order; Left and Right on it choose the one beside it.
 */
export function ViewPane() {
  const chosen = useStore((s) => s.tab)
  const tabs = useRef<Partial<Record<ViewTab, HTMLButtonElement | null>>>({})

  const onKeyDown = (e: KeyboardEvent): void => {
    const way = pressed(e, 'view.next') ? 1 : pressed(e, 'view.prev') ? -1 : 0
    if (way === 0) return
    e.preventDefault()
    const at = TABS.findIndex((t) => t.tab === chosen)
    const next = TABS[(at + way + TABS.length) % TABS.length].tab
    actions.setTab(next)
    tabs.current[next]?.focus()
  }

  return (
    <main className="viewport views" data-region="viewport">
      <div className="views-tabs" role="tablist" aria-label="Views" onKeyDown={onKeyDown}>
        {TABS.map(({ tab, label }) => (
          <button
            key={tab}
            ref={(el) => {
              tabs.current[tab] = el
            }}
            type="button"
            role="tab"
            id={`view-tab-${tab}`}
            className="views-tab"
            aria-selected={tab === chosen}
            aria-controls="view-panel"
            tabIndex={tab === chosen ? 0 : -1}
            onClick={() => actions.setTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="views-panel" role="tabpanel" id="view-panel" aria-labelledby={`view-tab-${chosen}`} data-view={chosen}>
        <Plate>
          <h2 className="views-empty-title">Nothing to draw yet.</h2>
          <p className="plate-lead">
            Claude writes <span className="num">board.py</span>. pino draws the schematic, the board and the 3D view here on every save.
          </p>
        </Plate>
      </div>
    </main>
  )
}
