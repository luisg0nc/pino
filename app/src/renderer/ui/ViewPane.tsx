import { useRef, type KeyboardEvent } from 'react'
import { pressed } from '../../shared/keys'
import { emptyWords, TAB_NAMES, tabLabel, type ViewTab } from '../../shared/view'
import { BoardView } from '../board/BoardView'
import { actions, useStore } from '../state/store'
import { useViewModel, type ViewModel } from '../state/viewModel'
import { numbered } from './numbered'
import { Plate } from './plate/Plate'
import { ViewBand } from './view/Band'

const TABS: readonly ViewTab[] = ['schematic', 'board', '3d']

/**
 * The middle of the window: the three views over one build of the board, with their tabs floating at the top left and
 * what is true of the whole view in a band at its foot. With nothing built, the view is the dye and says why. One
 * view's tab is in the tab order; Left and Right on it choose the one beside it.
 */
export function ViewPane() {
  const chosen = useStore((s) => s.tab)
  const selection = useStore((s) => s.selection)
  const { model } = useViewModel()
  const tabs = useRef<Partial<Record<ViewTab, HTMLButtonElement | null>>>({})

  const onKeyDown = (e: KeyboardEvent): void => {
    const way = pressed(e, 'view.next') ? 1 : pressed(e, 'view.prev') ? -1 : 0
    if (way === 0) return
    e.preventDefault()
    const next = TABS[(TABS.indexOf(chosen) + way + TABS.length) % TABS.length]
    actions.setTab(next)
    tabs.current[next]?.focus()
  }

  return (
    <main className="viewport views" data-region="viewport">
      <div className="views-tabs" role="tablist" aria-label="Views" onKeyDown={onKeyDown} data-tag-avoid="">
        {TABS.map((tab) => (
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
            aria-label={TAB_NAMES[tab]}
            tabIndex={tab === chosen ? 0 : -1}
            onClick={() => actions.setTab(tab)}
          >
            {TAB_NAMES[tab]}
            {/* On a tab not chosen, what is selected (`tabLabel`): switching to it is seen to keep it. */}
            {tabLabel(tab, chosen, selection) !== TAB_NAMES[tab] && selection && (
              <>
                {' · '}
                <span className="num">{selection.label}</span>
              </>
            )}
          </button>
        ))}
      </div>
      <div className="views-panel" role="tabpanel" id="view-panel" aria-labelledby={`view-tab-${chosen}`} data-view={chosen}>
        {model ? <Drawn tab={chosen} model={model} /> : <Empty />}
      </div>
      {model && <ViewBand />}
    </main>
  )
}

function Drawn({ tab, model }: { tab: ViewTab; model: ViewModel }) {
  if (tab === 'board') return <BoardView model={model} />
  return <Empty />
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
