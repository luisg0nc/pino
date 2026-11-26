// What the window shows, apart from the chats (`state/chat.ts`). Nothing here changes per frame.
import { useStore as useZustand } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { ProjectInfo, RecentFolder } from '../../shared/project'

/** The three views over one build of a board. */
export type ViewTab = 'schematic' | 'board' | '3d'

export interface PinoState {
  page: 'first' | 'project'
  project: ProjectInfo | null
  recent: RecentFolder[]
  tab: ViewTab
  /** What the status line says once of the open project: a folder pino may not write into, a folder that did not open. */
  notice: string | null
  /** What the first screen says under its way in: why a folder could not be opened. */
  problem: string | null
}

export const store: StoreApi<PinoState> = createStore<PinoState>(() => ({ page: 'first', project: null, recent: [], tab: 'schematic', notice: null, problem: null }))

export const actions = {
  /** A project is on show. What was said of another one, and the view chosen in it, are not this one's. */
  openProject(project: ProjectInfo): void {
    const other = store.getState().project?.id !== project.id
    store.setState({ page: 'project', project, problem: null, ...(other ? { notice: null, tab: 'schematic' as const } : {}) })
  },
  closeProject(): void {
    store.setState({ page: 'first', project: null, notice: null, problem: null, tab: 'schematic' })
  },
  setRecent(recent: RecentFolder[]): void {
    store.setState({ recent })
  },
  setTab(tab: ViewTab): void {
    store.setState({ tab })
  },
  notice(text: string | null): void {
    store.setState({ notice: text })
  },
  problem(text: string | null): void {
    store.setState({ problem: text })
  }
}

export function useStore<T>(pick: (s: PinoState) => T): T {
  return useZustand(store, pick)
}

// Only under test (`?test=1`, which main sets with PINO_TEST=1): what the e2e specs read.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('test') === '1') {
  window.__pinoTest = { state: () => store.getState() }
}
