// Only under test (`?test=1`, which main sets with PINO_TEST=1): where the views say what they drew and where on
// screen a thing is, for the e2e specs. Each view that is mounted registers itself.

import type { Target } from '../../shared/board/refs'
import { isViewTab, type ViewTab } from '../../shared/view'
import { store } from './store'

export interface ViewHooks {
  /** Client pixels of the target's centre in this view, or null when it is not on it. */
  screenOf(target: Target): { x: number; y: number } | null
  /** What this view drew last. */
  drawn(): unknown
}

export const underTest = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('test') === '1'

/** The key each view's account stands under in `drawn()`. */
const DRAWN_AS: Record<ViewTab, string> = { schematic: 'sheet', board: 'board', '3d': 'three' }
const views = new Map<ViewTab, ViewHooks>()

export function registerView(tab: ViewTab, hooks: ViewHooks): () => void {
  views.set(tab, hooks)
  return () => {
    if (views.get(tab) === hooks) views.delete(tab)
  }
}

if (underTest && window.__pinoTest) {
  Object.assign(window.__pinoTest, {
    screenOf: (target: Target) => {
      const { tab } = store.getState()
      return !isViewTab(tab) ? null :(views.get(tab)?.screenOf(target) ?? null)
    },
    drawn: () => Object.fromEntries([...views].map(([tab, hooks]) => [DRAWN_AS[tab], hooks.drawn()]))
  })
}
