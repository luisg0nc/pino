import { join, resolve } from 'node:path'
import { APP } from '../../shared/app'
import { isInsideFolder } from './inside'

/** The tools that write a file, and the key of their input that names it. */
const WRITERS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }

/**
 * Why a tool of the agent is refused, or undefined when it may go on. A session writes only in its own project's
 * folder: `Write`, `Edit` and `NotebookEdit` of any other path (another project, a folder beside it) are refused,
 * judged by real paths (`isInsideFolder`), and so is a write under `.pino/`, which is pino's alone. `Bash` is never
 * judged: no path can be read from a command, so the CLI's own card stays.
 */
export function refusalOf(dir: string, name: string, input: unknown): string | undefined {
  const key = WRITERS[name]
  if (!key || typeof input !== 'object' || input === null) return undefined
  const named = (input as Record<string, unknown>)[key]
  if (typeof named !== 'string' || named === '') return undefined
  // A relative path is from the project's folder, where the agent runs, whichever folder it is held against.
  const path = resolve(dir, named)
  if (isInsideFolder(join(dir, APP.folder), path)) {
    return `${name} may not write under ${APP.folder}/: it is ${APP.name}'s own, and a hand edit skips its rules. Read a file there with Read.`
  }
  if (isInsideFolder(dir, path)) return undefined
  return `This session works on the project in ${dir}. ${name} may write only there. ` +
    `Another project is the person's to open: ask them to open it in ${APP.name}.`
}

/** The `PreToolUse` answer that refuses a tool, with the reason the agent reads. */
export function deniedAnswer(reason: string): unknown {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
}
