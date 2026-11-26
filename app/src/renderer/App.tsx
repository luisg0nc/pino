import { useEffect, useState } from 'react'
import { actions, store, useStore } from './state/store'
import type { FolderChoice } from './ui/FolderMenu'
import { nameOf, openProblem } from './ui/openFolder'
import { BareControls, TitleBar } from './ui/TitleBar'
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
  const pick = (): Promise<void> =>
    change('The folder', async () => {
      const opened = await window.pino.project.pick()
      if (opened) actions.openProject(opened)
    })
  const openAt = (root: string): Promise<void> => change(nameOf(root), async () => actions.openProject(await window.pino.project.open(root)))
  const close = (): Promise<void> =>
    change('The first screen', async () => {
      await window.pino.project.close()
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
      <main data-region="viewport">{project.name}</main>
    </div>
  )
}
