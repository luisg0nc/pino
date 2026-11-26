// Everything the renderer may ask of main, and the types both sides share for it.

import type { ArtifactName, BuildResult, BuildState } from './build'
import type { CardsFile, PersonChange } from './cards'
import type { ChatAnswer, ChatCommand, ChatHistory, ChatItem, ChatMeta, ChatModel, Effort, Mode } from './chat'
import type { FabProfile, FabState, Readiness } from './fab'
import type { Mark, MarkPatch, NewMark } from './marks'
import type { ProjectInfo, RecentFolder } from './project'
import type { EngineInfo } from './ready'
import type { BoardLook, LookRequest, LookResult, PaneTab, Selection } from './view'
import type { OpenFolder, WorkspaceInfo } from './workspace'

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
  workspace: {
    /** What is open. Rejects, once, with why the folder pino was started with could not be opened. */
    current(): Promise<{ workspace: WorkspaceInfo | null; project: ProjectInfo | null }>
    /** Asks the person for a folder and opens it: a board's folder opens its parent, on that board. Null when they choose none. */
    pick(): Promise<OpenFolder | null>
    /** Opens a folder of boards, ending the session of the project that was open. Rejects with why it cannot. */
    open(root: string): Promise<WorkspaceInfo>
    /** The folder of boards suggested on a first run, `~/boards`, and whether it is there. */
    suggested(): Promise<{ path: string; exists: boolean }>
    /** Makes the suggested folder if it is not there, and opens it. */
    useSuggested(): Promise<WorkspaceInfo>
    recent(): Promise<RecentFolder[]>
    /** The open workspace listed again. */
    list(): Promise<WorkspaceInfo>
  }
  project: {
    /** Opens a project the workspace lists, ending the session of the one that was open. Rejects with why it cannot. */
    open(name: string): Promise<ProjectInfo>
    /** Ends the project's session and leaves the page of projects. */
    close(): Promise<void>
    /** The picture on file of a project the open workspace lists, as a PNG's bytes; null when there is none. */
    thumb(name: string): Promise<Uint8Array | null>
    /** A picture of the open project's newest good build, by its hash, which main keeps. Anything else is dropped. */
    saveThumb(projectId: string, hash: string, png: Uint8Array): Promise<void>
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
    tell(projectId: string, view: { tab: PaneTab; look: BoardLook; selection: Selection | null }): Promise<void>
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
  /** The open project's Brief: its cards, `brief.md` and the files of `reference/`. Main alone writes the cards, and never `brief.md`. */
  cards: {
    read(projectId: string): Promise<CardsFile>
    /** A change of the person's. Rejects with why main refuses it. */
    change(projectId: string, change: PersonChange): Promise<CardsFile>
    /** The words of `brief.md`; null when there is none. */
    brief(projectId: string): Promise<string | null>
    /** The photos, doodles and PDFs of `reference/`, by name. */
    references(projectId: string): Promise<string[]>
    /** A photo's or a doodle's bytes; null when it may not be read. */
    reference(projectId: string, file: string): Promise<{ mediaType: string; bytes: Uint8Array } | null>
    /** Opens in the browser the `nth` web address of a card, or of `brief.md` when `cardId` is `brief`. */
    openLink(projectId: string, cardId: string, nth?: number): Promise<void>
    onChanged(cb: (m: { projectId: string; file: CardsFile }) => void): () => void
    onBriefChanged(cb: (m: { projectId: string }) => void): () => void
  }
  notices: {
    /** Something main has to say that no call asked for: a folder it may not write into. */
    onNotice(cb: (m: { text: string }) => void): () => void
  }
}
