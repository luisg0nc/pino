import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ProjectInfo } from '../shared/project'
import { openedHolder, type OpenedDeps } from './opened'
import type { Config } from './recent'

const made: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pino-opened-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A project folder: `root/name` holding the file. */
function project(root: string, name: string, file: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  writeFileSync(join(dir, file), '')
  return dir
}

let home: string
let config: Config
let stops: number
let closed: ProjectInfo[]
let opened: ProjectInfo[]
let picked: string | null
beforeEach(() => {
  home = temp()
  config = { workspaces: [] }
  stops = 0
  closed = []
  opened = []
  picked = null
})

const holder = (more: Partial<OpenedDeps> = {}) =>
  openedHolder({
    home,
    readConfig: async () => config,
    changeConfig: async (change) => void (config = change(config)),
    pickFolder: async () => picked,
    stopAll: async () => void (stops += 1),
    closed: (p) => closed.push(p),
    opened: (p) => opened.push(p),
    ...more
  })

it('opens the parent of a project folder on that project, and a workspace folder on its page', async () => {
  const root = temp()
  project(root, 'blinky', 'board.py')
  const o = holder()
  await o.startAt(join(root, 'blinky'), true)
  expect([o.workspace()?.root, o.project()?.name]).toEqual([root, 'blinky'])
  expect(config).toEqual({ workspace: root, project: join(root, 'blinky'), workspaces: [root] })
  await o.startAt(root, true)
  expect([o.workspace()?.root, o.project()]).toEqual([root, undefined])
})

it('remembers the workspace and the project, and another workspace ends the project first', async () => {
  const a = temp()
  const b = temp()
  project(a, 'blinky', 'brief.md')
  const sweeps: string[] = []
  const o = holder({ sweep: (root) => sweeps.push(root) })
  await o.openWorkspace(a)
  const blinky = await o.openProject('blinky')
  expect(opened).toEqual([blinky])
  expect(stops).toBe(0)
  await o.openWorkspace(b)
  expect(stops).toBe(1)
  expect(closed).toEqual([blinky])
  expect([o.workspace()?.root, o.project()]).toEqual([b, undefined])
  expect(config).toEqual({ workspace: b, workspaces: [b, a] })
  expect(sweeps).toEqual([a, b])
  expect(await o.recent()).toEqual([
    { root: b, missing: false },
    { root: a, missing: false }
  ])
})

it('another project of the workspace ends the open one first, and the same one again ends nothing', async () => {
  const root = temp()
  project(root, 'a', 'board.py')
  project(root, 'b', 'board.py')
  const o = holder()
  await o.openWorkspace(root)
  await o.openProject('a')
  await o.openProject('a')
  expect([stops, closed.length]).toEqual([0, 0])
  await o.openProject('b')
  expect([stops, closed.map((p) => p.name), o.project()?.name]).toEqual([1, ['a'], 'b'])
})

it('opens only a project the workspace lists', async () => {
  const root = join(temp(), 'boards')
  mkdirSync(root)
  mkdirSync(join(root, '.hidden'))
  symlinkSync(temp(), join(root, 'link'))
  const o = holder()
  await o.openWorkspace(root)
  await expect(o.openProject('../x')).rejects.toThrow('There is no project ../x in boards.')
  await expect(o.openProject('.hidden')).rejects.toThrow('There is no project .hidden in boards.')
  await expect(o.openProject('link')).rejects.toThrow('There is no project link in boards.')
})

it('leaves what is open as it was when a folder cannot be opened', async () => {
  const root = temp()
  project(root, 'blinky', 'board.py')
  const o = holder()
  await o.startAt(join(root, 'blinky'), true)
  await expect(o.openWorkspace(join(root, 'not-there'))).rejects.toThrow('not-there is not a folder pino can open: it is not there')
  expect([o.workspace()?.root, o.project()?.name, stops]).toEqual([root, 'blinky', 0])
})

it('asks the dialog for a workspace, and a dialog put away changes nothing', async () => {
  const root = temp()
  const o = holder()
  expect(await o.pickWorkspace()).toBeNull()
  expect(o.workspace()).toBeUndefined()
  picked = root
  expect((await o.pickWorkspace())?.root).toBe(root)
})

