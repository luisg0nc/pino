import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CardTurn } from '../../shared/cards'
import { WRITERS, writtenAt } from './reach'

// Which saves of a project are Claude's own, by its tool calls alone: a turn at work says nothing of who saved. A save
// no call accounts for is the person's, also in the middle of a turn.

/** How far a file's mtime may lie before the clock read just ahead of its write: the kernel stamps files by a coarser one. */
const MTIME_SLACK_MS = 20
/** A file that is gone has no mtime: one heard of this soon after a command ended may have been removed by it. */
const REMOVED_HEARD_MS = 500
/** How many ended commands are kept, for a save that is heard late. */
const KEPT_RUNS = 50

/** One tool call of a session, as its `PreToolUse` names it. */
export interface ToolCall {
  session: string
  project: string
  /** The project's folder, where a relative path of the input is from. */
  dir: string
  /** `tool_use_id`: how the CLI names the call in its hooks, its requests and its results. */
  id: string
  tool: string
  input: unknown
  /** The prompt being answered when it was called; none where no prompt can be named. */
  turn?: CardTurn
}

/** What Claude's save is of. */
export interface ClaudesSave {
  turn?: CardTurn
}

interface Running {
  session: string
  project: string
  turn?: CardTurn
  /** The file a writer tool names, by where its write lands; none for a command, whose files cannot be read. */
  file?: string
  /** It may write from this time on. */
  since: number
  /** It waits for the person's answer: nothing is written meanwhile. */
  waiting: boolean
}

interface Run extends Running {
  end: number
}

/** Programs that write no file whatever their arguments, once nothing redirects or substitutes. */
const READERS = new Set(['cat', 'cd', 'cmp', 'df', 'diff', 'du', 'echo', 'false', 'grep', 'head', 'ls', 'pwd', 'sleep', 'stat', 'tail', 'true', 'wc', 'which'])

/**
 * Whether a shell command can be said, from its text alone, to write no file: nothing in it redirects or substitutes,
 * and every part of it is a program that only reads. It is sure or it says no: a quoted `|` or `>` is a no too.
 */
export function surelyWritesNothing(command: unknown): boolean {
  if (typeof command !== 'string' || command.trim() === '' || /[>`]|\$\(|<\(|<</.test(command)) return false
  return command.split(/&&|\|\||[;|&\n]/).every((part) => part.trim() === '' || READERS.has(part.trim().split(/\s+/)[0]))
}

const fieldOf = (input: unknown, key: string): unknown => (typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined)

/** The file as it stands: when it was saved and how long it is; undefined for one that is not there. */
function statOf(path: string): { mtimeMs: number; size: number } | undefined {
  try {
    const { mtimeMs, size } = statSync(path)
    return { mtimeMs, size }
  } catch {
    return undefined
  }
}

const stampOf = (path: string): string => {
  const stat = statOf(path)
  return stat ? `${stat.mtimeMs}:${stat.size}` : ''
}

const keyOf = (project: string, file: string): string => `${project}\n${file}`

export class ClaudeWrites {
  /** The calls under way that may write, by session and id. */
  private readonly running = new Map<string, Running>()
  /** For each file a writer tool wrote last: as the tool left it, and whose it was. */
  private readonly left = new Map<string, { stamp: string; turn?: CardTurn }>()
  /** The commands that ended, oldest first. */
  private runs: Run[] = []

  constructor(private readonly now: () => number = Date.now) {}

  /** A tool is about to run. One that can write no file is of no account. */
  began(call: ToolCall): void {
    const named = Object.hasOwn(WRITERS, call.tool) ? fieldOf(call.input, WRITERS[call.tool]) : undefined
    const file = typeof named === 'string' && named !== '' ? writtenAt(resolve(call.dir, named)) : undefined
    if (file === undefined && !(call.tool === 'Bash' && !surelyWritesNothing(fieldOf(call.input, 'command')))) return
    this.running.set(`${call.session}\n${call.id}`, { session: call.session, project: call.project, ...(call.turn ? { turn: call.turn } : {}), ...(file !== undefined ? { file } : {}), since: this.now(), waiting: false })
  }

  /** The CLI asks the person whether the call may run: until they answer, it writes nothing. */
  waits(session: string, id: string): void {
    const call = this.running.get(`${session}\n${id}`)
    if (call) call.waiting = true
  }

  allowed(session: string, id: string): void {
    const call = this.running.get(`${session}\n${id}`)
    if (!call) return
    call.waiting = false
    call.since = this.now()
  }

  /** The call never runs. */
  refused(session: string, id: string): void {
    this.running.delete(`${session}\n${id}`)
  }

  /** The call is over; `ok` is false for one that failed. A call already told over is let be. */
  ended(session: string, id: string, ok: boolean): void {
    const key = `${session}\n${id}`
    const call = this.running.get(key)
    if (!call) return
    this.running.delete(key)
    if (call.waiting) return
    if (call.file === undefined) {
      // A command that failed may have written before it did.
      this.runs = [...this.runs, { ...call, end: this.now() }].slice(-KEPT_RUNS)
    } else if (ok) {
      // A writer tool that failed wrote nothing.
      this.left.set(keyOf(call.project, call.file), { stamp: stampOf(call.file), ...(call.turn ? { turn: call.turn } : {}) })
    }
  }

  /** The session's turn, or the session itself, is over: no call of it runs any more. */
  over(session: string): void {
    for (const [key, call] of this.running) if (call.session === session) this.ended(session, key.slice(session.length + 1), true)
  }

  /** Whether the save of `path` just heard is Claude's, and of which prompt; undefined for one that is the person's. */
  by(project: string, path: string): ClaudesSave | undefined {
    const file = writtenAt(path)
    const stat = statOf(file)
    const claude = (turn: CardTurn | undefined): ClaudesSave => (turn ? { turn } : {})
    for (const call of this.running.values()) {
      if (call.project !== project || call.waiting) continue
      if (call.file === file) return claude(call.turn)
      if (call.file === undefined && (!stat || stat.mtimeMs >= call.since - MTIME_SLACK_MS)) return claude(call.turn)
    }
    const left = this.left.get(keyOf(project, file))
    if (left && stat && left.stamp === `${stat.mtimeMs}:${stat.size}`) return claude(left.turn)
    const run = this.runs.findLast((one) => one.project === project && (stat ? stat.mtimeMs >= one.since - MTIME_SLACK_MS && stat.mtimeMs <= one.end : this.now() <= one.end + REMOVED_HEARD_MS))
    return run ? claude(run.turn) : undefined
  }
}
