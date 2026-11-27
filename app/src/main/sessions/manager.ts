import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { APP, envName } from '../../shared/app'
import type { SessionStatus, StartResult } from '../../shared/bridge'
import type { CardTurn } from '../../shared/cards'
import { agentChoiceOf, type ChatAnswer, type ChatCommand, type ChatHistory, type ChatItem, type ChatMeta, type ChatModel, type Effort, isEffort, isMode, type Mode, MODEL_NAME } from '../../shared/chat'
import type { ProjectInfo } from '../../shared/project'
import { BodyTooLarge, type HttpRouter, readBody, sendJson } from '../http'
import { FOLDER } from '../own'
import type { Trust } from '../trust'
import type { AgentAdapter } from './adapter'
import { agentEnv } from './agentEnv'
import { appendItems, readLog, trimLog } from './chatlog'
import { findCommand } from './choice'
import type { SessionDomain } from './domain'
import { type KnownModels, modelsOf } from './models'
import { sessionRules } from './permissions'
import { deniedAnswer, refusalOf } from './reach'
import { SESSION_FILE, storeConversation, storedConversation, UUID } from './resume'
import { listUsage } from './usage'
import { type ClaudesSave, ClaudeWrites } from './writes'
import type { ProjectUsage } from '../../shared/usage'
import { HOOK_EVENTS, reduceStatus } from './status'
import type { AgentAsk, AgentTransport, AskAnswer, PromptBlock } from './transport'
import { Transcript } from './transcript'

const HOOK_BODY_LIMIT = 1024 * 1024
/** A tool hook's body is read up to this: one that is longer is answered {} unread. */
const TOOL_BODY_LIMIT = 8 * 1024 * 1024
/** A chat session that has been told to end: SIGTERM to its group after this long, SIGKILL after twice. */
const TERM_AFTER_MS = 2000
/** After a `result` that leaves prompts the CLI has not taken up, it is given this long to begin on them. */
const IDLE_GRACE_MS = 1500
/** How many lines of the CLI's stderr are kept for the person to be told, should it stop. */
const STDERR_LINES = 20
/** Said when the CLI is gone without a word on stdout. */
const DID_NOT_START = 'It did not start: is `claude` up to date and signed in? Run `claude` in a terminal to see why.'
/** The hooks that say a conversation has a prompt in it: it exists for the agent, and can be resumed. */
const CONVERSATION_EVENTS = new Set(['UserPromptSubmit', 'Stop'])
/** The hooks that only say the agent is at work again. */
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse'])

const NOT_FOUND = `Claude Code was not found on PATH. Install it, or start ${APP.name} from a terminal where claude runs.`
const UNTRUSTED = 'This folder has Claude Code settings of its own'

export type { StartResult }

/** How a session is started: `resume` continues the conversation on file; `model` and `effort` are this session's alone. */
export interface StartOptions {
  resume?: boolean
  model?: string
  effort?: Effort
}

interface Session {
  id: string
  project: ProjectInfo
  /** What its requests carry in the session header (`HttpRouter.grant`): revoked when it has gone. In memory only. */
  token: string
  /** The files of pino's it was given by path (`AgentLaunch.files`): removed when it has gone. */
  files: string[]
  /** The agent's id of the conversation, as its last hook named it. */
  conversationId: string
  status: SessionStatus
  agent: AgentTransport
  /** The agent's process, which leads a group of its own; 0 when the transport does not say. */
  pid: number
  /** What it said and did, as the window draws it; kept after the session ends (`Sessions.history`). */
  chat: ChatRecord
  /** What was written under the project's folder, one write after another; and whether a write of the log failed, after which none is tried. */
  logging: Promise<void>
  logFailed: boolean
  /** The requests of the CLI's that wait for the person. */
  asks: Map<string, AgentAsk>
  /** What the CLI printed or posted last (it grows with every line and hook), to tell a moment of quiet from a change. */
  activity: number
  /** Waits a moment after a `result` that left prompts untaken, to see whether the CLI begins on them. */
  graceTimer?: NodeJS.Timeout
  /** The last lines the CLI wrote on stderr, redacted, and whether it printed anything on stdout. */
  stderr: string[]
  heard: boolean
  exited: Promise<void>
  /** Set once the session was told to end: the last of two signals. */
  killTimer?: NodeJS.Timeout
  termTimer?: NodeJS.Timeout
}

/** The transcript of a chat session, and what the window needs to draw it again. */
interface ChatRecord {
  projectId: string
  transcript: Transcript
  /** The log of the conversation this session resumed, read once when it started. */
  earlier: ChatItem[]
  capabilities?: Capabilities
  /** Counts every item and meta told, so that a window that asked for the history knows which of them it holds. */
  seq: number
}

