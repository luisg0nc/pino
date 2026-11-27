import { useRef, type KeyboardEvent } from 'react'
import { pressed } from '../../shared/keys'
import { emptyWords, isViewTab, PANE_NAMES, PANE_TABS, tabLabel, type PaneTab, type ViewTab } from '../../shared/view'
import { BriefPage } from './brief/BriefPage'
import { UsagePage } from './usage/UsagePage'
import { BoardView } from '../board/BoardView'
import { SheetView } from '../sheet/SheetView'
import { ThreeView } from '../three/ThreeView'
import { actions, useStore } from '../state/store'
import { useViewModel, type ViewModel } from '../state/viewModel'
import { numbered } from './numbered'
import { Plate } from './plate/Plate'
import { ViewBand } from './view/Band'

/**
 * The middle of the window: the project's Brief, the three views over one build of its board and its Usage page, with their tabs
 * floating at the top left and what is true of a whole view in a band at its foot. With nothing built, a view is the dye
 * and says why. One tab is in the tab order; Left and Right on it choose the one beside it.
 */
export function ViewPane() {
  const chosen = useStore((s) => s.tab)
  const selection = useStore((s) => s.selection)
  const build = useStore((s) => s.build)
  const { model } = useViewModel()
  const tabs = useRef<Partial<Record<PaneTab, HTMLButtonElement | null>>>({})

  const onKeyDown = (e: KeyboardEvent): void => {
    const way = pressed(e, 'view.next') ? 1 : pressed(e, 'view.prev') ? -1 : 0
    if (way === 0) return
    e.preventDefault()
    const next = PANE_TABS[(PANE_TABS.indexOf(chosen) + way + PANE_TABS.length) % PANE_TABS.length]
    actions.setTab(next)
    tabs.current[next]?.focus()
  }

  return (
    <main className="viewport views" data-region="viewport">
      <div className="views-tabs" role="tablist" aria-label="Views" onKeyDown={onKeyDown} data-tag-avoid="">
        {PANE_TABS.map((tab) => (
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
            aria-label={PANE_NAMES[tab]}
            tabIndex={tab === chosen ? 0 : -1}
            onClick={() => actions.setTab(tab)}
          >
            {PANE_NAMES[tab]}
            {/* On a view's tab not chosen, what is selected (`tabLabel`): switching to it is seen to keep it. */}
            {tabLabel(tab, chosen, selection) !== PANE_NAMES[tab] && selection && (
              <>
                {' · '}
                <span className="num">{selection.label}</span>
              </>
            )}
          </button>
        ))}
      </div>
      <div className="views-panel" role="tabpanel" id="view-panel" aria-labelledby={`view-tab-${chosen}`} data-view={chosen}>
        {chosen === 'brief' ? <BriefPage /> : chosen === 'usage' ? <UsagePage /> : model ? <Drawn tab={chosen} model={model} /> : <Empty />}
      </div>
      {/* Which build the copper is from, as Claude is told it; else (a run begun with it stale) the build the route names. */}
      {model && isViewTab(chosen) && <ViewBand from={build?.copperFrom ?? build?.history.find((e) => e.hash !== null && e.hash === model.routedBuild)?.number} />}
    </main>
  )
}

function Drawn({ tab, model }: { tab: ViewTab; model: ViewModel }) {
  if (tab === 'board') return <BoardView model={model} />
  if (tab === 'schematic') return <SheetView model={model} />
  return <ThreeView model={model} />
}

function Empty() {
  const build = useStore((s) => s.build)
  const words = emptyWords(build)
  return (
    <Plate>
      <h2 className="views-empty-title">{numbered(words.title)}</h2>
      <p className="plate-lead selectable">
        {words.lead ? (
          numbered(words.lead)
        ) : (
          <>
            Claude writes <span className="num">board.py</span>. pino draws the schematic, the board and the 3D view here on every save.
          </>
        )}
      </p>
    </Plate>
  )
}
