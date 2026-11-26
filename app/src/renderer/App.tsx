import { useEffect, useState } from 'react'
import type { ProjectInfo } from '../shared/project'
import { chatActions, connectChat } from './state/chat'
import { actions, store, useStore } from './state/store'
import type { FolderChoice } from './ui/FolderMenu'
import { nameOf, openProblem } from './ui/openFolder'
import { RouteCard } from './ui/RouteCard'
import { LeaderLayer } from './ui/LeaderLayer'
import { SessionDock } from './ui/SessionDock'
import { StatusLine } from './ui/StatusLine'
import { BareControls, TitleBar } from './ui/TitleBar'
import { ViewPane } from './ui/ViewPane'
import { Welcome } from './ui/Welcome'

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

  // What main tells of chats and has to say unasked is heard from the start, before any session is begun.
  useEffect(() => {
    const offChat = connectChat()
    const offNotices = window.pino.notices.onNotice((m) => actions.notice(m.text))
    return () => {
      offChat()
      offNotices()
    }
  }, [])

  // The build loop of the project on show: what main tells from now on, and how it stands already.
  useEffect(() => window.pino.build.onState(actions.setBuild), [])
  const projectId = project?.id
  useEffect(() => {
    if (projectId) void window.pino.build.state(projectId).then((s) => s && actions.setBuild(s), () => {})
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
    <div className="shell">
      <TitleBar project={project} disabled={busy} onChoose={choose} />
      <aside className="left" data-region="left" aria-label="Project">
        <RouteCard project={project} />
      </aside>
      <ViewPane />
      <aside className="dock" data-region="session" aria-label="Session">
        <SessionDock key={project.id} project={project} />
      </aside>
      <StatusLine project={project} />
      <LeaderLayer />
    </div>
  )
}
