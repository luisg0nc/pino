// Everything the renderer may ask of main, and the types both sides share for it.

import type { ArtifactName, BuildResult, BuildState } from './build'
import type { CardsFile, FabAsk, PartReading, PersonChange } from './cards'
import type { SizeFact } from './size'
import type { ConnectionRow, PartHad, PowerRow } from './slots'
import type { Seen } from './brief'
import type { AgentChoice, ChatAnswer, ChatCommand, ChatHistory, ChatItem, ChatMeta, ChatModel, Effort, Mode, PromptRow } from './chat'
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

/** What the New project page asks for at Start or "Make it without starting Claude": the new project and everything given. */
export interface CreateRequest {
  name: string
  description: string
  /**
   * Files on the disk (from a drop or main's dialog), copied into `reference/` as `photo-<n>.<ext>`. Or, for a
   * picture that has no file (a screenshot pasted from the clipboard), the PNG the window scaled.
   */
  photos: Array<{ path: string; note: string } | { png: Uint8Array; note: string }>
  /** Drawings as PNG bytes: `reference/doodle-<n>.png`. `over` is the index into `photos` of the photo it is drawn over. */
  doodles: Array<{ png: Uint8Array; note: string; over?: number; /** The photo it was drawn over is no longer among the photos: the picture still has it under the ink. */ onPhoto?: true }>
  /** PDF files (at most 6, 25 MB each, starting `%PDF-`), copied into `reference/` under their own names (`referenceFiles`). */
  pdfs: Array<{ path: string; note: string }>
  /** The PCB slots and the rest become cards of the person's, never written into `brief.md`. */
  power: PowerRow[]
  connections: ConnectionRow[]
  sizes: SizeFact[]
  /** "Fits an enclosure" and the edge a connector must sit on; empty when not said. */
  enclosure: string
  edges: string
  /** The parts the person has. A part's stock reading is main's, never given here. */
  parts: PartHad[]
  /** What the person asks of the fab; null when the slot was not opened. */
  fab: FabAsk | null
  rules: string
  /** Links (`http`, `https`; at most 20), never opened by pino on its own. */
  links: Array<{ url: string; note: string }>
}

/**
 * What the New project page hands main once the project is made and open (`project.onboard`): the slots it was made
 * from, for the first prompt. The pictures are the window's, scaled to a long edge of 1280 px.
 */
export interface OnboardDraft extends Pick<CreateRequest, 'description' | 'power' | 'connections' | 'sizes' | 'enclosure' | 'edges' | 'parts' | 'fab' | 'rules' | 'links'> {
  /** The photos, then the doodles, as `create` named them. A doodle drawn over a photo has `over`: the prompt reads that, never the note's words. */
  items: Array<{ file: string; note: string; image?: Uint8Array; over?: true }>
  /** The PDFs, as `create` named them in `reference/` (`referenceFiles`). */
  pdfs: Array<{ file: string; note: string }>
  /** The model and effort to start the session on, for it alone; absent, or what is not one: the person's own default. */
  choice?: AgentChoice
}

/** A draft as `project.previewPrompt` takes it: what the prompt says of it, and no picture data (`hasImage`: the window holds one fit to attach). */
export interface PromptPreviewDraft extends Omit<OnboardDraft, 'items' | 'choice'> {
  items: Array<{ file: string; note: string; hasImage: boolean; over?: true }>
}

/** The first prompt of a draft as it would be sent. `attached[i]` is the number of the picture of `items[i]` in it, none when it is named only. */
export interface PromptPreview {
  text: string
  attached: Array<number | null>
}

/** What came of `project.onboard`. The project is made and open whatever it says. */
export interface Onboarded {
  /** The chat session started in the project; null when it could not be (then `problem` says why). */
  sessionId: string | null
  /** The text of the first prompt as it was (or would have been) sent, with its pictures. */
  prompt: string
  /** The same text for a later session when the prompt was not sent: it does not say that pictures are attached. */
  held: string
  problem?: string
}

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
    /** Makes a new project in the open workspace, whole or not at all, and opens it. Rejects with why it could not. */
    create(req: CreateRequest): Promise<ProjectInfo>
    /** The photo dialog (several images); [] when cancelled. Under test, what the `pickFiles` hook holds. */
    pickPhotos(): Promise<string[]>
    /** The dialog for a PDF; null when cancelled. Under test, the first PDF of `pickFiles`. */
    pickPdf(): Promise<string | null>
    /** The bytes of an image the dialog gave, for its thumbnail and the copy the first prompt carries. No other path. */
    readPhoto(path: string): Promise<Uint8Array>
    /** The path of a dropped file; empty for one that is no file on the disk. */
    pathOf(file: File): string
    /** Every name in the open workspace's folder, which a new project's name is checked against. */
    taken(): Promise<string[]>
    /**
     * Starts the chat session of the open project, made just now, and sends its first prompt (text and up to 6
     * pictures). Rejects for a project that is not open or has a session. A session that cannot be started is not a
     * rejection: `sessionId` is null and the prompt comes back to be kept.
     */
    onboard(projectId: string, draft: OnboardDraft): Promise<Onboarded>
    /** The first prompt `onboard` would send for this draft, with the project named `name`; writes and starts nothing. */
    previewPrompt(name: string, draft: PromptPreviewDraft): Promise<PromptPreview>
    /** The picture on file of a project the open workspace lists, as a PNG's bytes; null when there is none. */
    thumb(name: string): Promise<Uint8Array | null>
    /** A picture of the open project's newest good build, by its hash, which main keeps. Anything else is dropped. */
    saveThumb(projectId: string, hash: string, png: Uint8Array): Promise<void>
  }
  parts: {
    /** A part's stock as JLC has it, checked through the engine as the `parts` tool does; or why it was not checked. */
    lookup(lcsc: string): Promise<{ reading: PartReading } | { refused: string }>
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
    /** The open project's prompts, oldest first, numbered across all its conversations. */
    prompts(projectId: string): Promise<PromptRow[]>
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
    /** What the person had seen of Claude's cards when they last had the Brief on screen; null for a first time. */
    seen(projectId: string): Promise<Seen | null>
    /** The person has seen the Brief as it is now. */
    markSeen(projectId: string): Promise<Seen>
    /** Has main look a part card's number up again and keep the new reading. Rejects with why the stock was not checked. */
    restock(projectId: string, cardId: string): Promise<CardsFile>
    onChanged(cb: (m: { projectId: string; file: CardsFile }) => void): () => void
    onBriefChanged(cb: (m: { projectId: string }) => void): () => void
  }
  notices: {
    /** Something main has to say that no call asked for: a folder it may not write into. */
    onNotice(cb: (m: { text: string }) => void): () => void
  }
}
