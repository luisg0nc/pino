// The transcript of a chat session: what Claude Code said and did, what the person said to it, and what pino
// added or was asked for on the way. Main reduces the CLI's stream to these items (`main/sessions/transcript.ts`),
// keeps them, and tells the window of each as it changes; the window draws them. An item is upserted by its `id`:
// a change sends the whole item again.

import { APP, TOOL_PREFIX } from './app'

/** How many items a transcript holds, in main and in the window: the oldest go. */
export const MAX_ITEMS = 2000

/** A picture in the conversation. `data` (base64) is absent once it is not kept, and is never written to the log. */
export interface ChatImage {
  id: string
  mediaType: string
  data?: string
  width?: number
  height?: number
  /** The person's reference this picture is (`reference/photo-1.jpg`), when the prompt named it so: shown from the file once `data` is gone. */
  file?: string
}

export type ChatItem =
  /** What the person sent. `queued` until the CLI takes the prompt up (a prompt sent while it works waits). */
  | { kind: 'user'; id: string; text: string; images: ChatImage[]; state: 'queued' | 'sent' | 'not-sent'; at: number }
  /** What pino added to that prompt (the context a `UserPromptSubmit` was answered with), shown under it: the marks sent, and how many instruction files of Claude Code's it named (`instructions`). `forTool`: it is under a tool's card (`forUser` is then that card's id). */
  | { kind: 'context'; id: string; forUser: string; forTool?: true; text: string; marks: string[]; instructions?: number }
  /** The agent's words, as markdown. */
  | { kind: 'text'; id: string; text: string; streaming: boolean }
  /** The agent thought. This CLI leaves the text of a thought empty. */
  | { kind: 'thinking'; id: string; seconds?: number; streaming: boolean }
  /** A tool the agent used (`denied`: the person refused its ask; `cancelled`: its ask ended with the turn stopped; `error`: a failure the person did not cause); `own` when it is one of pino's own (`mcp__pino__<tool>`). A `Task` (a subagent) has the `steps` it took and a line for each tool it used `inside`. */
  | { kind: 'tool'; id: string; toolUseId: string; name: string; own: boolean; input: unknown; state: 'running' | 'done' | 'error' | 'stopped' | 'denied' | 'cancelled'; result?: string; images: ChatImage[]; detail?: unknown; steps?: number; inside?: string[] }
  /** The agent asks the person: to use a tool, or a question. `suggestions`: whether there is a rule to allow for the session. `why` of one that ended by the CLI's cancelling it (the turn was stopped); one that ended with the session has none. */
  | { kind: 'ask'; id: string; requestId: string; toolName: string; input: unknown; suggestions: boolean; description?: string; blockedPath?: string; state: 'open' | 'allowed' | 'denied' | 'ended'; answer?: string; why?: string }
  /** The end of a turn, with what was pulled from pino's tools in it (`pulled`) and the tokens it used when the CLI said (`usage`). */
  | { kind: 'turn'; id: string; ok: boolean; stopped: boolean; seconds: number; pulled: Record<string, number>; usage?: TurnUsage; error?: string }
  /** Something pino says about the conversation: the model changed, pino's tools are not connected, the session ended. */
  | { kind: 'note'; id: string; text: string; tone: 'quiet' | 'warn' }

/** The tokens of one kind of request, as the CLI counts them. */
export interface TokenCount {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

/**
 * What a turn used, from the `result` that ended it (`usage`, `modelUsage`, `num_turns`): numbers only, kept with the
 * turn in the chat's log. `models` is the same count for each model, where the CLI split it.
 */
export interface TurnUsage extends TokenCount {
  /** Requests to the model in the turn (`num_turns`). */
  requests?: number
  models?: Record<string, TokenCount>
}

/** What is known of the session as a whole, apart from the items. */
export interface ChatMeta {
  model?: string
  /** The effort pino started the session with or set since; absent: the person's own default, which the CLI does not say. */
  effort?: Effort
  /** How the CLI asks about edits (`permissionMode` of its `init`, or set since by `set_permission_mode`); absent until it has said. */
  permissionMode?: string
  /** Whether the CLI says pino's MCP server is connected; absent until it has said. */
  appConnected?: boolean
  /** The version of Claude Code (`claude_code_version` of its `init`); absent until it has said. */
  version?: string
  /** Where the CLI says its credentials come from (`none`: the person's login; anything else but `oauth`: an API key). */
  apiKeySource?: string
  /** Whether pino's plugin of skills loaded, by the CLI's `init`; absent when pino passed none or the CLI did not say. */
  pluginLoaded?: boolean
  /** The API is being retried (`api_retry`), at this attempt when the CLI said which; absent once it answers. */
  retrying?: { attempt?: number }
  /** What the session has cost so far, in US dollars, as the CLI estimates (`total_cost_usd` of its last `result`). */
  costUsd?: number
  /** The tokens the last request held, against the window of the model. */
  context?: { used: number; window: number }
  /** The window of the CLI's rate limit that is the most used: its name (`five_hour`), the percent used, and when it resets (ms). */
  rate?: { window: string; used: number; resetsAt?: number }
}

/** The slash commands and models a chat session's CLI offers. */
export interface ChatCommand {
  name: string
  description: string
  argumentHint: string
}
export interface ChatModel {
  value: string
  displayName: string
  /** The efforts the CLI says the model takes, in its order; empty when it takes none; absent when the CLI did not say. */
  efforts?: Effort[]
}

/** The modes pino offers for a session, in Claude Code's words (`set_permission_mode`). Others the CLI reports are shown as they are, never offered. */
export const MODES = ['default', 'acceptEdits', 'plan'] as const
export type Mode = (typeof MODES)[number]
/** How a mode is named to the person (the menu and the note in the chat). */
export const MODE_NOTE: Readonly<Record<string, string>> = { default: 'ask first', acceptEdits: 'accept edits', plan: 'plan first' }

export function isMode(v: unknown): v is Mode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v)
}