/** What a chat session's CLI says it can do: its slash commands and the models it offers. */
interface Capabilities {
  commands: Array<{ name: string; description: string; argumentHint: string }>
  models: unknown[]
}

export interface Events {
  status: { sessionId: string; projectId: string; status: SessionStatus }
  /** An item of a transcript was added or changed. `seq` grows with every item and meta told of the session. */
  item: { sessionId: string; projectId: string; item: ChatItem; seq: number }
  /** What is known of the session as a whole changed (the model, the rate limit). */
  meta: { sessionId: string; projectId: string; meta: ChatMeta; seq: number }
  /** The CLI has said which slash commands and models it has (a history had before this has none of them). */
  capabilities: { sessionId: string; projectId: string; commands: ChatCommand[]; models: ChatModel[]; seq: number }
}

export interface SessionsDeps {
  http: HttpRouter
  /** How the agent is started: Claude Code's adapter (`claude.ts`). */
  adapter: AgentAdapter
  /**
   * A folder of pino's own, never in a project (`<userData>/agent`), for the files an agent is given by path
   * (`AgentLaunch.files`, which hold no secret): written when it starts, removed when it has gone.
   */
  configDir: string
  /** The environment pino runs in, of which the agent is given its share (`agentEnv`). Read at each start. */
  env: Record<string, string | undefined>
  domain: SessionDomain
  /** Claude Code run headless does not ask whether to trust a folder that has settings of its own: pino asks first. */
  trust: Trust
  models: KnownModels
  /** What is added to the agent's system prompt. */
  systemPrompt: string
  /** Takes a line about a session, its command or a hook it posted, with no token in it. */
  debug?: (line: string) => void
}

/**
 * The agent sessions: each the real CLI, headless on pipes, in the folder of one project, and at most one per project.
 * The status of a session follows the hooks the agent posts to `/hooks/<sessionId>/<event>` on the local HTTP server,
 * with the session's token in a header: a token made when it starts, that opens its own hooks and its project's MCP
 * server, and nothing once it has gone.
 */
export class Sessions {
  private readonly sessions = new Map<string, Session>()
  /** The transcript of each session there is, and of the last one of each project that has ended. */
  private readonly records = new Map<string, ChatRecord>()
  /** By project: a session that is being started there. */
  private readonly starting = new Map<string, Promise<StartResult>>()
  /** What Claude's tool calls wrote, so that a save can be said to be its or the person's. */
  private readonly writes = new ClaudeWrites()
  private readonly listeners: { [E in keyof Events]: Set<(m: Events[E]) => void> } = { status: new Set(), item: new Set(), meta: new Set(), capabilities: new Set() }

  constructor(private readonly deps: SessionsDeps) {
    deps.http.route('/hooks', (req, res, rest) => this.hook(req, res, rest))
  }

  /** Listens until the function it answers with is called. */
  on<E extends keyof Events>(event: E, cb: (m: Events[E]) => void): () => void {
    this.listeners[event].add(cb)
    return () => void this.listeners[event].delete(cb)
  }

  /**
   * Start the agent in a project's folder, or answer with the session already running there. A second call for a
   * project while the first is still starting there is answered as the first.
   */
  start(project: ProjectInfo, opts: StartOptions = {}): Promise<StartResult> {
    const running = this.current(project.id)
    // With where it stands: nothing more may be said of a session that is waiting, and the caller would take it for starting.
    if (running) return Promise.resolve(running)
    const under = this.starting.get(project.id)
    if (under) return under
    const begun = this.begin(project, opts).finally(() => this.starting.delete(project.id))
    this.starting.set(project.id, begun)
    return begun
  }

