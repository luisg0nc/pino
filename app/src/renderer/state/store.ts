// What the window shows, apart from the chats (`state/chat.ts`). Nothing here changes per frame.
import { useStore as useZustand } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { MarkTool } from '../board/marks/tools'
import type { SessionStatus } from '../../shared/bridge'
import type { BuildState } from '../../shared/build'
import type { Mark } from '../../shared/marks'
import type { ProjectInfo, RecentFolder } from '../../shared/project'
import { DEFAULT_LOOK, type BoardLook, type Selection, type ViewTab } from '../../shared/view'

export type { ViewTab }

export interface PinoState {
  page: 'first' | 'project'
  project: ProjectInfo | null
  recent: RecentFolder[]
  tab: ViewTab
  /** The build loop of the open project, as main last told it. */
  build: BuildState | null
  /** The number of an older build chosen in the strip, which the views then show; null shows the latest. */
  shown: number | null
  /** What is in hand in the views, the same thing in all three. */
  selection: Selection | null
  /** How the Board tab draws. */
  look: BoardLook
  /** The finding pointed at, by its place in the shown build's findings: its pin lights and its tag is tied to it. */
  hotFinding: number | null
  /** The block pointed at in the route card, by its key: its frame lights on the sheet. */
  hotBlock: string | null
  /** The project's marks, as main holds them. */
  marks: Mark[]
  /** The marking tool in hand. */
  tool: MarkTool
  /** The mark in hand: its row, its chip and its shape are lit. */
  heldMark: string | null
  /** The mark pointed at, from its chip or its row. */
  hotMark: string | null
  /** The session the dock shows, running or just ended; null when the project has had none since it was opened. */
  session: { sessionId: string; status: SessionStatus } | null
  /** What the status line says once of the open project: a folder pino may not write into, a folder that did not open. */
  notice: string | null
  /** What the first screen says under its way in: why a folder could not be opened. */
  problem: string | null
}

export const store: StoreApi<PinoState> = createStore<PinoState>(() => ({ page: 'first', project: null, recent: [], tab: 'schematic', build: null, shown: null, selection: null, look: DEFAULT_LOOK, hotFinding: null, hotBlock: null, marks: [], tool: 'select', heldMark: null, hotMark: null, session: null, notice: null, problem: null }))

/** What of the views belongs to one project, and is not the next one's. */
const NO_VIEW = { build: null, shown: null, selection: null, look: DEFAULT_LOOK, hotFinding: null, hotBlock: null, marks: [] as Mark[], tool: 'select' as MarkTool, heldMark: null, hotMark: null }

export const actions = {
  /** A project is on show. What was said of another one, and the view chosen in it, are not this one's. */
  openProject(project: ProjectInfo): void {
    const other = store.getState().project?.id !== project.id
    store.setState({ page: 'project', project, problem: null, ...(other ? { notice: null, session: null, tab: 'schematic' as const, ...NO_VIEW } : {}) })
  },
  closeProject(): void {
    store.setState({ page: 'first', project: null, session: null, notice: null, problem: null, tab: 'schematic', ...NO_VIEW })
  },
  setRecent(recent: RecentFolder[]): void {
    store.setState({ recent })
  },
  setTab(tab: ViewTab): void {
    store.setState({ tab })
  },
  /** What main says of a build loop: heard only for the project on show. */
  setBuild(build: BuildState): void {
    if (store.getState().project?.id === build.projectId) store.setState({ build })
  },
  showBuild(shown: number | null): void {
    store.setState({ shown, hotFinding: null })
  },
  select(selection: Selection | null): void {
    // What is selected and a mark in hand are one hand: taking one puts the other down.
    store.setState({ selection, ...(selection ? { heldMark: null } : {}) })
  },
  /** What main says of the marks: heard only for the project on show. */
  setMarks(projectId: string, marks: Mark[]): void {
    if (store.getState().project?.id !== projectId) return
    const held = store.getState().heldMark
    store.setState({ marks, ...(held && !marks.some((m) => m.id === held) ? { heldMark: null } : {}) })
  },
  setTool(tool: MarkTool): void {
    store.setState({ tool })
  },
  holdMark(heldMark: string | null): void {
    store.setState({ heldMark, ...(heldMark ? { selection: null } : {}) })
  },
  hoverMark(hotMark: string | null): void {
    store.setState({ hotMark })
  },
  setLook(patch: Partial<BoardLook>): void {
    store.setState({ look: { ...store.getState().look, ...patch } })
  },
  hoverBlock(hotBlock: string | null): void {
    store.setState({ hotBlock })
  },
  hoverFinding(hotFinding: number | null): void {
    store.setState({ hotFinding })
  },
  setSession(session: PinoState['session']): void {
    store.setState({ session })
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
  window.__pinoTest = { state: () => store.getState(), screenOf: () => null, drawn: () => ({}) }
}
