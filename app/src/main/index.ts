import { existsSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, type NativeImage, nativeTheme, shell } from 'electron'
import { APP, envName, toolName } from '../shared/app'
import type { ProjectInfo } from '../shared/project'
import { writeFileAtomic } from './atomic'
import { Builds, causeOfSave } from './builds'
import { CardStore } from './cards/store'
import { readBrief } from './cards/text'
import { watchBrief } from './cards/watch'
import { listPrompts } from './sessions/prompts'
import { PinoDomain } from './domain'
import { frameOptions, MIN_WINDOW, SURFACE, windowSize } from './frame'
import { startHttp } from './http'
import { broadcast, registerIpc } from './ipc'
import { kernelCommand, kernelEnv, kernelHolder, startKernel } from './kernel/client'
import { kernelDir, windowIconFile } from './paths'
import { applyLoginPath } from './loginPath'
import { MarkStore } from './marks/store'
import { mountMcp } from './mcp/server'
import { type BuildModel, Models } from './model'
import { onNotOwn } from './own'
import { resultOfBuild } from './artifacts'
import type { LookResult } from '../shared/view'
import { type Opened, openedHolder, SUGGESTED } from './opened'
import { sweepStaleNew } from './projects/create'
import { systemPrompt } from './prompt'
import { quitGate } from './quit'
import { readEngine, versionCommand } from './engineInfo'
import type { EngineInfo } from '../shared/ready'
import { agentEnv } from './sessions/agentEnv'
import { findCommand } from './sessions/choice'
import { Routing } from './routing'
import { Fab } from './fab'
import { type Config, configOf } from './recent'
import { claudeAdapter } from './sessions/claude'
import { Sessions } from './sessions/manager'
import { KnownModels } from './sessions/models'
import { makeTestProfile, removeTestProfileAfterExit } from './testProfile'
import { Trust } from './trust'
import { askWindow, NoAnswer, ViewHolder } from './view'

// Environment switches:
//   PINO_TEST=1            the window is created hidden and never shown, the profile is a temporary folder, any number
//                          of pinos may run, and the test hooks are there
//   PINO_PROJECT=<path>    folder to open at start, instead of the one remembered
//   PINO_CONFIG=<path>     config file to use instead of ~/.config/pino/config.json (under test there is none unless
//                          one is named)
//   PINO_AGENT_CMD=<cmd>   command to run for a session instead of `claude`, split on spaces
//   PINO_KERNEL_CMD=<cmd>  command to run as the engine's serve mode instead of `uv run ... pino-kernel serve`
//   PINO_KERNEL_DIR=<dir>  the engine's folder, instead of `kernel` beside the app
//   PINO_TEST_PROFILE=<dir> under test, the profile in this folder, kept after the run: two launches share what the
//                          window keeps (the dock's width)
//   PINO_DEBUG=1           print where the MCP server is, and the command line and the hooks of every session
// Whose window this is, said outright: the desktop finds pino's entry and icon by it (the Wayland app id, the
// X11 class).
app.setName(APP.name)
;(app as unknown as { setDesktopName?: (name: string) => void }).setDesktopName?.(`${APP.name}.desktop`)

const env = (name: string): string | undefined => process.env[envName(name)]
const isTest = env('TEST') === '1'
const isDebug = env('DEBUG') === '1'

// Under test Electron keeps nothing of its own under the person's home: its profile (cache, storage, crash
// dumps) is a folder of this run in the temporary folder (`testProfile.ts`), set before the app is ready and
// removed once the process has gone.
if (isTest) {
  const named = env('TEST_PROFILE')
  const profile = named ?? makeTestProfile()
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  app.setPath('crashDumps', join(profile, 'crashes'))
  if (!named) app.on('quit', () => removeTestProfileAfterExit(profile))
}

// A hidden window stops getting frame callbacks from the compositor. Once a repaint coincides with input, Chromium
// then waits a second for each frame, so every mouse move in a test takes a second. Without the frame-rate limit it
// keeps drawing at 60 Hz. Never set for a visible window.
if (isTest) app.commandLine.appendSwitch('disable-frame-rate-limit')

