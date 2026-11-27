import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { which } from '../shared/keys'
import type { ProjectInfo } from '../shared/project'
import type { WorkspaceInfo } from '../shared/workspace'
import { answerLooks } from './look'
import { chatActions, connectChat } from './state/chat'
import { cardsActions, connectCards } from './state/cards'
import { clampDock, DOCK_MIN, dockDefault, readDock, windowStorage, writeDock } from './state/dock'
import { useKeepThumb } from './state/keepThumb'
import { actions, store, useStore } from './state/store'
import { NewProject, openNewProject } from './ui/onboard/NewProject'
import { nameOf, openProblem } from './ui/openFolder'
import { ProjectsPage } from './ui/ProjectsPage'
import { RouteCard } from './ui/RouteCard'
import { LeaderLayer } from './ui/LeaderLayer'
import { SessionDock } from './ui/SessionDock'
import { StatusLine } from './ui/StatusLine'
import { BareControls, TitleBar } from './ui/TitleBar'
import { giveKeysBack } from './ui/typing'
import { ViewPane } from './ui/ViewPane'
import { Welcome } from './ui/Welcome'

const KEY_STEP = 16
/** The card's width where it cannot be measured: `--card-w` in `styles/tokens.css`. */
const CARD_DEFAULT = 296

/** Why a folder did not open, in one sentence: main's own are whole sentences, or already name the folder and say why. */
function why(what: string, e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.endsWith('.') || / is not a folder pino can open: /.test(message) ? message : openProblem(what, e)
}

/** Said where the person is looking: in the status line of a project, else on the page itself. */
function say(text: string): void {
  if (store.getState().page === 'project') actions.notice(text)
  else actions.problem(text)
}

