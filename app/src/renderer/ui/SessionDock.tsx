import { useEffect, useRef, useState } from 'react'
import type { SessionStatus, StartResult } from '../../shared/bridge'
import type { ProjectInfo } from '../../shared/project'
import { chatActions, useChat } from '../state/chat'
import { onboarding } from '../state/onboard'
import { actions, store, useStore } from '../state/store'
import { ChatPane } from './chat/ChatPane'
import { ModelButton } from './chat/ModelMenu'
import { StartChat } from './chat/StartChat'
import { Popover } from './Popover'
import { QuestionCard } from './QuestionCard'
import { sessionWord } from './sessionWords'
import { useMenu } from './useMenu'

/** What an IPC call failed with, without Electron's wrapping. */
const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** The question a start was refused with, and what was asked for, to do it again once the person has answered. */
interface Asked {
  files: string[]
  resume: boolean
  /** Which asking this is: each takes the focus once. */
  n: number
}

/**
 * The session dock at the right: Claude Code working on the open project. One session at a time, as a chat. It is
 * drawn anew for each project (`key`), so nothing of one project's session is left over in another's.
 */
export function SessionDock({ project }: { project: ProjectInfo }) {
  const session = useStore((s) => s.session)
  const chat = useChat(session?.sessionId)
  const [resumable, setResumable] = useState(false)
  const [starting, setStarting] = useState(false)
  const [asked, setAsked] = useState<Asked | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const askings = useRef(0)
  /** What main has said each session's status is: some of it comes before `start` has answered with the session. */
  const told = useRef(new Map<string, SessionStatus>())
  /** False once the dock is gone, with its project: what is answered after that is of no one here. */
  const here = useRef(true)

  useEffect(() => {
    here.current = true
    const readResumable = (): Promise<unknown> =>
      window.pino.session.current(project.id).then(
        ({ running, resumable: can }) => {
          if (!here.current) return
          setResumable(can)
          // The session already running here: the window was loaded again.
          if (running && store.getState().session === null) actions.setSession({ sessionId: running.sessionId, status: told.current.get(running.sessionId) ?? running.status })
        },
        () => {}
      )
    const off = window.pino.session.onStatus((m) => {
      told.current.set(m.sessionId, m.status)
      if (store.getState().session?.sessionId === m.sessionId) actions.setSession(m)
      if (m.status === 'exited') void readResumable()
    })
    void readResumable()
    return () => {
      here.current = false
      off()
    }
  }, [project.id])

  const live = session !== null && session.status !== 'exited'

  const take = (result: StartResult, resume: boolean): void => {
    if ('refused' in result) {
      if (result.question) setAsked({ files: result.question.files, resume, n: (askings.current += 1) })
      else setProblem(result.refused)
      return
    }
    const before = store.getState().session
    if (before && before.sessionId !== result.sessionId) chatActions.drop(before.sessionId)
    actions.setSession({ sessionId: result.sessionId, status: told.current.get(result.sessionId) ?? result.status })
  }

  /** One start at a time. The session there is, if it runs, is ended first. */
  const start = async (resume: boolean, first?: () => Promise<void>): Promise<void> => {
    setStarting(true)
    setProblem(null)
    setAsked(null)
    try {
      await first?.()
      const running = store.getState().session
      if (running && running.status !== 'exited') await window.pino.session.stop(running.sessionId)
      const result = await window.pino.session.start(project.id, { resume })
      if (here.current) take(result, resume)
      // A first prompt that was kept goes with the session that starts; it stays kept until it has gone.
      const kept = onboarding.held(project.id)
      if (!('refused' in result) && kept && !kept.taken && kept.text !== '') {
        await window.pino.chat.send(result.sessionId, { text: kept.text })
        onboarding.take(project.id)
      }
    } catch (e) {
      if (here.current) setProblem(reason(e))
    } finally {
      if (here.current) setStarting(false)
    }
  }

  const stop = (): void => {
    if (session) window.pino.session.stop(session.sessionId).catch((e: unknown) => setProblem(reason(e)))
  }

  return (
    <>
      <header className="panel-head session-head">
        <h2 className="panel-title">Claude Code</h2>
        <span className="session-state">
          <span className="session-status" role="status" data-status={session?.status}>
            <span className="status-dot" />
            {sessionWord(session?.status)}
          </span>
        </span>
        <span className="spacer" />
        {session && chat && chat.models.length > 0 && (
          <ModelButton sessionId={session.sessionId} model={chat.meta.model} models={chat.models} mode={chat.meta.permissionMode} effort={chat.meta.effort} live={live} />
        )}
        {session && <More live={live} resumable={resumable} disabled={starting} onResume={() => void start(true)} onNew={() => void start(false)} onStop={stop} />}
      </header>
      <div className="session-body">
        {session ? (
          <ChatPane key={session.sessionId} sessionId={session.sessionId} live={live} working={session.status === 'working' || session.status === 'needs_input'} dir={project.dir} />
        ) : (
          <StartChat project={project} resumable={resumable} starting={starting} onStart={(resume) => void start(resume)} />
        )}
        {asked && (
          <QuestionCard
            files={asked.files}
            asked={`trust ${project.id} ${asked.n}`}
            disabled={starting}
            onTrust={() => void start(asked.resume, () => window.pino.session.trust(project.id))}
            onNotNow={() => setAsked(null)}
          />
        )}
        {problem !== null && (
          <p className="session-problem selectable" role="alert">
            {problem}
          </p>
        )}
      </div>
    </>
  )
}

/** The header's "More": Resume once a session has ended, New session, and Stop, which ends the one that runs. */
function More({ live, resumable, disabled, onResume, onNew, onStop }: { live: boolean; resumable: boolean; disabled: boolean; onResume: () => void; onNew: () => void; onStop: () => void }) {
  const { shown, setShown, button, menu, onKeyDown } = useMenu()
  /** An item is chosen: the menu goes, and the act is made. */
  const choose = (act: () => void) => (): void => {
    setShown(false)
    act()
  }
  return (
    <>
      <button ref={button} type="button" className="button button-quiet session-more" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={shown} onClick={() => setShown(!shown)}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.5" cy="8" r="1.25" />
        </svg>
      </button>
      {shown && (
        <Popover anchor={button.current} width={224} role="presentation" className="session-more-card" onClose={() => setShown(false)}>
          <div ref={menu} className="session-more-menu" role="menu" aria-label="More" onKeyDown={onKeyDown}>
            {!live && resumable && (
              <button type="button" role="menuitem" className="menu-item" disabled={disabled} title="Go on with the conversation that ended" onClick={choose(onResume)}>
                Resume
              </button>
            )}
            <button type="button" role="menuitem" className="menu-item" disabled={disabled} title={live ? 'End this session and begin another conversation' : 'Begin another conversation'} onClick={choose(onNew)}>
              New session
            </button>
            {live && (
              <button type="button" role="menuitem" className="menu-item" disabled={disabled} title="End this session. Its conversation can be resumed" onClick={choose(onStop)}>
                Stop
              </button>
            )}
          </div>
        </Popover>
      )}
    </>
  )
}