/** The folder named at this start, whole: what a second pino hands to the first. */
const askedAtStart = env('PROJECT') ? resolve(env('PROJECT')!) : undefined

// One pino at a time: two would each run an agent in the same folders and write the same .pino/ files. A second
// launch hands the first the folder it was given, if any, and exits. Not under test: test runs launch side by side.
const isFirst = isTest || app.requestSingleInstanceLock({ project: askedAtStart ?? null })
if (!isFirst) {
  const handed = askedAtStart ? `; it was asked to open ${askedAtStart}` : ''
  console.error(`${APP.name} is already running: its window was brought to the front${handed}`)
  app.quit()
}

// No menu: with one, even hidden, a lone press of Alt shows the menu bar and the view is resized under the pointer.
// Text fields keep copy, paste, select all and undo without it.
Menu.setApplicationMenu(null)

// The workspace and the project open last are remembered in ~/.config/pino/config.json and opened again at the next
// start, and the file keeps the workspaces opened lately. A test run neither reads nor writes the person's own file:
// only one it names itself.
const configPath: string | null = env('CONFIG') ?? (isTest ? null : join(app.getPath('appData'), APP.configDir, 'config.json'))

async function readConfig(): Promise<Config> {
  if (!configPath) return { workspaces: [] }
  try {
    return configOf(JSON.parse(await readFile(configPath, 'utf8')), homedir())
  } catch {
    return { workspaces: [] } // no file yet, or not one of ours
  }
}

/** One change of the file at a time: each reads what the one before wrote. */
let configWritten: Promise<unknown> = Promise.resolve()
let configWriting = 0
function changeConfig(change: (config: Config) => Config): Promise<void> {
  configWriting += 1
  const done = configWritten.then(async () => {
    if (!configPath) return
    try {
      await writeFileAtomic(configPath, `${JSON.stringify(change(await readConfig()), null, 2)}\n`)
    } catch (e) {
      console.error(`cannot write ${configPath}: ${(e as Error).message}`)
    }
  })
  configWritten = done.catch(() => {}).finally(() => (configWriting -= 1))
  return done
}

/** The one engine of this run, and the build loop over it. Neither starts anything until a project has a board. */
const engineCommand = (): string[] => kernelCommand(process.env, kernelDir(), app.isPackaged)
/** Read when the engine is asked for, after the login shell has said its PATH. */
const engineStart = () => ({ env: { ...process.env, ...kernelEnv({ packaged: app.isPackaged, userData: app.getPath('userData') }) }, cwd: app.getPath('userData') })
const kernel = kernelHolder(() => startKernel(engineCommand(), engineStart()))
/** A save is Claude's when a tool call of its session accounts for it (never by a turn being at work), else the person's. */
const builds = new Builds({ kernel: () => kernel.get(), causeNow: (projectId, path) => causeOfSave(sessions?.wroteBy(projectId, path)) })
const routing = new Routing({ kernel: () => kernel.get(), builds, turnNow: (projectId) => sessions?.turnNow(projectId) })
/** The project on show, once there is a holder of it: the fab's engine state is that project's build loop's. */
let openProjectId: () => string | undefined = () => undefined
const fab = new Fab({
  kernel: () => kernel.get(),
  running: () => kernel.current(),
  builds,
  engine: () => {
    const id = openProjectId()
    return (id ? builds.state(id)?.engine : undefined) ?? { state: 'starting' }
  },
  onState: (state) => broadcast('fab:state', state)
})
/** What the person has on screen, for what Claude is told of it. */
const views = new ViewHolder()
/** Each build as main reads it, and the marks, made on the newest board that was drawn. */
const buildModels = new Models()
/** The newest build that drew something, read. */
async function drawnModel(project: ProjectInfo): Promise<BuildModel | null> {
  const drawn = builds.lastGood(project.id)
  return drawn ? buildModels.get(project, drawn) : null
}
const marks = new MarkStore({ model: drawnModel })

