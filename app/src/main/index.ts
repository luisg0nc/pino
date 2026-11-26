import { existsSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, type NativeImage, nativeTheme } from 'electron'
import { APP, envName, toolName } from '../shared/app'
import type { ProjectInfo } from '../shared/project'
import { writeFileAtomic } from './atomic'
import { Builds } from './builds'
import { PinoDomain } from './domain'
import { frameOptions, MIN_WINDOW, SURFACE } from './frame'
import { startHttp } from './http'
import { broadcast, type Projects, registerIpc } from './ipc'
import { kernelCommand, kernelHolder, startKernel } from './kernel/client'
import { applyLoginPath } from './loginPath'
import { MarkStore } from './marks/store'
import { mountMcp } from './mcp/server'
import { Models } from './model'
import { onNotOwn } from './own'
import { openProject } from './project'
import { systemPrompt } from './prompt'
import { quitGate } from './quit'
import { type Config, configOf, listed, recentWith } from './recent'
import { claudeAdapter } from './sessions/claude'
import { Sessions } from './sessions/manager'
import { KnownModels } from './sessions/models'
import { makeTestProfile, removeTestProfileAfterExit } from './testProfile'
import { Trust } from './trust'
import { ViewHolder } from './view'

// Environment switches:
//   PINO_TEST=1            the window is created hidden and never shown, the profile is a temporary folder, any number
//                          of pinos may run, and the test hooks are there
//   PINO_PROJECT=<path>    folder to open at start, instead of the one remembered
//   PINO_CONFIG=<path>     config file to use instead of ~/.config/pino/config.json (under test there is none unless
//                          one is named)
//   PINO_AGENT_CMD=<cmd>   command to run for a session instead of `claude`, split on spaces
//   PINO_KERNEL_CMD=<cmd>  command to run as the engine's serve mode instead of `uv run ... pino-kernel serve`
//   PINO_KERNEL_DIR=<dir>  the engine's folder, instead of `kernel` beside the app
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
  const profile = makeTestProfile()
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  app.setPath('crashDumps', join(profile, 'crashes'))
  app.on('quit', () => removeTestProfileAfterExit(profile))
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

// The project last opened is remembered in ~/.config/pino/config.json and opened again at the next start, and the
// file keeps those opened lately for the first screen. A test run neither reads nor writes the person's own file:
// only one it names itself.
const configPath: string | null = env('CONFIG') ?? (isTest ? null : join(app.getPath('appData'), APP.configDir, 'config.json'))

