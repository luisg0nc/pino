import type { SessionStatus } from '../../shared/bridge'

/**
 * The hooks pino listens to. `SessionStart` is absent on purpose: Claude Code
 * does not fire it as an http hook. `PreToolUse` and `PostToolUse` are there
 * only to say the agent is at work again after a question was answered:
 * nothing else tells that a permission prompt has gone. `StopFailure` is the
 * end of a turn that an error of the API ended (a login that failed, an
 * overload): it is posted in place of the `Stop`, ends the turn as one does,
 * and is never held back (Claude Code reads no answer to it). `PostCompact` says the conversation was
 * compacted; it changes no status.
 */
export const HOOK_EVENTS = ['UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'PostCompact', 'SessionEnd']

/**
 * The status of a session after an event: the name of a hook the agent posted,
 * or what the PTY did (`output`, `exit`), or what a chat session's stream did (`ask`, `answered`). An event that says nothing about the
 * status leaves it as it is, and nothing follows `exited`.
 */
export function reduceStatus(prev: SessionStatus, event: string, body?: unknown): SessionStatus {
  if (prev === 'exited') return prev
  switch (event) {
    case 'output':
      return prev === 'starting' ? 'idle' : prev
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return 'working'
    case 'Stop':
    case 'StopFailure':
      return 'idle'
    case 'Notification':
      // Claude Code also posts one when it has merely been idle for a while, or has signed in: no question.
      return noQuestion(body) ? prev : 'needs_input'
    case 'PermissionRequest':
      return 'needs_input'
    case 'ask':
      // A chat session: the CLI sent a request (a permission, a question) that the person is to answer.
      return 'needs_input'
    case 'answered':
      return prev === 'needs_input' ? 'working' : prev
    case 'SessionEnd':
    case 'exit':
      return 'exited'
    default:
      return prev
  }
}

/** The kinds of `Notification` that ask nothing of the person, as Claude Code names them. */
const NO_QUESTION = new Set(['idle_prompt', 'auth_success'])

/**
 * Whether the body of a `Notification` hook says it is no question: by its `notification_type` where it has
 * one, else by the sentence an idle reminder carries. One that says nothing of its kind is taken for a question.
 */
function noQuestion(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  const { notification_type: type, message } = body as { notification_type?: unknown; message?: unknown }
  if (typeof type === 'string') return NO_QUESTION.has(type)
  return typeof message === 'string' && /waiting for your input/i.test(message)
}
