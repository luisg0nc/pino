import { readlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { APP } from '../../shared/app'
import { isInsideFolder, realPathOrNearest } from './inside'

/** The tools that write a file, and the key of their input that names it. */
const WRITERS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }

/** The most links followed one after another, as Linux does: a circle of links ends there. */
const MOST_LINKS = 40

/**
 * Where a write of `path` lands, by real paths: a link as its last name is followed also when what it names is not
 * there yet, since the write would make it.
 */
function writtenAt(path: string): string {
  let at = path
  for (let hop = 0; hop < MOST_LINKS; hop++) {
    const placed = join(realPathOrNearest(dirname(at)), basename(at))
    let target: string
    try {
      target = readlinkSync(placed)
    } catch {
      // Not a link, or nothing there.
      return realPathOrNearest(placed)
    }
    at = resolve(dirname(placed), target)
  }
  return at
}

/**
 * Why a tool of the agent is refused, or undefined when it may go on. A session writes only in its own project's
 * folder: `Write`, `Edit` and `NotebookEdit` of any other path (another project, a folder beside it) are refused,
 * judged by real paths (`isInsideFolder`), and so is a write under `.pino/`, which is pino's alone, and of the
 * project's `brief.md`, which is the person's. `Bash` is never judged: no path can be read from a command, so the CLI's
 * own card stays.
 */
export function refusalOf(dir: string, name: string, input: unknown): string | undefined {
  const key = WRITERS[name]
  if (!key || typeof input !== 'object' || input === null) return undefined
  const named = (input as Record<string, unknown>)[key]
  if (typeof named !== 'string' || named === '') return undefined
  // A relative path is from the project's folder, where the agent runs, whichever folder it is held against.
  // All three are judged by where the write lands, links followed.
  const path = writtenAt(resolve(dir, named))
  if (isInsideFolder(join(dir, APP.folder), path)) {
    return `${name} may not write under ${APP.folder}/: it is ${APP.name}'s own, and a hand edit skips its rules. Read a file there with Read.`
  }
  if (path === writtenAt(join(dir, 'brief.md'))) return BRIEF_REFUSAL(name)
  if (isInsideFolder(dir, path)) return undefined
  return `This session works on the project in ${dir}. ${name} may write only there. ` +
    `Another project is the person's to open: ask them to open it in ${APP.name}.`
}

/**
 * Why Claude may not write `brief.md` (#337): it is the person's own words, and what Claude learns is a card of its own,
 * one per topic, which it changes rather than adding another.
 */
export const BRIEF_REFUSAL = (name: string): string =>
  `${name} may not write brief.md: it is the person's own words, and only they change it. Write down what you learned as a card of yours with add_card, ` +
  'one card per topic that begins with its name ("Power: USB-C, 5 V"); when a topic changes, change your card of it (card and text) rather than add another.'

/** The `PreToolUse` answer that refuses a tool, with the reason the agent reads. */
export function deniedAnswer(reason: string): unknown {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }
}