  private async begin(project: ProjectInfo, opts: StartOptions): Promise<StartResult> {
    const { http, adapter } = this.deps
    const person = agentEnv(this.deps.env)
    // Looked for before anything is made, so that a start that cannot be says so and leaves nothing behind.
    if (!findCommand(adapter.probe.command, person.PATH)) return { refused: NOT_FOUND }
    // Before anything is written or started: the chat loads what the folder's settings name without asking.
    const settings = await this.deps.trust.pending(project.dir)
    if (settings.length > 0) return { refused: UNTRUSTED, question: { kind: 'trust', files: settings } }

    const id = randomUUID()
    const stored = opts.resume ? storedConversation(project.dir) : null
    const conversationId = stored ?? randomUUID()
    const mcpUrl = http.url(`/mcp/${project.id}`)
    // The session's own: its hooks and its project's MCP server, for as long as it is there.
    const token = http.grant([new URL(mcpUrl).pathname, `/hooks/${id}`])
    const choice = agentChoiceOf(opts)
    const launch = adapter.launch({
      sessionId: id,
      conversationId,
      resume: stored !== null,
      view: 'chat',
      cwd: project.dir,
      mcpUrl,
      hookUrl: (event) => http.url(`/hooks/${id}/${encodeURIComponent(event)}`),
      token,
      configDir: this.deps.configDir,
      systemPrompt: this.deps.systemPrompt,
      ...choice
    })
    const files = launch.files.map((file) => file.path)
    let agent: AgentTransport
    let earlier: ChatItem[] = []
    try {
      // Redacted whatever it holds: nothing secret is in the arguments, and what is logged stays so should that change.
      this.debug(`session ${id} in ${project.dir}: ${JSON.stringify([launch.command, ...launch.args])}`)
      const env: Record<string, string> = { ...person, ...launch.env, [envName('PROJECT_ID')]: project.id, [envName('SESSION_ID')]: id }
      // What a chat shows of the conversation it resumes is read before the session exists: it is the log's as it was.
      if (stored !== null) {
        await trimLog(project.dir, stored)
        earlier = await earlierOf(project.dir, stored)
      }
      // The person's alone to read, though none of them holds a secret.
      mkdirSync(this.deps.configDir, { recursive: true, mode: 0o700 })
      for (const file of launch.files) writeFileSync(file.path, file.text, { mode: 0o600 })
      agent = adapter.chat({ command: launch.command, args: launch.args, cwd: project.dir, env })
    } catch (e) {
      this.release({ token, files })
      throw e
    }
    let ended!: () => void
    const chat: ChatRecord = {
      projectId: project.id,
      earlier,
      seq: 0,
      transcript: new Transcript({
        prefix: `${id.slice(0, 6)}-`,
        redact: http.redact,
        resumed: stored !== null,
        turnBuilds: (since, prompts) => this.deps.domain.turnBuilds?.(project, since, prompts),
        ...(adapter.tested ? { tested: adapter.tested } : {}),
        ...(isEffort(choice.effort) ? { effort: choice.effort } : {}),
        emit: (item) => {
          chat.seq += 1
          // The write of the log begins before anyone is told, so that whoever reads it on being told finds it coming.
          this.log(session)
          this.emit('item', { sessionId: id, projectId: project.id, item, seq: chat.seq })
        },
        emitMeta: (meta) => {
          chat.seq += 1
          this.emit('meta', { sessionId: id, projectId: project.id, meta, seq: chat.seq })
        }
      })
    }
    const session: Session = {
      id,
      project,
      token,
      files,
      conversationId,
      status: 'starting',
      agent,
      pid: 'pid' in agent ? Number(agent.pid) : 0,
      chat,
      logging: Promise.resolve(),
      logFailed: false,
      asks: new Map(),
      activity: 0,
      stderr: [],
      heard: false,
      exited: new Promise<void>((resolve) => (ended = resolve))
    }
    // Only the newest session of a project keeps its transcript: the one before it was readable until now.
    for (const [before, record] of this.records) if (record.projectId === project.id) this.records.delete(before)
    this.records.set(id, chat)
    this.sessions.set(id, session)
    this.emit('status', { sessionId: id, projectId: project.id, status: 'starting' })
    this.follow(session, agent, ended)
    return { sessionId: id, status: session.status }
  }

  /** The session running in a project's folder. One that has been told to end is no longer it, though its process may linger. */
  current(projectId: string): { sessionId: string; status: SessionStatus } | null {
    for (const s of this.sessions.values()) if (s.project.id === projectId && !s.killTimer) return { sessionId: s.id, status: s.status }
    return null
  }

  /** Whether a conversation is on file for the project, to resume. */
  resumable(project: ProjectInfo): boolean {
    return storedConversation(project.dir) !== null
  }

  /** What each prompt of a project took (`listUsage`), read once the chat logs being written have landed: the window asks as a turn ends. */
  async usage(project: Pick<ProjectInfo, 'id' | 'dir'>): Promise<ProjectUsage> {
    await Promise.all([...this.sessions.values()].filter((s) => s.project.id === project.id).map((s) => s.logging))
    return listUsage(project.dir)
  }

  /**
   * The prompt the project's session is answering now, as a card of Claude's names it (#336). None between turns, and
   * none before the first prompt's hook was answered.
   */
  turnNow(projectId: string): CardTurn | undefined {
    for (const s of this.sessions.values()) {
      if (s.project.id !== projectId || s.killTimer) continue
      if (s.status !== 'working' && s.status !== 'needs_input') return undefined
      return this.turnOf(s)
    }
    return undefined
  }

  /** The prompt a session took up last, as a card or a build names it. */
  private turnOf(s: Session): CardTurn | undefined {
    const taken = s.chat.transcript.taken()
    return taken ? { prompt: taken.item, conversation: s.conversationId } : undefined
  }

