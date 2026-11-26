import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { ProjectInfo, RecentFolder } from '../shared/project'
import { lastConversation } from './sessions/chatlog'
import type { Sessions } from './sessions/manager'
import type { KnownModels } from './sessions/models'
import { storedConversation } from './sessions/resume'
import type { Trust } from './trust'

// The channels the window may ask on (src/preload/index.ts, `shared/bridge.ts`):
//   invoked: project:pick, project:open, project:current, project:recent, project:close,
//            session:current, session:start, session:trust, session:stop,
//            chat:history, chat:lastConversation, chat:send, chat:interrupt, chat:setModel, chat:setMode,
//            chat:setEffort, chat:models
//   sent:    chat:answer, window:minimize, window:toggleMaximize, window:close
//   to the window: session:status, chat:item, chat:meta, chat:capabilities, notice, window:maximized (index.ts)
// What the window names (a project, a session) is not taken at its word: a project must be the one that is open.

/** What main holds of the open project, as the window may ask for it. */
export interface Projects {
  /** The project that is open. */
  open(): ProjectInfo | undefined
  pick(): Promise<ProjectInfo | null>
  openAt(dir: string): Promise<ProjectInfo>
  /** The open project; rejects once with why the folder pino was started with could not be opened. */
  current(): Promise<ProjectInfo | null>
  recent(): Promise<RecentFolder[]>
  close(): Promise<void>
}

export interface IpcDeps {
  projects: Projects
  sessions: Sessions
  trust: Trust
  models: KnownModels
}

/** Sends a message to the window, if there is one to hear it. */
export function broadcast(channel: string, message: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, message)
  }
}

export function registerIpc({ projects, sessions, trust, models }: IpcDeps): void {
  /** Only a page of one of pino's own windows is heard: the one local page, and its main frame. */
  const ours = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win !== null && event.senderFrame === event.sender.mainFrame
  }
  const handle = (channel: string, listener: (...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!ours(event)) throw new Error('not heard')
      return listener(...args)
    })
  }
  const projectOf = (id: unknown): ProjectInfo | undefined => {
    const open = projects.open()
    return open && open.id === id ? open : undefined
  }
  const mustBeOpen = (id: unknown): ProjectInfo => {
    const project = projectOf(id)
    if (!project) throw new Error('That project is not open')
    return project
  }

  handle('project:pick', () => projects.pick())
  handle('project:open', (dir: unknown) => projects.openAt(String(dir)))
  handle('project:current', () => projects.current())
  handle('project:recent', () => projects.recent())
  handle('project:close', () => projects.close())

  handle('session:current', (id: unknown) => {
    const project = projectOf(id)
    if (!project) return { running: null, resumable: false }
    return { running: sessions.current(project.id), resumable: sessions.resumable(project) }
  })
  handle('session:start', (id: unknown, opts?: { resume?: unknown }) => sessions.start(mustBeOpen(id), { resume: opts?.resume === true }))
  handle('session:trust', (id: unknown) => trust.accept(mustBeOpen(id).dir))
  handle('session:stop', (sessionId: unknown) => sessions.stop(String(sessionId)))

  handle('chat:history', (sessionId: unknown) => {
    const history = sessions.history(String(sessionId))
    if (!history) throw new Error('That conversation is no longer held')
    return history
  })
  handle('chat:lastConversation', async (id: unknown) => {
    const project = projectOf(id)
    const conversation = project ? storedConversation(project.dir) : null
    return project && conversation ? lastConversation(project.dir, conversation) : null
  })
  handle('chat:send', (sessionId: unknown, prompt: { text?: unknown }) => sessions.send(String(sessionId), { text: String(prompt?.text ?? '') }))
  handle('chat:interrupt', (sessionId: unknown) => sessions.interrupt(String(sessionId)))
  // The manager holds each to its rule before the CLI is asked.
  handle('chat:setModel', (sessionId: unknown, model: string) => sessions.setModel(String(sessionId), model))
  handle('chat:setMode', (sessionId: unknown, mode: Parameters<Sessions['setMode']>[1]) => sessions.setMode(String(sessionId), mode))
  handle('chat:setEffort', (sessionId: unknown, effort: Parameters<Sessions['setEffort']>[1]) => sessions.setEffort(String(sessionId), effort))
  handle('chat:models', () => models.list())
  ipcMain.on('chat:answer', (event, sessionId: unknown, requestId: unknown, answer: Parameters<Sessions['answer']>[2]) => {
    if (ours(event)) sessions.answer(String(sessionId), String(requestId), answer)
  })

  sessions.on('status', (m) => broadcast('session:status', { sessionId: m.sessionId, status: m.status }))
  sessions.on('item', (m) => broadcast('chat:item', { sessionId: m.sessionId, item: m.item, seq: m.seq }))
  sessions.on('meta', (m) => broadcast('chat:meta', { sessionId: m.sessionId, meta: m.meta, seq: m.seq }))
  sessions.on('capabilities', (m) => broadcast('chat:capabilities', { sessionId: m.sessionId, commands: m.commands, models: m.models, seq: m.seq }))
}