/** The folder dialog for a folder of boards; under test, what a test said it answers. */
async function pickWorkspaceFolder(): Promise<string | null> {
  if (isTest) {
    testHooks.picks += 1
    return testHooks.pickFolder
  }
  const win = BrowserWindow.getAllWindows()[0]
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a folder for your boards',
    buttonLabel: 'Open',
    defaultPath: join(homedir(), SUGGESTED),
    properties: ['openDirectory', 'createDirectory']
  }
  const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return chosen.canceled ? null : (chosen.filePaths[0] ?? null)
}

/** The dialog for the photos or the PDF of a new project; under test, what a test said it answers. */
async function pickProjectFiles(kind: 'photos' | 'pdf'): Promise<string[]> {
  if (isTest) {
    const said = testHooks.pickFiles ?? []
    return kind === 'pdf' ? said.filter((path) => path.toLowerCase().endsWith('.pdf')).slice(0, 1) : said.filter((path) => !path.toLowerCase().endsWith('.pdf'))
  }
  const win = BrowserWindow.getAllWindows()[0]
  const options: Electron.OpenDialogOptions =
    kind === 'pdf'
      ? { title: 'Add a PDF', properties: ['openFile'], filters: [{ name: 'PDF files', extensions: ['pdf'] }] }
      : { title: 'Add photos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }
  const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return chosen.canceled ? [] : chosen.filePaths
}

/**
 * What a test needs of main that it cannot reach through the window. `pickFolder` is what the folder dialog answers,
 * `pickFiles` what the photo and PDF dialogs do.
 */
const testHooks = {
  pickFolder: null as string | null,
  picks: 0,
  pickFiles: null as string[] | null,
  mcpFor: (_projectId: string): { url: string; token: string } => ({ url: '', token: '' }),
  /** The engine's process id, when one runs: a spec checks that it does not outlive pino. */
  kernelPid: (): number | null => kernel.current()?.pid ?? null,
  configPath: (): string | null => configPath
}

/** The window's icon (`paths.ts`), when it is there; the desktop entry names the drawing itself. */
function windowIcon(): NativeImage | undefined {
  const file = windowIconFile()
  if (!existsSync(file)) return undefined
  const icon = nativeImage.createFromPath(file)
  return icon.isEmpty() ? undefined : icon
}

function createWindow(): BrowserWindow {
  const icon = windowIcon()
  const win = new BrowserWindow({
    ...windowSize(isTest, env('TEST_SIZE')),
    // The size is the page's, as there is no native frame.
    useContentSize: true,
    show: false,
    title: APP.name,
    ...(icon ? { icon } : {}),
    // The window's own background, painted before the renderer's first frame; no native frame (`frame.ts`).
    backgroundColor: nativeTheme.shouldUseDarkColors ? SURFACE.dark : SURFACE.light,
    ...frameOptions(nativeTheme.shouldUseDarkColors),
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      preload: join(__dirname, '../preload/index.js')
    }
  })

  if (!isTest) win.once('ready-to-show', () => win.show())

  // The three controls the window draws itself ask main through these. The window is told when it is maximised.
  const mine = (event: Electron.IpcMainEvent): boolean => !win.isDestroyed() && event.sender === win.webContents
  const onMinimize = (event: Electron.IpcMainEvent): void => void (mine(event) && win.minimize())
  const onToggleMaximize = (event: Electron.IpcMainEvent): void => {
    if (mine(event)) win.isMaximized() ? win.unmaximize() : win.maximize()
  }
  const onClose = (event: Electron.IpcMainEvent): void => void (mine(event) && win.close())
  const told = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('window:maximized', win.isMaximized())
  }
  ipcMain.on('window:minimize', onMinimize)
  ipcMain.on('window:toggleMaximize', onToggleMaximize)
  ipcMain.on('window:close', onClose)
  win.on('maximize', told)
  win.on('unmaximize', told)
  win.webContents.on('did-finish-load', told)
  win.on('closed', () => {
    ipcMain.off('window:minimize', onMinimize)
    ipcMain.off('window:toggleMaximize', onToggleMaximize)
    ipcMain.off('window:close', onClose)
  })

  // The renderer is a single local page: it opens no windows and goes nowhere else. It may reload itself, which is
  // how the dev server applies a change it cannot hot-swap.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  // electron-vite serves the renderer from its dev server under `pnpm dev`.
  // `?test=1` tells the renderer to expose its test hook (window.__pinoTest).
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(isTest ? `${devUrl}?test=1` : devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), isTest ? { query: { test: '1' } } : {})
  return win
}