export function App() {
  const page = useStore((s) => s.page)
  const project = useStore((s) => s.project)
  const [busy, setBusy] = useState(false)
  const shell = useRef<HTMLDivElement>(null)
  // The width the person gave the dock, kept by the window; none until they do, and then the CSS default (`--dock-w`) stands.
  const [kept, setKept] = useState<number | null>(() => readDock(windowStorage()))
  const dockWidth = kept ?? dockDefault(window.innerWidth)
  // While the edge is dragged the width goes straight to the CSS variable, so
  // React renders once at the end rather than on every pointer move.
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null)

  const leftNow = (): number => document.querySelector('.left')?.getBoundingClientRect().width ?? CARD_DEFAULT

  function onEdgeDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const startWidth = document.querySelector('.dock')?.getBoundingClientRect().width ?? dockWidth
    drag.current = { startX: e.clientX, startWidth, width: startWidth }
    shell.current!.toggleAttribute('data-resizing', true)
  }

  function onEdgeMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    d.width = clampDock(d.startWidth + d.startX - e.clientX, window.innerWidth, leftNow())
    shell.current!.style.setProperty('--dock-w', `${d.width}px`)
  }

  function onEdgeUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    drag.current = null
    shell.current!.toggleAttribute('data-resizing', false)
    // A drag that ends where it began keeps what there was. With nothing kept, the width the drag wrote comes off (React has none of
    // its own to put over it), so the default stays the default of the window.
    if (d.width !== d.startWidth) keepDock(d.width)
    else if (kept === null) shell.current!.style.removeProperty('--dock-w')
    // Dragged with the pointer, the edge is done with: the next letter is the view's, not the session pane's.
    giveKeysBack(e.currentTarget)
  }

  function onEdgeKey(e: KeyboardEvent<HTMLDivElement>) {
    const way = which(e, 'dock.resize')
    if (way < 0) return
    e.preventDefault()
    const now = document.querySelector('.dock')?.getBoundingClientRect().width ?? dockWidth
    keepDock(clampDock(now + (way === 0 ? KEY_STEP : -KEY_STEP), window.innerWidth, leftNow()))
  }

  function keepDock(width: number): void {
    setKept(width)
    writeDock(windowStorage(), width)
  }

  // A window made smaller than the dock the person kept leaves the view its room: the width shown follows, what is kept does not.
  const onProject = page === 'project' && project !== null
  useEffect(() => {
    if (kept === null || !onProject) return
    const fit = (): void => {
      const el = shell.current
      if (!el || el.hasAttribute('data-resizing')) return
      el.style.setProperty('--dock-w', `${clampDock(kept, window.innerWidth, leftNow())}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [kept, onProject])

  // What main tells of chats and has to say unasked is heard from the start, before any session is begun.
  useEffect(() => {
    const offChat = connectChat()
    const offNotices = window.pino.notices.onNotice((m) => actions.notice(m.text))
    return () => {
      offChat()
      offNotices()
    }
  }, [])

  // Claude's pictures are drawn here, when main asks.
  useEffect(() => answerLooks(), [])
  // The Brief of the project on show, as main tells it.
  useEffect(() => connectCards(), [])
  // And the picture of the open project's card, for the page of projects.
  useKeepThumb()

  // The marks of the project on show: as they stand, and every change main says.
  useEffect(() => window.pino.marks.onChange((m) => actions.setMarks(m.projectId, m.marks)), [])

  // The build loop of the project on show: what main tells from now on, and how it stands already.
  useEffect(() => window.pino.build.onState(actions.setBuild), [])
  useEffect(() => window.pino.fab.onState(actions.setFab), [])
  const projectId = project?.id
  // The fab's limits, once an engine with fab files is there: they are in the Brief from the first build.
  const makesFab = useStore((s) => s.build?.engine.state === 'ready' && s.build.engine.serve >= 3)
  useEffect(() => {
    if (!projectId || !makesFab) return
    void window.pino.fab.profiles().then(actions.setFabProfiles, () => {})
    void window.pino.fab.state(projectId).then((s) => s && actions.setFab(s), () => {})
  }, [projectId, makesFab])
  useEffect(() => {
    if (!projectId) return
    void window.pino.build.state(projectId).then((s) => s && actions.setBuild(s), () => {})
    void window.pino.marks.list(projectId).then((list) => actions.setMarks(projectId, list), () => {})
  }, [projectId])

  // What the person sees is told to main, which tells Claude with the next prompt.
  const tab = useStore((s) => s.tab)
  const look = useStore((s) => s.look)
  const selection = useStore((s) => s.selection)
  useEffect(() => {
    if (projectId) void window.pino.view.tell(projectId, { tab, look, selection }).catch(() => {})
  }, [projectId, tab, look, selection])

  // What main holds open: the workspace and project remembered or named at start, and the same after the window is reloaded.
  useEffect(() => {
    const draw = (open: Awaited<ReturnType<typeof window.pino.workspace.current>>): void => {
      if (open.workspace) actions.openWorkspace(open.workspace)
      if (open.project) actions.openProject(open.project)
    }
    void window.pino.workspace.current().then(draw, async (e: unknown) => {
      // Why the folder pino was started with did not open is said once; then what is open is asked for again.
      await window.pino.workspace.current().then(draw, () => {})
      say(why('The folder', e))
    })
  }, [])

  /** One opening or closing at a time. */
  const change = async (what: string, ask: () => Promise<void>): Promise<void> => {
    setBusy(true)
    actions.problem(null)
    try {
      // The project may be left by what is asked: a Brief on screen is marked seen while main still holds it open.
      if (store.getState().tab === 'brief') await cardsActions.leaveBrief()
      await ask()
    } catch (e) {
      say(why(what, e))
      // The folder may have gone: the list is read again.
      await window.pino.workspace.recent().then(actions.setRecent, () => {})
    } finally {
      setBusy(false)
    }
  }
  /** Another workspace on show: the chats drawn are let go (main has ended the project's session). */
  const showWorkspace = (opened: WorkspaceInfo): void => {
    chatActions.dropAll()
    actions.openWorkspace(opened)
  }
  /** Another project on show: the chats drawn of the one before are let go (main has ended its session). */
  const showProject = (opened: ProjectInfo): void => {
    if (store.getState().project?.id !== opened.id) chatActions.dropAll()
    actions.openProject(opened)
  }
  const pick = (): Promise<void> =>
    change('The folder', async () => {
      const opened = await window.pino.workspace.pick()
      if (!opened) return
      const { workspace, project: next } = opened
      // The board that is on show already: its session is still running, and its chat stays drawn.
      if (next && store.getState().project?.id === next.id) return actions.setWorkspace(workspace)
      showWorkspace(workspace)
      if (next) showProject(next)
    })
  const useSuggested = (): Promise<void> => change('The folder', async () => showWorkspace(await window.pino.workspace.useSuggested()))
  const openWorkspace = (root: string): Promise<void> => change(nameOf(root), async () => showWorkspace(await window.pino.workspace.open(root)))
  const openProject = (name: string): Promise<void> =>
    change(name, async () => {
      const next = await window.pino.project.open(name)
      // What is in the folder may have changed since the workspace was listed, and it says which tab to open on.
      await window.pino.workspace.list().then(actions.setWorkspace, () => {})
      showProject(next)
    })
  const allProjects = (): Promise<void> =>
    change('The page of projects', async () => {
      await window.pino.project.close()
      chatActions.dropAll()
      actions.closeProject()
    })
  const newProject = (): void => void openNewProject()

  if (page === 'first') {
    return (
      <>
        <Welcome busy={busy} onPick={() => void pick()} onSuggested={() => void useSuggested()} onOpen={(root) => void openWorkspace(root)} />
        <BareControls />
      </>
    )
  }

  const titleBar = (
    <TitleBar
      disabled={busy}
      onWorkspace={(choice) => void (choice === 'pick' ? pick() : openWorkspace(choice.root))}
      onProject={(name) => void openProject(name)}
      onAll={() => void allProjects()}
      onNew={newProject}
    />
  )

  if (page === 'new') {
    return (
      <div className="shell shell-projects">
        {titleBar}
        <NewProject onShow={showProject} />
      </div>
    )
  }

  if (page === 'projects' || !project) {
    return (
      <div className="shell shell-projects">
        {titleBar}
        <ProjectsPage busy={busy} onOpen={(name) => void openProject(name)} onNew={newProject} />
      </div>
    )
  }

  return (
    <div ref={shell} className="shell" style={kept === null ? undefined : ({ '--dock-w': `${kept}px` } as CSSProperties)}>
      {titleBar}
      <aside className="left" data-region="left" aria-label="Project">
        <RouteCard project={project} />
      </aside>
      <ViewPane />
      <aside className="dock" data-region="session" aria-label="Session">
        <div
          className="dock-edge"
          role="separator"
          aria-label="Resize session"
          aria-orientation="vertical"
          aria-valuenow={dockWidth}
          aria-valuemin={DOCK_MIN}
          tabIndex={0}
          onPointerDown={onEdgeDown}
          onPointerMove={onEdgeMove}
          onPointerUp={onEdgeUp}
          onPointerCancel={onEdgeUp}
          onKeyDown={onEdgeKey}
        />
        <SessionDock key={project.id} project={project} />
      </aside>
      <StatusLine project={project} />
      <LeaderLayer />
    </div>
  )
}
