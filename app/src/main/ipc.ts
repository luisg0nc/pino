import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { ArtifactName } from '../shared/build'
import type { MarkPatch, NewMark } from '../shared/marks'
import type { ProjectInfo } from '../shared/project'
import type { Opened } from './opened'
import { BUILD_HASH, readArtifact, readRouteFile, resultOfBuild, type RouteFile } from './artifacts'
import { saveThumbnail, thumbnailOnFile, thumbnailRefusal } from './thumb'
import type { Builds } from './builds'
import { type PersonChange, readingOf } from '../shared/cards'
import { listPrompts } from './sessions/prompts'
import { linkOf, listReferences, readReference } from './cards/references'
import type { CardStore } from './cards/store'
import { readBrief } from './cards/text'
import type { EngineInfo } from '../shared/ready'
import type { MarkStore } from './marks/store'
import type { Routing } from './routing'
import type { Fab } from './fab'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { CreateRequest } from '../shared/bridge'
import { createProject, readPhoto } from './projects/create'
import { Offered } from './projects/offered'
import { lookupPart, makeReadings } from './projects/readings'
import { lastConversation } from './sessions/chatlog'
import type { Sessions } from './sessions/manager'
import type { KnownModels } from './sessions/models'
import { storedConversation } from './sessions/resume'
import type { Trust } from './trust'
import { takeAnswer, type ViewHolder } from './view'

// The channels the window may ask on (src/preload/index.ts, `shared/bridge.ts`):
//   invoked: workspace:current, workspace:pick, workspace:open, workspace:suggested, workspace:useSuggested,
//            workspace:recent, workspace:list, project:open, project:close, project:thumb, project:saveThumb,
//            session:current, session:start, session:trust, session:stop,
//            chat:history, chat:lastConversation, chat:send, chat:interrupt, chat:setModel, chat:setMode,
//            chat:setEffort, chat:models,
//            build:state, build:rebuild, build:result, build:file, build:routeFile, build:engineInfo, view:tell,
//            route:start, route:cancel, marks:list, marks:add, marks:update, marks:remove, marks:resolve,
//            fab:state, fab:readiness, fab:release, fab:cancel, fab:profiles, fab:showFolder, cards:read, cards:change,
//            cards:brief, cards:references, cards:reference, cards:openLink, cards:seen, cards:markSeen,
//            cards:restock, chat:prompts, project:create, project:pickPhotos, project:pickPdf, project:readPhoto,
//            project:taken, parts:lookup
//   sent:    chat:answer, view:answer, window:minimize, window:toggleMaximize, window:close
//   to the window: session:status, chat:item, chat:meta, chat:capabilities, build:state, marks:changed, notice,
//            fab:state, cards:changed, cards:briefChanged (index.ts),
//            view:ask (view.ts), window:maximized (index.ts)
// What the window names (a project, a session) is not taken at its word: a project must be the one that is open.

export interface IpcDeps {
  /** The open workspace and its open project. */
  opened: Opened
  sessions: Sessions
  trust: Trust
  models: KnownModels
  builds: Builds
  views: ViewHolder
  marks: MarkStore
  routing: Routing
  fab: Fab
  /** Shows a release's README in the file manager; does nothing under test. */
  showFolder: (path: string) => void
  /** The cards of the open project's Brief. */
  cards: CardStore
  /** Opens a web address in the browser; does nothing under test. */
  openExternal: (url: string) => void
  /** The dialog for photos or for a PDF of a new project; under test, what a test said it answers. */
  pickFiles: (kind: 'photos' | 'pdf') => Promise<string[]>
  /** Whether what pino needs is on this machine. */
  engineInfo: () => Promise<EngineInfo>
}

/** Sends a message to the window, if there is one to hear it. */
export function broadcast(channel: string, message: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, message)
  }
}