it('lists the open workspace again', async () => {
  const root = temp()
  const o = holder()
  await expect(o.list()).rejects.toThrow('No folder of boards is open.')
  await o.openWorkspace(root)
  project(root, 'new', 'board.py')
  expect((await o.list()).projects.map((p) => p.name)).toEqual(['new'])
  expect(o.workspace()?.projects.map((p) => p.name)).toEqual(['new'])
})

it('never opens the home folder or the root as a workspace', async () => {
  const o = holder()
  await expect(o.openWorkspace(home)).rejects.toThrow('Your home folder cannot be your folder of boards: choose a folder in it, such as ~/boards.')
  await expect(o.openWorkspace('/')).rejects.toThrow('The top of the disk cannot be your folder of boards: choose a folder in your home folder, such as ~/boards.')
  expect([o.workspace(), config]).toEqual([undefined, { workspaces: [] }])
})

it('useSuggested makes ~/boards when it is not there, and opens it; a link in its place is refused', async () => {
  const o = holder()
  expect(await o.suggested()).toEqual({ path: join(home, 'boards'), exists: false })
  expect((await o.useSuggested()).root).toBe(join(home, 'boards'))
  expect(statSync(join(home, 'boards')).isDirectory()).toBe(true)
  expect(await o.suggested()).toEqual({ path: join(home, 'boards'), exists: true })
  expect((await o.useSuggested()).root).toBe(join(home, 'boards'))
  rmSync(join(home, 'boards'), { recursive: true })
  symlinkSync(temp(), join(home, 'boards'))
  await expect(o.useSuggested()).rejects.toThrow('boards in your home folder is a link: choose a folder instead.')
  rmSync(join(home, 'boards'))
  writeFileSync(join(home, 'boards'), '')
  await expect(o.useSuggested()).rejects.toThrow('boards in your home folder is a file: choose a folder instead.')
})

it('a project in the home folder opens the first screen and says why', async () => {
  project(home, 'blinky', 'board.py')
  const o = holder()
  await o.startAt(join(home, 'blinky'), false)
  expect(o.workspace()).toBeUndefined()
  await expect(o.current()).rejects.toThrow('blinky is in your home folder, not in a folder of boards. Choose a folder for your boards, such as ~/boards, and move blinky into it.')
  // Said once.
  expect(await o.current()).toEqual({ workspace: null, project: null })
})

it('says a folder named at start that cannot be opened, and keeps a remembered one quiet', async () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  const gone = join(temp(), 'typo')
  const said = holder()
  await said.startAt(gone, true)
  await expect(said.current()).rejects.toThrow('typo is not a folder pino can open: it is not there')
  const unsaid = holder()
  await unsaid.startAt(gone, false)
  expect(await unsaid.current()).toEqual({ workspace: null, project: null })
  quiet.mockRestore()
})

it('a remembered project that is gone leaves the remembered workspace on its page', async () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  const root = temp()
  config = { workspace: root, project: join(root, 'gone'), workspaces: [root] }
  const o = holder()
  await o.startAt(join(root, 'gone'), false)
  expect(await o.current()).toMatchObject({ workspace: { root }, project: null })
  quiet.mockRestore()
})

it('closeProject ends the session and keeps the workspace', async () => {
  const root = temp()
  project(root, 'blinky', 'board.py')
  const o = holder()
  await o.startAt(join(root, 'blinky'), true)
  await o.closeProject()
  expect(stops).toBe(1)
  expect(closed.map((p) => p.name)).toEqual(['blinky'])
  expect([o.workspace()?.root, o.project()]).toEqual([root, undefined])
  expect(config).toEqual({ workspace: root, workspaces: [root] })
})

it('an empty board left open is opened again at the next start, not taken for a workspace', async () => {
  const root = temp()
  mkdirSync(join(root, 'bare'))
  const first = holder()
  await first.openWorkspace(root)
  await first.openProject('bare')
  const next = holder()
  await next.startAt(join(root, 'bare'), false)
  expect([next.workspace()?.root, next.project()?.name]).toEqual([root, 'bare'])
})
