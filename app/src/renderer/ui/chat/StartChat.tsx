import { useEffect, useMemo, useState } from 'react'
import type { ChatItem } from '../../../shared/chat'
import type { ProjectInfo } from '../../../shared/project'
import { ago } from './ago'
import { ChatItems } from './Items'
import { ChatPlace } from './place'

/**
 * The dock of a project with no session: the end of the conversation it would go on with (read from the log, nothing
 * made), "New session", and "Resume" when there is one to resume. Nothing starts until the person acts.
 */
export function StartChat({ project, resumable, starting, onStart }: { project: ProjectInfo; resumable: boolean; starting: boolean; onStart: (resume: boolean) => void }) {
  const [last, setLast] = useState<{ items: ChatItem[]; at: string | null } | null>(null)
  const place = useMemo(() => ({ dir: project.dir, home: window.pino.home || undefined }), [project.dir])

  // The end of the last conversation, asked of main when there is one to go on with.
  useEffect(() => {
    setLast(null)
    if (!resumable) return
    let live = true
    window.pino.chat.lastConversation(project.id).then(
      (found) => live && setLast(found),
      () => {}
    )
    return () => {
      live = false
    }
  }, [project.id, resumable])

  const when = ago(last?.at ?? null)

  return (
    <div className="chat-start">
      <div className="chat-start-scroll">
        {resumable && (
          <section className="chat-earlier" aria-label="Last conversation">
            <h3 className="chat-earlier-head">{when !== '' ? `Last conversation, ${when}` : 'Last conversation'}</h3>
            {last !== null && last.items.length > 0 ? (
              <ChatPlace.Provider value={place}>
                <ChatItems items={last.items} beat={false} />
              </ChatPlace.Provider>
            ) : (
              last !== null && <p className="chat-note chat-quiet">Its turns are not shown here: it was begun in a terminal.</p>
            )}
          </section>
        )}
        <p className="chat-empty">
          Claude Code runs here, in the folder of <span className="num">{project.name}</span>, and works on it with you.
        </p>
        <div className="session-actions">
          <button type="button" className="button button-primary" disabled={starting} onClick={() => onStart(false)}>
            New session
          </button>
          {resumable && (
            <button type="button" className="button session-resume" disabled={starting} onClick={() => onStart(true)}>
              Resume
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