export function registerIpc({ opened, sessions, trust, models, builds, views, marks, routing, fab, showFolder, engineInfo, cards, openExternal, pickFiles }: IpcDeps): void {
  /** The stock readings of this run, and the files the dialogs handed the window. */
  const readings = makeReadings()
  const offered = new Offered()
  const openWorkspace = () => {
    const workspace = opened.workspace()
    if (!workspace) throw new Error('No folder of boards is open.')
    return workspace
  }
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
    const open = opened.project()
    return open && open.id === id ? open : undefined
  }
  const mustBeOpen = (id: unknown): ProjectInfo => {
    const project = projectOf(id)
    if (!project) throw new Error('That project is not open')
    return project
  }

  handle('workspace:current', () => opened.current())
  handle('workspace:pick', () => opened.pickWorkspace())
  // A folder the window names is looked at like any other; the home folder and the root are refused.
  handle('workspace:open', (root: unknown) => opened.openWorkspace(String(root)))
  handle('workspace:suggested', () => opened.suggested())
  handle('workspace:useSuggested', () => opened.useSuggested())
  handle('workspace:recent', () => opened.recent())
  handle('workspace:list', () => opened.list())
  // By name: only a project the open workspace lists.
  handle('project:open', (name: unknown) => opened.openProject(String(name)))
  handle('project:close', () => opened.closeProject())
  handle('project:thumb', (name: unknown) => {
    const listed = opened.workspace()?.projects.find((p) => p.name === name)
    return listed ? thumbnailOnFile(listed.dir) : null
  })
  // Only of the open project and its newest good build, and only bytes that may be such a picture.
  handle('project:saveThumb', async (id: unknown, hash: unknown, png: unknown) => {
    const project = projectOf(id)
    if (!project || typeof hash !== 'string' || !BUILD_HASH.test(hash) || builds.lastGood(project.id)?.hash !== hash) return
    if (thumbnailRefusal(png as Uint8Array) !== null) return
    await saveThumbnail(project.dir, png as Uint8Array, { hash }, new Date())
  })

  // The one place pino makes a folder in a workspace (`createProject`, which checks the whole request again).
  handle('project:create', async (req: unknown) => {
    const { root } = openWorkspace()
    const made = await createProject(req as CreateRequest, { root, readings })
    if (opened.workspace()?.root !== root) throw new Error(`${made.name} was made, but its folder of boards was left before it could be opened.`)
    return opened.openProject(made.name)
  })
  handle('project:taken', () => readdir(openWorkspace().root))
  const picked = async (kind: 'photos' | 'pdf'): Promise<string[]> => {
    const paths = await pickFiles(kind)
    offered.add(paths)
    return paths
  }
  handle('project:pickPhotos', () => picked('photos'))
  handle('project:pickPdf', async () => (await picked('pdf'))[0] ?? null)
  // Only what the dialog gave: a file dropped on the window is read by the window itself.
  handle('project:readPhoto', (path: unknown) => {
    if (!offered.has(path)) throw new Error('That file was not chosen in this window.')
    return readPhoto(path)
  })
  handle('parts:lookup', (lcsc: unknown) => lookupPart(lcsc, (q) => fab.lookup(q), readings))

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

  handle('build:state', (id: unknown) => {
    const project = projectOf(id)
    return project ? (builds.state(project.id) ?? null) : null
  })
  handle('build:rebuild', (id: unknown) => builds.rebuild(mustBeOpen(id).id))
  const buildOf = (project: ProjectInfo, hash: string) => resultOfBuild(project, hash, [builds.latest(project.id), builds.lastGood(project.id)])
  handle('build:result', (id: unknown, hash: unknown) => buildOf(mustBeOpen(id), String(hash)))
  handle('build:file', async (id: unknown, hash: unknown, name: unknown) => {
    const project = mustBeOpen(id)
    return readArtifact(project, String(hash), name as ArtifactName, await buildOf(project, String(hash)))
  })
  handle('build:engineInfo', () => engineInfo())
  handle('build:routeFile', (id: unknown, key: unknown, name: unknown) => readRouteFile(mustBeOpen(id), String(key), name as RouteFile))
  builds.onState((state) => broadcast('build:state', state))
  handle('route:start', async (id: unknown) => void (await routing.start(mustBeOpen(id))))
  handle('route:cancel', async (id: unknown) => void (await routing.cancel(mustBeOpen(id))))
  handle('fab:state', (id: unknown) => {
    const project = projectOf(id)
    return project ? fab.state(project.id) : null
  })
  handle('fab:readiness', (id: unknown) => fab.readiness(mustBeOpen(id)))
  // What went wrong is in the state the window is told; the call only starts it.
  handle('fab:release', (id: unknown) => void fab.release(mustBeOpen(id)).catch(() => {}))
  handle('fab:cancel', async (id: unknown) => void (await fab.cancel(mustBeOpen(id))))
  handle('fab:profiles', () => fab.profiles())
  handle('fab:showFolder', (id: unknown) => {
    const project = mustBeOpen(id)
    const folder = fab.state(project.id).result?.folder
    // Only a release folder as the engine names them, whatever the answer said.
    if (folder && /^fab\/v\d+\.\d+\.\d+$/.test(folder)) showFolder(join(project.dir, folder, 'README.md'))
  })
  handle('marks:list', async (id: unknown) => {
    const project = projectOf(id)
    if (!project) return []
    const list = await marks.list(project)
    // What was wrong with the file is said to the window that asks for its marks: one that was not there yet has heard nothing.
    const problem = marks.takeProblem(project.id)
    if (problem) broadcast('notice', { text: problem })
    return list
  })
  // What the window asks to be marked is checked whole by the store (`marks/file.ts`, `sanitiseMark`).
  handle('marks:add', (id: unknown, mark: unknown) => marks.add(mustBeOpen(id), (mark ?? {}) as NewMark, 'user'))
  handle('marks:update', (id: unknown, markId: unknown, patch: unknown) => marks.update(mustBeOpen(id), String(markId), (patch ?? {}) as MarkPatch))
  handle('marks:remove', (id: unknown, markId: unknown) => marks.remove(mustBeOpen(id), String(markId)))
  handle('marks:resolve', (id: unknown, markId: unknown, note: unknown) => marks.resolve(mustBeOpen(id), String(markId), String(note ?? ''), 'user'))
  marks.onChange((projectId, list) => broadcast('marks:changed', { projectId, marks: list }))
  handle('cards:read', (id: unknown) => cards.read(mustBeOpen(id).id))
  // What the window asks is checked whole by the store, which takes no id, author or reading from it.
  handle('cards:change', (id: unknown, change: unknown) => cards.person(mustBeOpen(id).id, (change ?? {}) as PersonChange))
  handle('cards:brief', async (id: unknown) => (await readBrief(mustBeOpen(id).dir)) ?? null)
  handle('cards:references', (id: unknown) => listReferences(mustBeOpen(id).dir))
  handle('cards:reference', (id: unknown, file: unknown) => readReference(mustBeOpen(id).dir, String(file)))
  // The window names a card and a place in it, never an address: it is read from main's own file.
  handle('cards:openLink', async (id: unknown, from: unknown, nth: unknown) => {
    const project = mustBeOpen(id)
    const url = linkOf(await cards.read(project.id), await readBrief(project.dir), String(from), Number.isInteger(nth) ? (nth as number) : 0)
    if (url === null) throw new Error('There is no web address to open there.')
    openExternal(url)
  })
  handle('cards:seen', (id: unknown) => cards.seen(mustBeOpen(id).id))
  handle('cards:markSeen', (id: unknown) => cards.markSeen(mustBeOpen(id).id))
  // The number is read from main's own card, and the reading is the engine's: a lookup that fails changes nothing.
  handle('cards:restock', async (id: unknown, cardId: unknown) => {
    const project = mustBeOpen(id)
    const lcsc = (await cards.read(project.id)).cards.find((c) => c.id === cardId)?.part?.lcsc
    if (lcsc === undefined) throw new Error(`${String(cardId)} is no part with an LCSC number: there is no stock to check.`)
    const found = readingOf(await fab.lookup({ lcsc }), lcsc, new Date())
    if ('refused' in found) throw new Error(`The stock was not checked: ${found.refused}`)
    return cards.restock(project.id, String(cardId), found)
  })
  handle('chat:prompts', (id: unknown) => {
    const project = projectOf(id)
    return project ? listPrompts(project.dir) : []
  })
  handle('view:tell', (id: unknown, view: unknown) => {
    const project = projectOf(id)
    if (project) views.tell(project.id, view)
  })
  ipcMain.on('view:answer', (event, id: unknown, answer: unknown) => {
    if (ours(event)) takeAnswer(id, answer)
  })

  sessions.on('status', (m) => broadcast('session:status', { sessionId: m.sessionId, status: m.status }))
  sessions.on('item', (m) => broadcast('chat:item', { sessionId: m.sessionId, item: m.item, seq: m.seq }))
  sessions.on('meta', (m) => broadcast('chat:meta', { sessionId: m.sessionId, meta: m.meta, seq: m.seq }))
  sessions.on('capabilities', (m) => broadcast('chat:capabilities', { sessionId: m.sessionId, commands: m.commands, models: m.models, seq: m.seq }))
}
