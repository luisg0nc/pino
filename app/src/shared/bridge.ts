// Everything the renderer may ask of main, and the types both sides share for it.

import type { ArtifactName, BuildResult, BuildState } from './build'
import type { ChatAnswer, ChatCommand, ChatHistory, ChatItem, ChatMeta, ChatModel, Effort, Mode } from './chat'
import type { FabProfile, FabState, Readiness } from './fab'
import type { Mark, MarkPatch, NewMark } from './marks'
import type { ProjectInfo, RecentFolder } from './project'
import type { EngineInfo } from './ready'
import type { BoardLook, LookRequest, LookResult, Selection, ViewTab } from './view'

/** `chat`: Claude Code run headless, drawn by pino. `terminal`: as a terminal would run it; pino has no such view yet. */
export type AgentView = 'chat' | 'terminal'

export type SessionStatus = 'starting' | 'idle' | 'working' | 'needs_input' | 'exited'

/** What a start answers with: the session as it stands, or why there is none, with what the person may say to that. */
export type StartResult =
  | { sessionId: string; status: SessionStatus }
  | { refused: string; question?: { kind: 'trust'; files: string[] } }

/** `window.pino`, as the preload script exposes it. The channels are those of `main/ipc.ts`. */
export interface PinoBridge {
  /** The person's home folder, which the chat writes as `~`. */
  home: string
  project: {
    /** Asks the person for a folder and opens it; null when they choose none. */
    pick(): Promise<ProjectInfo | null>
    /** Opens a folder as the project, ending the session of the one that was open. Rejects with why it cannot. */
    open(dir: string): Promise<ProjectInfo>
    /** The project that is open. Rejects, once, with why the folder pino was started with could not be opened. */
    current(): Promise<ProjectInfo | null>
    recent(): Promise<RecentFolder[]>
    /** Ends the project's session and leaves the first screen. */
    close(): Promise<void>
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    onMaximized(cb: (max: boolean) => void): () => void
  }
  session: {
    /** The project's running session, if any, and whether a conversation can be resumed. */
    current(projectId: string): Promise<{ running: { sessionId: string; status: SessionStatus } | null; resumable: boolean }>
    /** Starts Claude Code in the project's folder; answers with the session already running there, if any. */
    start(projectId: string, opts?: { resume?: boolean }): Promise<StartResult>
    /** The person said to start the chat in a folder that has Claude Code settings of its own: remembered in pino's own data. */
    trust(projectId: string): Promise<void>
    stop(sessionId: string): Promise<void>
    onStatus(cb: (m: { sessionId: string; status: SessionStatus }) => void): () => void
  }
  chat: {
    /** Everything the window needs to draw a session, whenever it asks; readable also after it ended, until another starts. */
    history(sessionId: string): Promise<ChatHistory>
    /** The end of the conversation the project's next session would resume, or null when there is none. */
    lastConversation(projectId: string): Promise<{ items: ChatItem[]; at: string | null } | null>
    send(sessionId: string, prompt: { text: string }): Promise<void>
    /** Answers a request of the agent's. The tool runs with the input it asked with; only the answers of `AskUserQuestion` are taken from the window. */
    answer(sessionId: string, requestId: string, answer: ChatAnswer): void
    interrupt(sessionId: string): Promise<void>
    /** For this session only, as the next two: the person's settings are not written. */
    setModel(sessionId: string, model: string): Promise<void>
    setMode(sessionId: string, mode: Mode): Promise<void>
    setEffort(sessionId: string, effort: Effort): Promise<void>
    /** The models a session can be started on before it has said its own. */
    models(): Promise<ChatModel[]>
    /** An item of the transcript was added or changed. One whose `seq` is not above that of the history asked for before holds nothing new. */
    onItem(cb: (m: { sessionId: string; item: ChatItem; seq: number }) => void): () => void
    onMeta(cb: (m: { sessionId: string; meta: ChatMeta; seq: number }) => void): () => void
    onCapabilities(cb: (m: { sessionId: string; commands: ChatCommand[]; models: ChatModel[]; seq: number }) => void): () => void
  }
  build: {
    /** The build loop of the open project as it stands; null for a project that is not open. */
    state(projectId: string): Promise<BuildState | null>
    rebuild(projectId: string): Promise<void>
    /** The result of the build with this hash, which an older build's folder still holds. */
    result(projectId: string, hash: string): Promise<BuildResult>
    /** A file of the build with this hash: text, or the 3D model's bytes. Only what that build's result lists. */
    file(projectId: string, hash: string, name: ArtifactName): Promise<string | Uint8Array>
    /** A file of the route with this key: text, and the model's bytes. */
    routeFile(projectId: string, key: string, name: 'board' | 'filled' | 'route' | 'glb'): Promise<string | Uint8Array>
    onState(cb: (s: BuildState) => void): () => void
    /** Whether Claude Code, KiCad and the engine are here; asked once a run. */
    engineInfo(): Promise<EngineInfo>
  }
  view: {
    /** What the window shows, so that Claude can be told what the person sees. */
    tell(projectId: string, view: { tab: ViewTab; look: BoardLook; selection: Selection | null }): Promise<void>
    /** Main asks for something only the window can make: a picture for Claude's `look`. Answered once, by id. */
    onAsk(cb: (m: { id: number; kind: 'look'; req: LookRequest }) => void): () => void
    answer(id: number, result: LookResult | { error: string }): void
  }
  route: {
    /** The band's "Route again": routes the newest build in the background. */
    start(projectId: string): Promise<void>
    cancel(projectId: string): Promise<void>
  }
  fab: {
    /** The release of the open project as main holds it; null for a project that is not open. */
    state(projectId: string): Promise<FabState | null>
    /** Whether a release would go through, and what it would be called. */
    readiness(projectId: string): Promise<Readiness>
    /** The status line's "Make fab files": its steps and its end come through onState. */
    release(projectId: string): Promise<void>
    cancel(projectId: string): Promise<void>
    /** The fab's limits for every profile the engine builds; none from an engine without fab files. */
    profiles(): Promise<FabProfile[]>
    /** Shows the newest release's folder in the file manager. */
    showFolder(projectId: string): Promise<void>
    onState(cb: (s: FabState) => void): () => void
  }
  marks: {
    list(projectId: string): Promise<Mark[]>
    /** A mark of the person's, a draft until it goes with a prompt. Main works out its id, label and exact line. */
    add(projectId: string, mark: NewMark): Promise<Mark>
    update(projectId: string, id: string, patch: MarkPatch): Promise<Mark>
    remove(projectId: string, id: string): Promise<void>
    resolve(projectId: string, id: string, note: string): Promise<Mark>
    onChange(cb: (m: { projectId: string; marks: Mark[] }) => void): () => void
  }
  notices: {
    /** Something main has to say that no call asked for: a folder it may not write into. */
    onNotice(cb: (m: { text: string }) => void): () => void
  }
}
