// What the window shows, apart from the chats (`state/chat.ts`). Nothing here changes per frame.
import { useStore as useZustand } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { APP } from '../../shared/app'
import type { MarkTool } from '../board/marks/tools'
import type { SessionStatus } from '../../shared/bridge'
import type { BuildState } from '../../shared/build'
import type { FabProfile, FabState } from '../../shared/fab'
import type { Mark } from '../../shared/marks'
import type { ProjectInfo, RecentFolder } from '../../shared/project'
import { DEFAULT_LOOK, firstTab, PANE_TABS, type BoardLook, type PaneTab, type Selection } from '../../shared/view'
import type { WorkspaceInfo } from '../../shared/workspace'
import { windowStorage } from './dock'

export type { PaneTab }

/** The key the tab a project was left on is kept under, in the window's own storage. */
const TAB_KEY = `${APP.name}.tab:`

/** The tab this project was left on; null for none, or a storage that cannot be read. */
function leftOn(projectId: string): PaneTab | null {
  try {
    const kept = windowStorage()?.getItem(TAB_KEY + projectId)
    return PANE_TABS.includes(kept as PaneTab) ? (kept as PaneTab) : null
  } catch {
    return null
  }
}

function keepTab(projectId: string, tab: PaneTab): void {
  try {
    windowStorage()?.setItem(TAB_KEY + projectId, tab)
  } catch {
    // A storage that refuses: the next visit opens as a first one.
  }
}

export interface PinoState {
  /** The first screen with no workspace, the page of projects with no project open, the project, or the New project page over either. */
  page: 'first' | 'projects' | 'project' | 'new'
  /** The open folder of boards, as main last listed it. */
  workspace: WorkspaceInfo | null
  project: ProjectInfo | null
  /** The workspaces opened lately. */
  recent: RecentFolder[]
  tab: PaneTab
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
  /** The build, by its hash, whose stale copper the person chose to keep without the band that says it is stale. */
  keptStale: string | null
  /** The release of the open project, as main tells it. */
  fab: FabState | null
  /** The fab's limits for each profile the engine builds; empty until an engine with fab files says them. */
  fabProfiles: FabProfile[]
  /** The status line's "Fab files…" popover is open. */
  fabOpen: boolean
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
  /** What the first screen and the page of projects say: why a folder could not be opened. */
  problem: string | null
}

export const store: StoreApi<PinoState> = createStore<PinoState>(() => ({ page: 'first', workspace: null, project: null, recent: [], tab: 'schematic', build: null, shown: null, selection: null, look: DEFAULT_LOOK, hotFinding: null, hotBlock: null, keptStale: null, fab: null, fabProfiles: [], fabOpen: false, marks: [], tool: 'select', heldMark: null, hotMark: null, session: null, notice: null, problem: null }))

/** What of the views belongs to one project, and is not the next one's. */
const NO_VIEW = { build: null, shown: null, selection: null, look: DEFAULT_LOOK, hotFinding: null, hotBlock: null, keptStale: null, fab: null, fabOpen: false, marks: [] as Mark[], tool: 'select' as MarkTool, heldMark: null, hotMark: null }

export const actions = {
  /** A workspace is opened: its page of projects, or the New project page when it holds none. */
  openWorkspace(workspace: WorkspaceInfo): void {
    store.setState({ page: workspace.projects.length === 0 ? 'new' : 'projects', workspace, project: null, session: null, notice: null, problem: null, tab: 'schematic', ...NO_VIEW })
  },
  /** Another page of the open workspace: the project open, if any, stays open. */
  showPage(page: 'projects' | 'project' | 'new'): void {
    store.setState({ page })
  },
  /** The open workspace as listed again; another one's listing, come late, is dropped. */
  setWorkspace(workspace: WorkspaceInfo): void {
    if (store.getState().workspace?.root === workspace.root) store.setState({ workspace })
  },
  /** No workspace is open: the first screen. */
  closeWorkspace(): void {
    store.setState({ page: 'first', workspace: null, project: null, session: null, notice: null, problem: null, tab: 'schematic', ...NO_VIEW })
  },
  /** A project is on show. What was said of another one, and the view chosen in it, are not this one's. */
  openProject(project: ProjectInfo): void {
    const other = store.getState().project?.id !== project.id
    const tab = firstTab(store.getState().workspace?.projects.find((p) => p.dir === project.dir), leftOn(project.id))
    store.setState({ page: 'project', project, problem: null, ...(other ? { notice: null, session: null, tab, ...NO_VIEW } : {}) })
  },
  closeProject(): void {
    store.setState({ page: 'projects', project: null, session: null, notice: null, problem: null, tab: 'schematic', ...NO_VIEW })
  },
  setRecent(recent: RecentFolder[]): void {
    store.setState({ recent })
  },
  setTab(tab: PaneTab): void {
    const id = store.getState().project?.id
    if (id !== undefined) keepTab(id, tab)
    store.setState({ tab })
  },
  /** What main says of a build loop: heard only for the project on show. */
  setBuild(build: BuildState): void {
    if (store.getState().project?.id === build.projectId) store.setState({ build })
  },
  /** What main says of the release: heard only for the project on show. */
  setFab(fab: FabState): void {
    if (store.getState().project?.id === fab.projectId) store.setState({ fab })
  },
  setFabProfiles(fabProfiles: FabProfile[]): void {
    store.setState({ fabProfiles })
  },
  openFab(): void {
    store.setState({ fabOpen: true })
  },
  closeFab(): void {
    store.setState({ fabOpen: false, hotFinding: null })
  },
  showBuild(shown: number | null): void {
    store.setState({ shown, hotFinding: null })
  },
  /** The stale copper of this build stays on show without its band. */
  keepStale(keptStale: string): void {
    store.setState({ keptStale })
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