  /** Whether the save of `path` just heard in a project is one of Claude's tool calls, and of which prompt. */
  wroteBy(projectId: string, path: string): ClaudesSave | undefined {
    return this.writes.by(projectId, path)
  }

  /** A prompt for a session's agent, which queues it if it is at work. Rejects for a session that has ended. */
  async send(sessionId: string, prompt: { text: string }): Promise<void> {
    if (!this.live(sessionId)) throw new Error('This session has ended')
    if (typeof prompt?.text !== 'string' || prompt.text.trim() === '') return
    return this.sendBlocks(sessionId, [{ type: 'text', text: prompt.text }])
  }

  /** `send` for a prompt of text and pictures, as given: the transcript shows its first text and its pictures. */
  async sendBlocks(sessionId: string, content: PromptBlock[]): Promise<void> {
    const s = this.live(sessionId)
    if (!s) throw new Error('This session has ended')
    // It waits when the agent is at work, or has been sent a prompt it has not taken up yet (its hook has not moved the status).
    const queued = s.status === 'working' || s.status === 'needs_input' || s.chat.transcript.untakenCount() > 0
    // Its own id: the CLI says in `command_lifecycle` when it queues, begins and ends the prompt it names.
    const uuid = randomUUID()
    s.chat.transcript.userSent(content, queued, uuid)
    s.agent.prompt(content, s.conversationId, uuid)
  }

  /**
   * The person's answer to a request of the agent's. The tool is run with the input it asked with: the window may not
   * change it, except for the answers to the questions of `AskUserQuestion`.
   */
  answer(sessionId: string, requestId: string, answer: ChatAnswer): void {
    const s = this.live(sessionId)
    const ask = s?.asks.get(requestId)
    if (!s || !ask || typeof answer !== 'object' || answer === null) return
    if (answer.allow !== true) return this.respond(s, requestId, { behavior: 'deny', message: typeof answer.message === 'string' && answer.message.trim() !== '' ? answer.message : DENIED })
    const answers = ask.toolName === 'AskUserQuestion' ? answersOf(answer.updatedInput, questionTexts(ask.input)) : undefined
    const input = answers ? { ...(typeof ask.input === 'object' && ask.input !== null ? ask.input : {}), answers } : ask.input
    // "Allow for this session": the rules the CLI suggested, as rules of this session and nothing else of what it suggested.
    const rules = answer.always === true ? sessionRules(ask.suggestions) : []
    this.respond(s, requestId, { behavior: 'allow', updatedInput: input, ...(rules.length > 0 ? { updatedPermissions: rules } : {}) })
  }

  private respond(s: Session, requestId: string, response: AskAnswer): void {
    // Before the CLI is told: an allowed call may write as soon as it hears.
    const toolUseId = s.asks.get(requestId)?.toolUseId
    if (toolUseId !== undefined) this.writes[response.behavior === 'allow' ? 'allowed' : 'refused'](s.id, toolUseId)
    s.asks.delete(requestId)
    s.agent.answer(requestId, response)
    s.chat.transcript.answered(requestId, response.behavior === 'allow' ? 'allowed' : 'denied', response.behavior === 'allow' ? answersText(response.updatedInput) : response.message)
    if (s.asks.size === 0) this.advance(s, 'answered')
  }

  /** The turn at work is stopped. The prompts queued behind it are kept: the CLI runs them after it. */
  async interrupt(sessionId: string): Promise<void> {
    const s = this.live(sessionId)
    if (!s) throw new Error('This session has ended')
    const answer = s.agent.interrupt()
    // A turn at work that ends in error after this was Stopped, whether or not the CLI said so in words.
    if (s.status === 'working' || s.status === 'needs_input') s.chat.transcript.interruptAsked()
    await answer
  }

  /** The model of this session, from its next turn on. */
  async setModel(sessionId: string, model: string): Promise<void> {
    if (typeof model !== 'string' || !MODEL_NAME.test(model)) throw new Error('That is not a model')
    await this.control(sessionId, { subtype: 'set_model', model })
  }

  /** A session's effort, for the session alone (`apply_flag_settings`, held in the CLI's memory, as `--effort` is). */
  async setEffort(sessionId: string, effort: Effort): Promise<void> {
    if (!isEffort(effort)) throw new Error('That is not an effort')
    const s = await this.control(sessionId, { subtype: 'apply_flag_settings', settings: { effortLevel: effort } })
    s.chat.transcript.effortSet(effort)
  }

  /** A session's permission mode, for the session alone (`set_permission_mode`): no settings file is written. */
  async setMode(sessionId: string, mode: Mode): Promise<void> {
    if (!isMode(mode)) throw new Error('That is not a mode')
    const s = await this.control(sessionId, { subtype: 'set_permission_mode', mode })
    s.chat.transcript.modeSet(mode)
  }

