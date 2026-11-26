import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { which } from '../shared/keys'
import type { ProjectInfo } from '../shared/project'
import { answerLooks } from './look'
import { chatActions, connectChat } from './state/chat'
import { clampDock, DOCK_MIN, dockDefault, readDock, windowStorage, writeDock } from './state/dock'
import { actions, store, useStore } from './state/store'
import type { FolderChoice } from './ui/FolderMenu'
import { nameOf, openProblem } from './ui/openFolder'
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

/** Why a folder did not open, in one sentence: main's own already names the folder and says why. */
function why(what: string, e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return / is not a folder pino can open: /.test(message) ? message : openProblem(what, e)
}

/** Said where the person is looking: under the way in on the first screen, else in the status line. */
function say(text: string): void {
  if (store.getState().page === 'first') actions.problem(text)
  else actions.notice(text)
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
    // A press that moved nothing keeps what there was (the default stays the default of the window).
    if (d.width !== d.startWidth) keepDock(d.width)
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
  const onProject = page !== 'first' && project !== null
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

  // The project main holds open: the one remembered or named at start, and the same one after the window is reloaded.
  useEffect(() => {
    void window.pino.project.current().then(
      (open) => open && actions.openProject(open),
      (e: unknown) => say(why('The folder', e))
    )
  }, [])

  /** One opening or closing at a time. */
  const change = async (what: string, ask: () => Promise<void>): Promise<void> => {
    setBusy(true)
    actions.problem(null)
    try {
      await ask()
    } catch (e) {
      say(why(what, e))
      // The folder may have gone: the list is read again.
      await window.pino.project.recent().then(actions.setRecent, () => {})
    } finally {
      setBusy(false)
    }
  }
  /** Another project on show: the chats drawn of the one before are let go (main has ended its session). */
  const show = (opened: ProjectInfo): void => {
    if (store.getState().project?.id !== opened.id) chatActions.dropAll()
    actions.openProject(opened)
  }
  const pick = (): Promise<void> =>
    change('The folder', async () => {
      const opened = await window.pino.project.pick()
      if (opened) show(opened)
    })
  const openAt = (root: string): Promise<void> => change(nameOf(root), async () => show(await window.pino.project.open(root)))
  const close = (): Promise<void> =>
    change('The first screen', async () => {
      await window.pino.project.close()
      chatActions.dropAll()
      actions.closeProject()
    })

  if (page === 'first' || !project) {
    return (
      <>
        <Welcome busy={busy} onPick={() => void pick()} onOpen={(root) => void openAt(root)} />
        <BareControls />
      </>
    )
  }

  const choose = (choice: FolderChoice): void => void (choice === 'pick' ? pick() : choice === 'close' ? close() : openAt(choice.root))

  return (
    <div ref={shell} className="shell" style={kept === null ? undefined : ({ '--dock-w': `${kept}px` } as CSSProperties)}>
      <TitleBar project={project} disabled={busy} onChoose={choose} />
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
