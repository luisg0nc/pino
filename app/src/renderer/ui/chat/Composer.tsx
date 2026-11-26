import { useEffect, useRef, useState } from 'react'
import { hint, pressed, which } from '../../../shared/keys'
import { useChat } from '../../state/chat'
import { giveKeysBack } from '../typing'
import { TasksBar } from './Tasks'

/** What an IPC call failed with, without Electron's wrapping. */
const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

/** A prompt not yet sent, kept for a session while its pane is not shown. */
const drafts = new Map<string, string>()

/**
 * The foot of the chat: the box a prompt is written in. Enter sends and Shift+Enter breaks the line. While the agent
 * works the prompt is queued by the CLI, and "Stop" (or Escape) interrupts it; at rest Escape gives the keys back, as
 * a field does. While a permission or a plan waits, what is written can be the answer to it.
 */
export function Composer({ sessionId, live, working, onSent }: { sessionId: string; live: boolean; working: boolean; onSent: () => void }) {
  const [text, setText] = useState(() => drafts.get(sessionId) ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const chat = useChat(sessionId)
  const waiting = chat?.items.findLast((i) => i.kind === 'ask' && i.state === 'open' && i.toolName !== 'AskUserQuestion')
  const openAsk = waiting?.kind === 'ask' ? waiting : undefined
  const field = useRef<HTMLTextAreaElement>(null)
  // Kept as it is written, so that it is there when the pane comes back.
  useEffect(() => void drafts.set(sessionId, text), [sessionId, text])
  // A chat that has just come up is there to be written in.
  useEffect(() => {
    if (live) field.current?.focus({ preventScroll: true })
  }, [])

  async function send(): Promise<void> {
    const prompt = text.trim()
    if (prompt === '' || !live) return
    setText('')
    setProblem(null)
    onSent()
    try {
      await window.pino.chat.send(sessionId, { text: prompt })
    } catch (e) {
      // Nothing was sent: what was written is given back, unless more has been written since.
      setText((now) => (now === '' ? prompt : now))
      setProblem(reason(e))
    }
  }

  /** The text as the answer to the card that waits: it refuses with it as the reason, and the agent goes on with it. */
  function denyAndSend(): void {
    const message = text.trim()
    if (message === '' || !live || !openAsk) return
    setText('')
    setProblem(null)
    onSent()
    window.pino.chat.answer(sessionId, openAsk.requestId, { allow: false, message })
  }

  /** The turn stopped, as the button does. */
  function stop(): void {
    setProblem(null)
    window.pino.chat.interrupt(sessionId).catch((e: unknown) => setProblem(reason(e)))
  }

  return (
    <div className="chat-foot">
      {/* Above the box, while Claude works: how far its list is, and what it does now. */}
      <TasksBar items={chat?.items ?? []} working={working} />
      <div className="chat-composer chat-box">
        <textarea
          ref={field}
          className="chat-input"
          data-chat-composer=""
          rows={2}
          value={text}
          disabled={!live}
          aria-label="Message to Claude Code"
          placeholder={live ? (openAsk ? 'Answer the card above, or say what to do instead' : working ? 'Claude Code is working: this goes next' : 'Message Claude Code') : 'The session has ended'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            // A new line is the browser's own.
            if (pressed(e, 'chat.newline')) return
            // Escape stops whatever is selected; Ctrl+C with a selection is a copy, and the turn goes on.
            const stopKey = working && live ? which(e, 'chat.stop') : -1
            if (stopKey === 0 || (stopKey > 0 && e.currentTarget.selectionStart === e.currentTarget.selectionEnd)) {
              e.preventDefault()
              stop()
            } else if (pressed(e, 'chat.send')) {
              e.preventDefault()
              if (openAsk) denyAndSend()
              else void send()
            } else if (pressed(e, 'field.leave')) {
              e.preventDefault()
              giveKeysBack(e.currentTarget)
            }
          }}
        />
        <div className="chat-actions">
          <span className="spacer" />
          {live && (
            <kbd className="chat-hint num" aria-hidden="true">
              {working ? hint('chat.stop') : hint('chat.send')}
            </kbd>
          )}
          {working && live && (
            <button type="button" className="button" title={`Stop the turn (${hint('chat.stop')})`} onClick={stop}>
              Stop
            </button>
          )}
          {openAsk && (
            <button type="button" className="button button-primary" disabled={!live || text.trim() === ''} title={`Refuse what the card asks, with this as what to do instead (${hint('chat.send')})`} onClick={denyAndSend}>
              Deny and send
            </button>
          )}
          <button type="button" className={openAsk ? 'button' : 'button button-primary'} disabled={!live || text.trim() === ''} title={openAsk ? 'Leave the card as it is and queue this for after it' : `Send (${hint('chat.send')})`} onClick={() => void send()}>
            {working ? 'Queue' : 'Send'}
          </button>
        </div>
      </div>
      {problem !== null && (
        <p className="chat-problem selectable" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