/** The efforts Claude Code knows (`--effort`, `effortLevel`), least first. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]
export const isEffort = (value: unknown): value is Effort => typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)

/** A model as the CLI names one: an alias (`sonnet`) or an id, possibly with a context suffix (`claude-opus-4-5[1m]`). Never a flag. */
export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/

/**
 * The model and effort a session is started with, for that session only: what is absent is the person's own default
 * (their settings), and pino passes nothing for it. Nothing of the person's settings is written.
 */
export interface AgentChoice {
  model?: string
  effort?: Effort
}

/** What the window sent of a choice, holding only what the CLI could be given: anything else is left to the person's default. */
export function agentChoiceOf(raw: unknown): AgentChoice {
  const { model, effort } = (typeof raw === 'object' && raw !== null ? raw : {}) as { model?: unknown; effort?: unknown }
  return { ...(typeof model === 'string' && MODEL_NAME.test(model) ? { model } : {}), ...(isEffort(effort) ? { effort } : {}) }
}

/** The efforts to offer with a model of the list: its own, or every one when the CLI did not say (or the model is none of the list). */
export function effortsOf(models: readonly ChatModel[], model: string | undefined): readonly Effort[] {
  return models.find((m) => m.value === model)?.efforts ?? EFFORTS
}

/** The models offered before any session has said its own: Claude Code's aliases, which stand for the latest of each. */
export const MODEL_ALIASES: readonly ChatModel[] = [
  { value: 'opus', displayName: 'Opus' },
  { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'haiku', displayName: 'Haiku' }
]

/** What the window asks for to draw a session's transcript, whenever it starts or is reloaded. */
export interface ChatHistory {
  items: ChatItem[]
  meta: ChatMeta
  /** The items of the conversation this session resumed, from `.pino/chat/`, and a note on what they leave out. Empty for a fresh one. */
  earlier: ChatItem[]
  commands: ChatCommand[]
  models: ChatModel[]
  /**
   * How many things main has told of this session so far. Every item and meta it tells afterwards carries a larger
   * `seq`: one with a `seq` up to this holds nothing the history does not, and is dropped.
   */
  seq: number
}

/** What the person answers a request of the agent's with. `updatedInput` is taken only for `AskUserQuestion`. */
export type ChatAnswer = { allow: true; always?: boolean; updatedInput?: unknown } | { allow: false; message: string }

/** Whether a tool is one pino gives the agent, by the name the CLI gives it. */
export const isAppTool = (name: string): boolean => name.startsWith(TOOL_PREFIX)

const LABEL_CHARS = 80

const field = (input: unknown, key: string): string | undefined => {
  const value = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof value === 'string' && value !== '' ? value : undefined
}

const cut = (text: string): string => {
  const line = text.split('\n')[0]
  return line.length > LABEL_CHARS ? line.slice(0, LABEL_CHARS) : line
}

/** Where the chat is: the folder of the project it works in, and the person's home folder; either may be unknown. */
export interface ChatWhere { dir?: string; home?: string }

/**
 * A file path as the chat shows it: relative to the project's folder when inside it, `~` for the home folder when
 * elsewhere under it, as given otherwise. The full path stays in the opened detail and in the tooltip.
 */
export function shownPath(path: string, where: ChatWhere = {}): string {
  const under = (base: string | undefined): string | undefined => {
    if (!base) return undefined
    const root = base.length > 1 ? base.replace(/\/+$/, '') : base
    if (path === root) return ''
    return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : undefined
  }
  const inside = under(where.dir)
  if (inside !== undefined) return inside === '' ? '.' : inside
  const home = under(where.home)
  if (home !== undefined) return home === '' ? '~' : `~/${home}`
  return path
}

/** One line for a tool the agent used: what a person would read to know what it did. */
export function toolLabel(name: string, input: unknown, where?: ChatWhere): string {
  if (isAppTool(name)) {
    const tool = name.slice(TOOL_PREFIX.length)
    const refs = typeof input === 'object' && input !== null && Array.isArray((input as { refs?: unknown }).refs) ? (input as { refs: unknown[] }).refs.filter((r): r is string => typeof r === 'string') : []
    const hint = field(input, 'view') ?? field(input, 'ref') ?? field(input, 'id') ?? field(input, 'kind') ?? (refs.length > 0 ? refs.slice(0, 3).join(', ') : undefined)
    return `${APP.name} · ${tool}${hint ? ` (${cut(hint)})` : ''}`
  }
  let detail: string | undefined
  if (name === 'Read' || name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit') {
    const file = field(input, 'file_path') ?? field(input, 'notebook_path') ?? field(input, 'path')
    return file ? `${name} ${shownPath(file, where)}` : name
  }
  if (name === 'Bash') detail = field(input, 'command')
  else if (name === 'Grep' || name === 'Glob') {
    detail = field(input, 'pattern')
    const at = field(input, 'path')
    if (detail && at) return `${name}: ${cut(detail)} in ${shownPath(at, where)}`
  } else if (name === 'Task') detail = field(input, 'description')
  else if (name === 'TaskCreate') detail = field(input, 'subject')
  return detail ? `${name}: ${cut(detail)}` : name
}