  /** A request of ours to a live session's agent, resolved with the session once the agent has taken it. */
  private async control(sessionId: string, request: { subtype: string; [key: string]: unknown }): Promise<Session> {
    const s = this.live(sessionId)
    if (!s) throw new Error('This session has ended')
    await s.agent.control(request)
    return s
  }

  /**
   * A session's transcript so far, with the log of the conversation it resumed: all that a window needs to draw it,
   * whenever it asks (it was reloaded). What is told after this (`item`, `meta`) has a `seq` above this one's.
   * Readable after the session has ended, until another starts in that project.
   */
  history(sessionId: string): ChatHistory | undefined {
    const r = this.records.get(sessionId)
    if (!r) return undefined
    const { commands, models } = r.capabilities ?? { commands: [], models: [] }
    return { items: r.transcript.items(), meta: r.transcript.meta(), earlier: r.earlier, commands, models: modelsOf(models), seq: r.seq }
  }

  /**
   * The agent's stdin ends and it leaves by itself; one that does not is asked to, then killed, with what it started.
   * Resolves once it has gone and what it said is written.
   */
  stop(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) return Promise.resolve()
    if (!s.killTimer) {
      const agent = s.agent
      // One at work is interrupted first, so that it does not run its turn out (or its tools) before it goes.
      if (s.status === 'working' || s.status === 'needs_input') agent.interrupt(1000).catch(() => undefined)
      agent.end()
      s.termTimer = setTimeout(() => agent.terminate(), TERM_AFTER_MS)
      s.killTimer = setTimeout(() => agent.kill(), 2 * TERM_AFTER_MS)
    }
    return s.exited
  }

  /** Whether any agent is there or on its way: one that has not gone yet, or one that is being started. */
  get busy(): boolean {
    return this.sessions.size > 0 || this.starting.size > 0
  }

  /**
   * Ends the sessions there are now, and those that are being started now, once they are there. Not one that
   * is started while this waits: that one is of whatever was opened meanwhile.
   */
  async stopAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    for (const begun of await Promise.allSettled([...this.starting.values()])) {
      if (begun.status === 'fulfilled' && 'sessionId' in begun.value) ids.push(begun.value.sessionId)
    }
    await Promise.all(ids.map((id) => this.stop(id)))
  }

  /** For a quit that will wait no longer: every agent there still is, and what it started, ends now. */
  killAll(): void {
    for (const s of this.sessions.values()) {
      s.agent.kill()
      endGroup(s.pid)
    }
  }

  /** A session that is running and has not been told to end. */
  private live(sessionId: string): Session | undefined {
    const s = this.sessions.get(sessionId)
    return s && !s.killTimer ? s : undefined
  }

  /** A session that has gone: its token opens nothing any more, and the files it was given are removed. */
  private release(session: Pick<Session, 'token' | 'files'>): void {
    this.deps.http.revoke(session.token)
    for (const file of session.files) rmSync(file, { force: true })
  }

  private debug(line: string): void {
    this.deps.debug?.(this.deps.http.redact(line))
  }

  /** What the agent of a chat session tells: it moves the status, and goes to whoever listens. */
  private follow(session: Session, agent: AgentTransport, ended: () => void): void {
    const redact = this.deps.http.redact
    agent.on('message', (message) => {
      session.activity += 1
      session.heard = true
      this.advance(session, 'output')
      // The CLI gave up a request of its own (the turn was stopped while a card was open): it is not to be answered.
      if (message.type === 'control_cancel_request' && typeof message.request_id === 'string') this.cancelAsk(session, message.request_id)
      if (message.type === 'result') {
        // Whatever is still asked when a turn is over is asked no more.
        for (const requestId of [...session.asks.keys()]) this.cancelAsk(session, requestId)
        // After the microtasks of this read, so that the answer to an interrupt that came in the same chunk has been
        // taken into account (`control`).
        queueMicrotask(() => this.afterResult(session))
        this.writes.over(session.id)
      }
      // A call's result ends it however it ended: one that failed, or that the CLI denied by itself, has no `PostToolUse`.
      for (const result of toolResults(message)) this.writes.ended(session.id, result.id, result.ok)
      session.chat.transcript.message(message)
    })
    agent.on('ask', (request) => {
      session.activity += 1
      session.asks.set(request.requestId, request)
      if (request.toolUseId !== undefined) this.writes.waits(session.id, request.toolUseId)
      session.chat.transcript.asked(request)
      this.advance(session, 'ask')
    })
    agent.on('stderr', (text) => {
      // What the CLI says about itself, for the person should it stop: the last lines, with no address in them.
      session.stderr.push(...text.split('\n').map((line) => redact(line.trim()).slice(0, 500)).filter((line) => line !== ''))
      if (session.stderr.length > STDERR_LINES) session.stderr.splice(0, session.stderr.length - STDERR_LINES)
    })
    agent.on('note', (text) => {
      this.debug(`session ${session.id} stream: ${text}`)
    })
    agent.on('exit', (code, signal) => {
      // Asked for by pino (`stop`), or not: told before the transcript closes, so that it reads before "The session ended".
      const asked = session.killTimer !== undefined
      // A session pino ends takes what the agent started with it: its group, whatever of it did not leave.
      if (asked) endGroup(session.pid)
      clearTimeout(session.killTimer)
      clearTimeout(session.termTimer)
      clearTimeout(session.graceTimer)
      this.sessions.delete(session.id)
      this.release(session)
      // Nobody can answer what the agent was waiting for any more.
      session.asks.clear()
      this.writes.over(session.id)
      if (!asked || (code !== null && code !== 0)) this.stoppedNote(session, code, signal)
      // What was open ends in a stated state, and the log has all of it before the session counts as gone.
      session.chat.transcript.ended()
      this.advance(session, 'exit')
      void session.logging.then(ended)
    })
    // Ready for a prompt once it has said what it can do; an agent that cannot say is still one that works.
    agent
      .control({ subtype: 'initialize' })
      .then((answer) => {
        const capabilities = capabilitiesOf(answer)
        const chat = session.chat
        chat.capabilities = capabilities
        chat.seq += 1
        const models = modelsOf(capabilities.models)
        void this.deps.models.heard(models)
        this.emit('capabilities', { sessionId: session.id, projectId: chat.projectId, commands: capabilities.commands, models, seq: chat.seq })
        this.advance(session, 'output')
      })
      .catch((e: Error) => {
        this.debug(`session ${session.id} initialize: ${e.message}`)
        // A CLI that left has its own note; one that stayed and did not answer is told of, quietly.
        if (this.sessions.get(session.id) === session && !session.killTimer) session.chat.transcript.note(`Claude Code did not say what it can do (${redact(e.message)}). The commands and the model menu may be missing.`, 'quiet')
      })
  }

  /** The CLI left when pino did not ask it to, or with an error: the person is told what it said last, and when it never began. */
  private stoppedNote(session: Session, code: number | null, signal: string | null): void {
    const transcript = session.chat.transcript
    const last = session.stderr.at(-1)
    const how = code !== null ? `exit code ${code}` : signal ? `signal ${signal}` : 'no exit code'
    transcript.note(`Claude Code stopped (${how})${last ? `: ${last}` : ''}`, 'warn')
    if (!session.heard) transcript.note(DID_NOT_START, 'warn')
  }

  /** A request of the CLI's that waits for the person is given up: the card ends, and the status goes on from there. */
  private cancelAsk(session: Session, requestId: string): void {
    const toolUseId = session.asks.get(requestId)?.toolUseId
    if (!session.asks.delete(requestId)) return
    if (toolUseId !== undefined) this.writes.cancelled(session.id, toolUseId)
    session.chat.transcript.cancelled(requestId)
    if (session.asks.size === 0) this.advance(session, 'answered')
  }

  /**
   * A `result` is the end of what the CLI was doing. Idle, unless it has prompts it has not begun on: those may be
   * about to (their hook, or their `init`, is on its way), and a moment is given them. Should nothing come in that
   * moment, the CLI is idle and they were taken up without a sign pino could read: they are no longer waiting.
   */
  private afterResult(session: Session): void {
    const transcript = session.chat.transcript
    if (this.sessions.get(session.id) !== session) return
    clearTimeout(session.graceTimer)
    if (transcript.untakenCount() === 0) return this.advance(session, 'Stop')
    const arm = (seen: number): void => {
      session.graceTimer = setTimeout(() => {
        if (this.sessions.get(session.id) !== session) return
        // Something else happened inside the moment: look again after another, for as long as prompts are untaken.
        if (session.activity !== seen) return transcript.untakenCount() > 0 ? arm(session.activity) : undefined
        transcript.idle()
        this.advance(session, 'Stop')
      }, IDLE_GRACE_MS)
      session.graceTimer.unref?.()
    }
    arm(session.activity)
  }

  /**
   * The items of a chat session that became final go to the log of the conversation they were said in, one write
   * after another. A log that cannot be written is said once and not tried again for this session: the chat goes on.
   */
  private log(session: Session): void {
    if (session.logFailed) return
    const items = session.chat.transcript.toLog()
    if (items.length === 0) return
    const conversation = session.conversationId
    session.logging = session.logging
      .then(() => appendItems(session.project.dir, conversation, items, this.deps.http.redact))
      .catch((e: Error) => {
        session.logFailed = true
        console.error(`cannot write the chat log of ${session.project.id}: ${e.message}`)
      })
  }

  private emit<E extends keyof Events>(event: E, message: Events[E]): void {
    // A listener that throws is logged and does not keep the others, or the stream that feeds it, from going on.
    for (const cb of this.listeners[event]) {
      try {
        cb(message)
      } catch (e) {
        console.error(`a listener of ${event} threw: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  private advance(session: Session, event: string, body?: unknown): void {
    const next = reduceStatus(session.status, event, body)
    if (next === session.status) return
    session.status = next
    this.emit('status', { sessionId: session.id, projectId: session.project.id, status: next })
  }

  /** `POST /hooks/<sessionId>/<event>`, with the hook's JSON as the body (the router let it through only with that session's token); `rest` is what comes after `/hooks`. */
  private async hook(req: IncomingMessage, res: ServerResponse, rest: string[]): Promise<void> {
    const [sessionId, event] = rest
    const session = rest.length === 2 ? this.sessions.get(sessionId) : undefined
    if (!session) return sendJson(res, 404, { error: 'no such session' })
    // Only what the agent posts: `exit` and `output` are the transport's to say, and would end a live session.
    if (!HOOK_EVENTS.includes(event)) return sendJson(res, 404, { error: 'no such hook' })
    session.activity += 1
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' })

    // A tool hook says that the agent is at work. Its body is the tool's input or result, which may be megabytes:
    // it is read to see what the tool would write or has written, and is never a reason to refuse the hook.
    if (TOOL_EVENTS.has(event)) {
      this.advance(session, event)
      this.debug(`session ${session.id} hook ${event}`)
      let tool: Record<string, unknown> = {}
      try {
        const parsed: unknown = JSON.parse(await readBody(req, TOOL_BODY_LIMIT))
        if (typeof parsed === 'object' && parsed !== null) tool = parsed as Record<string, unknown>
      } catch {
        return sendJson(res, 200, {})
      }
      const name = typeof tool.tool_name === 'string' ? tool.tool_name : ''
      const toolUseId = typeof tool.tool_use_id === 'string' ? tool.tool_use_id : undefined
      if (event === 'PostToolUse') {
        if (toolUseId !== undefined) this.writes.ended(session.id, toolUseId, true)
        return sendJson(res, 200, {})
      }
      const reason = refusalOf(session.project.dir, name, tool.tool_input)
      if (reason) return sendJson(res, 200, deniedAnswer(reason))
      // Kept before the hook is answered: the tool runs only after.
      if (toolUseId !== undefined) {
        const turn = this.turnOf(session)
        this.writes.began({ session: session.id, project: session.project.id, dir: session.project.dir, id: toolUseId, tool: name, input: tool.tool_input, ...(turn ? { turn } : {}) })
      }
      return sendJson(res, 200, {})
    }

    let body: unknown
    try {
      body = JSON.parse(await readBody(req, HOOK_BODY_LIMIT))
    } catch (e) {
      if (e instanceof BodyTooLarge) return sendJson(res, 413, { error: e.message })
      return sendJson(res, 400, { error: 'the body is not JSON' })
    }
    const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}

    // The agent starts another conversation on /clear; the one to resume is the latest that was asked something.
    // Claude Code names a conversation in every hook, also in the SessionEnd of one nothing was asked in, and that
    // one it cannot resume. Not for a session that has been told to end: its project may have a new session by
    // now, whose conversation is the one to resume.
    const conversation = fields.session_id
    if (!session.killTimer && CONVERSATION_EVENTS.has(event) && typeof conversation === 'string' && UUID.test(conversation)) {
      session.conversationId = conversation
      // On file before the hook is answered: whoever sees the answer can resume. In the line of the session's writes,
      // so that nothing of it is still being written once the session counts as gone.
      session.logging = session.logging
        .then(() => storeConversation(session.project.dir, conversation))
        .catch((e) => console.error(`cannot write ${join(session.project.dir, FOLDER, SESSION_FILE)}: ${(e as Error).message}`))
      await session.logging
    }

    // A Stop held back is no end of the turn: the agent goes on, and so does its status.
    if (event === 'Stop' && !session.killTimer) {
      const held = await this.deps.domain.stopAnswer(session.project, session.chat.transcript.answering()).catch((e: unknown) => {
        console.error(`no answer to the Stop in ${session.project.id}: ${e instanceof Error ? e.message : String(e)}`)
        return null
      })
      if (held) {
        this.debug(`session ${session.id} hook ${event}, held back: ${held.reason}`)
        return sendJson(res, 200, held)
      }
    }
    // A SessionEnd is not the end of the session: on /clear the agent carries on in another conversation, and when
    // it does leave, the exit of its process says so. Until then the session is still the one of its project.
    if (event !== 'SessionEnd') this.advance(session, event, fields)
    if (event !== 'UserPromptSubmit') {
      this.debug(`session ${session.id} hook ${event}`)
      return sendJson(res, 200, {})
    }

    const prompt = typeof fields.prompt === 'string' ? fields.prompt : undefined
    // The prompt goes ahead without it rather than wait for the hook to time out.
    const context = await this.deps.domain.promptContext(session.project, prompt ?? '').catch((e: unknown) => {
      console.error(`no context for the prompt in ${session.project.id}: ${e instanceof Error ? e.message : String(e)}`)
      return { text: '', sentMarkIds: [], delivered: undefined }
    })
    const { text, sentMarkIds } = context
    // Said even when nothing is added: it is how the transcript knows the CLI took the prompt up.
    session.chat.transcript.context({ text, sentMarkIds, ...(prompt !== undefined ? { prompt } : {}) })
    this.debug(`session ${session.id} hook ${event}${text ? `, answered with: ${text}` : ''}`)
    sendJson(res, 200, text ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } } : {})
    // The agent has the context now.
    await context.delivered?.().catch((e: unknown) => console.error(`after the prompt in ${session.project.id}: ${e instanceof Error ? e.message : String(e)}`))
  }
}

/** The calls a `user` message of the stream carries the results of: each is over, and failed when its result is an error. */
function toolResults(message: { type?: unknown; message?: unknown }): Array<{ id: string; ok: boolean }> {
  if (message.type !== 'user') return []
  const content = (message.message as { content?: unknown } | null | undefined)?.content
  return (Array.isArray(content) ? content : []).flatMap((block) => {
    const { type, tool_use_id: id, is_error: failed } = (block ?? {}) as { type?: unknown; tool_use_id?: unknown; is_error?: unknown }
    return type === 'tool_result' && typeof id === 'string' ? [{ id, ok: failed !== true }] : []
  })
}

/** What `initialize` answered, read for the commands and models it names, and nothing else. */
function capabilitiesOf(answer: unknown): Capabilities {
  const { commands, models } = (typeof answer === 'object' && answer !== null ? answer : {}) as { commands?: unknown; models?: unknown }
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  return {
    commands: (Array.isArray(commands) ? commands : [])
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null && typeof (c as { name?: unknown }).name === 'string')
      .map((c) => ({ name: text(c.name), description: text(c.description), argumentHint: text(c.argumentHint) })),
    models: Array.isArray(models) ? models : []
  }
}

/** What the agent is told when the person denied a request and said nothing more. */
const DENIED = 'The person denied this.'

/** The answers to the questions of an `AskUserQuestion`, a text for each question, from what the window sent. */
function answersOf(input: unknown, questions: readonly string[]): Record<string, string> | undefined {
  const answers = typeof input === 'object' && input !== null ? (input as { answers?: unknown }).answers : undefined
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) return undefined
  const entries = Object.entries(answers)
  if (!entries.every(([, v]) => typeof v === 'string')) return undefined
  // Only what answers a question that was asked.
  return Object.fromEntries((entries as Array<[string, string]>).filter(([question]) => questions.includes(question)))
}

/** The texts of the questions of an `AskUserQuestion` input. */
function questionTexts(input: unknown): string[] {
  const list = typeof input === 'object' && input !== null ? (input as { questions?: unknown }).questions : undefined
  return (Array.isArray(list) ? list : []).flatMap((q) => (typeof (q as { question?: unknown } | null)?.question === 'string' ? [(q as { question: string }).question] : []))
}

/** What the person answered, in a line for each question; nothing for a tool that has no questions. */
function answersText(input: unknown): string | undefined {
  const answers = answersOf(input, questionTexts(input))
  return answers ? Object.entries(answers).map(([question, answer]) => `${question}: ${answer}`).join('\n') : undefined
}

/** What the log holds of a conversation pino resumes, and a note that what was said in a terminal is not in it. */
async function earlierOf(dir: string, conversationId: string): Promise<ChatItem[]> {
  const logged = await readLog(dir, conversationId)
  const text = logged.length > 0 ? 'Turns made in a terminal are not shown here.' : 'This conversation was begun in a terminal: its earlier turns are not shown here.'
  return [...logged, { kind: 'note', id: 'earlier-note', text, tone: 'quiet' }]
}

/** A signal to the group the agent led, for what it started and left behind. Never the bare pid, which may be another's by now. */
function endGroup(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 1) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Nothing is left of it.
  }
}