async function readConfig(): Promise<Config> {
  if (!configPath) return { recent: [] }
  try {
    return configOf(JSON.parse(await readFile(configPath, 'utf8')))
  } catch {
    return { recent: [] } // no file yet, or not one of ours
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
const kernel = kernelHolder(() =>
  startKernel(kernelCommand(process.env, app.getAppPath()), { env: process.env, cwd: app.getPath('userData') })
)
const builds = new Builds({ kernel: () => kernel.get() })
/** What the person has on screen, for what Claude is told of it. */
const views = new ViewHolder()
/** Each build as main reads it, and the marks, made on the newest board that was drawn. */
const buildModels = new Models()
const marks = new MarkStore({
  model: async (project) => {
    const drawn = builds.lastGood(project.id)
    return drawn ? buildModels.get(project, drawn) : null
  }
})

/** The one project open, and the rules of opening and closing it. */
function projectHolder(sessions: () => Sessions): Projects & { startAt(dir: string, said: boolean): Promise<void> } {
  let open: ProjectInfo | undefined
  let startProblem: string | undefined
  /** One opening or closing at a time. */
  let turn: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(change: () => Promise<T>): Promise<T> => {
    const done = turn.then(change)
    turn = done.catch(() => {})
    return done
  }
  const openAt = (dir: string): Promise<ProjectInfo> =>
    inTurn(async () => {
      // Looked at first, so that a folder that cannot be opened leaves everything as it was.
      const next = await openProject(dir)
      if (open && open.id !== next.id) {
        // No start is taken for the old project from here on, and `stopAll` waits for one under way.
        builds.close(open.id)
        open = undefined
        await sessions().stopAll()
      }
      open = next
      builds.open(next)
      await changeConfig((config) => ({ project: next.dir, recent: recentWith(config.recent, next.dir) }))
      return next
    })

  const picked = async (): Promise<string | null> => {
    if (isTest) {
      testHooks.picks += 1
      return testHooks.pickFolder
    }
    const win = BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = { title: 'Open folder', buttonLabel: 'Open', properties: ['openDirectory', 'createDirectory'] }
    const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return chosen.canceled ? null : (chosen.filePaths[0] ?? null)
  }

  return {
    open: () => open,
    openAt,
    async pick() {
      const dir = await picked()
      return dir === null ? null : openAt(dir)
    },
    async current() {
      await turn
      if (startProblem !== undefined) {
        const problem = startProblem
        startProblem = undefined
        throw new Error(problem)
      }
      return open ?? null
    },
    async recent() {
      await configWritten
      return listed((await readConfig()).recent)
    },
    close: () =>
      inTurn(async () => {
        if (open) builds.close(open.id)
        open = undefined
        await sessions().stopAll()
        await changeConfig((config) => ({ recent: config.recent }))
      }),
    async startAt(dir, said) {
      // A folder named at this start that cannot be opened is said; a remembered one that is gone is only listed as missing.
      await openAt(dir).catch((e: Error) => {
        console.error(e.message)
        if (said) startProblem = e.message
      })
    }
  }
}

/** What a test needs of main that it cannot reach through the window. `pickFolder` is what the folder dialog answers. */
const testHooks = {
  pickFolder: null as string | null,
  picks: 0,
  mcpFor: (_projectId: string): { url: string; token: string } => ({ url: '', token: '' }),
  /** The engine's process id, when one runs: a spec checks that it does not outlive pino. */
  kernelPid: (): number | null => kernel.current()?.pid ?? null,
  configPath: (): string | null => configPath
}

/**
 * The window's icon, where the desktop takes it from the window and not from the desktop entry (X11): the icon beside
 * the launcher, when it is there. Electron reads no SVG, so it is `scripts/pino.svg` drawn at 512 px
 * (`rsvg-convert -w 512 -h 512`); the desktop entry names the drawing itself.
 */
function windowIcon(): NativeImage | undefined {
  const file = resolve(app.getAppPath(), '..', 'scripts', `${APP.name}.png`)
  if (!existsSync(file)) return undefined
  const icon = nativeImage.createFromPath(file)
  return icon.isEmpty() ? undefined : icon
}

function createWindow(): BrowserWindow {
  const icon = windowIcon()
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
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
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(isTest ? `${devUrl}?test=1` : devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), isTest ? { query: { test: '1' } } : {})
  return win
}

let sessions: Sessions | undefined
let projects: (Projects & { startAt(dir: string, said: boolean): Promise<void> }) | undefined

/** Another pino was started: come to the front, and open the folder it was given if none is open here. */
app.on('second-instance', (_event, _argv, _cwd, data) => {
  const handed = (data as { project?: unknown } | null)?.project
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  if (typeof handed !== 'string' || !handed || !projects) return
  // Opening another project ends the open one's session: that is not done on the word of a command line.
  if (projects.open()) {
    if (projects.open()!.dir !== handed) broadcast('notice', { text: `${APP.name} is already running. To work on ${handed}, open it from the menu beside the project's name.` })
  } else void projects.openAt(handed).then(() => win.webContents.reload()).catch((e: Error) => broadcast('notice', { text: e.message }))
})

void app.whenReady().then(async () => {
  if (!isFirst) return
  // A start from a desktop entry may have a PATH without `claude`: the login shell is asked, before any session.
  await applyLoginPath()
  // What the agent's CLI talks to: its hooks, and the MCP server through which it asks pino.
  const http = await startHttp()
  const holder = (projects = projectHolder(() => sessions!))
  mountMcp(http, { project: (id) => (holder.open()?.id === id ? holder.open() : undefined) })
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
    view: () => {
      const open = holder.open()
      return open ? views.of(open.id) : null
    },
    toolName
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
  registerIpc({ projects: holder, sessions, trust, models, builds, views, marks })
  // Every build that drew something has the marks found again on it.
  builds.onResult((projectId, result) => {
    const project = holder.open()
    if (!project || project.id !== projectId || !result.hash) return
    void buildModels
      .get(project, result)
      .then((model) => model && marks.reanchor(project, model))
      .catch((e: Error) => console.error(`cannot find the marks again on h${result.number}: ${e.message}`))
  })

  testHooks.mcpFor = (projectId) => ({ url: http.url(`/mcp/${projectId}`), token: http.grant([`/mcp/${projectId}`]) })
  if (isTest) Object.assign(globalThis, { [APP.mainHook]: testHooks })

  const remembered = askedAtStart ?? (await readConfig()).project
  if (remembered) await holder.startAt(remembered, askedAtStart !== undefined)
  createWindow()
})

// Sessions are ended, and the quit waits until they have gone: one that will not leave is killed two seconds after it
// is asked to. The quit waits once, three seconds at most, and what is still there then is killed with it.
const quitWaits = quitGate(3000)

app.on('before-quit', (event) => {
  // The engine is asked to shut down; it has the same three seconds, and its whole group is killed with pino.
  const wait = quitWaits([sessions?.busy ? sessions.stopAll() : null, configWriting > 0 ? configWritten : null, kernel.current() ? kernel.dispose() : null])
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