let sessions: Sessions | undefined
let opened: Opened | undefined

/** Another pino was started: come to the front, and open the folder it was given if no project is open here. */
app.on('second-instance', (_event, _argv, _cwd, data) => {
  const handed = (data as { project?: unknown } | null)?.project
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (typeof handed !== 'string' || !handed || !opened) return
  // Opening another project ends the open one's session: that is not done on the word of a command line.
  const project = opened.project()
  if (project) {
    if (project.dir !== handed) broadcast('notice', { text: `${APP.name} is already running. To work on ${handed}, open it from the menus at the top of the window.` })
  } else void opened.startAt(handed, true).then(() => win.webContents.reload())
})

void app.whenReady().then(async () => {
  if (!isFirst) return
  // A start from a desktop entry may have a PATH without `claude`: the login shell is asked, before any session.
  await applyLoginPath()
  // What the agent's CLI talks to: its hooks, and the MCP server through which it asks pino.
  const http = await startHttp()
  const holder = (opened = openedHolder({
    // `HOME`, which a test run has of its own.
    home: homedir(),
    readConfig: async () => {
      await configWritten
      return readConfig()
    },
    changeConfig,
    pickFolder: pickWorkspaceFolder,
    // What a create left half made in a crash, in a workspace that is opened.
    sweep: (root) => sweepStaleNew(root, Date.now()),
    stopAll: () => sessions!.stopAll(),
    // No start is taken for a project that has been left, and `stopAll` waits for one under way.
    closed: (project) => {
      unwatchBrief()
      cards.forget(project.id)
      routing.drop(project.id)
      fab.drop(project.id)
      builds.close(project.id)
    },
    opened: (project) => {
      builds.open(project)
      // `brief.md` is written in the person's editor, and the cards may be pulled: both are followed while it is open.
      unwatchBrief()
      unwatchBrief = watchBrief(project.dir, (what) => {
        if (what.cards) void cards.refresh(project.id).catch((e: Error) => console.error(`cannot read the cards again: ${e.message}`))
        if (what.brief) broadcast('cards:briefChanged', { projectId: project.id })
      })
    }
  }))
  let unwatchBrief = (): void => {}
  openProjectId = () => holder.project()?.id
  // The cards of the open project's Brief: main alone writes them.
  const cards = new CardStore({
    dirOf: (id) => (holder.project()?.id === id ? holder.project()!.dir : undefined),
    onChange: (projectId, file) => broadcast('cards:changed', { projectId, file }),
    onProblem: (_projectId, message) => broadcast('notice', { text: message })
  })
  // The files an agent is given by path (its MCP server's, which holds no secret): what a pino that crashed left is of no use.
  const configDir = join(app.getPath('userData'), 'agent')
  rmSync(configDir, { recursive: true, force: true })
  // Kept in pino's own data, beside its config file; under test, in the run's temporary profile.
  const dataDir = app.getPath('userData')
  const trust = new Trust(join(dataDir, 'trusted.json'))
  const models = new KnownModels(join(dataDir, 'models.json'))
  const domain = new PinoDomain({
    builds,
    marks,
    cards,
    brief: (project) => readBrief(project.dir),
    view: () => {
      const open = holder.project()
      return open ? views.of(open.id) : null
    },
    toolName
  })
  mountMcp(http, {
    project: (id) => (holder.project()?.id === id ? holder.project() : undefined),
    state: (id) => builds.state(id),
    model: drawnModel,
    marks,
    routing,
    buildResult: (project, hash) => resultOfBuild(project, hash, [builds.latest(project.id), builds.lastGood(project.id)]),
    diff: async (project, from, to) => (await kernel.get().request<{ changes: { circuit: string[]; layout: string[] } }>('diff', { project: project.dir, from, to })).changes,
    look: (_project, request) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win ? askWindow<LookResult>(win, 'look', request) : Promise.reject(new NoAnswer('there is no window'))
    },
    looked: (id) => domain.looked(id),
    cards,
    turnNow: (id) => sessions?.turnNow(id),
    prompts: (project) => listPrompts(project.dir),
    fab,
    fabProfile: async (project) => {
      const model = await drawnModel(project)
      await fab.profiles()
      return fab.profileOf(model?.circuit?.fab)
    }
  })
  sessions = new Sessions({
    http,
    adapter: claudeAdapter(env('AGENT_CMD')),
    configDir,
    env: process.env,
    domain,
    trust,
    models,
    systemPrompt: systemPrompt(toolName),
    ...(isDebug ? { debug: (line: string) => console.error(`[${APP.name}] ${line}`) } : {})
  })
  if (isDebug) console.error(`[${APP.name}] listening at ${http.url('/')}`)
  // A folder of a project that pino may not write into is said in the window, once.
  onNotOwn((_dir, message) => broadcast('notice', { text: message }))
  const adapter = claudeAdapter(env('AGENT_CMD'))
  let engineSaid: Promise<EngineInfo> | undefined
  const engineInfo = () =>
    (engineSaid ??= readEngine(versionCommand(engineCommand()), engineStart()).then((said) => ({
      ...said,
      claude: findCommand(adapter.probe.command, agentEnv(process.env).PATH) !== null
    })))
  registerIpc({ opened: holder, sessions, trust, models, builds, views, marks, routing, fab, engineInfo, showFolder: isTest ? () => {} : (path) => shell.showItemInFolder(path), cards, openExternal: isTest ? () => {} : (url) => void shell.openExternal(url), pickFiles: pickProjectFiles })
  // Every build that drew something has the marks found again on it.
  builds.onResult((projectId, result) => {
    fab.buildLanded(projectId)
    const project = holder.project()
    if (!project || project.id !== projectId || !result.hash) return
    void buildModels
      .get(project, result)
      .then((model) => model && marks.reanchor(project, model))
      .catch((e: Error) => console.error(`cannot find the marks again on h${result.number}: ${e.message}`))
  })

  testHooks.mcpFor = (projectId) => ({ url: http.url(`/mcp/${projectId}`), token: http.grant([`/mcp/${projectId}`]) })
  if (isTest) Object.assign(globalThis, { [APP.mainHook]: testHooks })

  // The folder named at this start, else the project open last, else the workspace on its page.
  const config = await readConfig()
  if (askedAtStart) await holder.startAt(askedAtStart, true)
  else if (config.project) await holder.startAt(config.project, false)
  else if (config.workspace) await holder.openWorkspace(config.workspace).catch((e: Error) => console.error(e.message))
  createWindow()
})

// Sessions are ended, and the quit waits until they have gone: one that will not leave is killed two seconds after it
// is asked to. The quit waits once, three seconds at most, and what is still there then is killed with it.
const quitWaits = quitGate(3000)

app.on('before-quit', (event) => {
  // The engine is asked to shut down; it has the same three seconds, and its whole group is killed with pino.
  // A causes file still being written lands before pino goes (`Builds.writing`).
  const wait = quitWaits([sessions?.busy ? sessions.stopAll() : null, configWriting > 0 ? configWritten : null, kernel.current() ? kernel.dispose() : null, builds.writes > 0 ? builds.writing() : null])
  if (!wait) return
  event.preventDefault()
  void wait.then(() => app.quit())
})
app.on('will-quit', () => {
  sessions?.killAll()
  kernel.kill()
})

// Closing the window ends the app: sessions do not outlive it.
app.on('window-all-closed', () => app.quit())
