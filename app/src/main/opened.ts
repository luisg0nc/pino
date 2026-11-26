// The workspace that is open and its one open project, and the rules of opening and leaving them. Main alone holds
// this: the window asks by name, and is only given a project the open workspace lists.

import { lstat, mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { ProjectInfo, RecentFolder } from '../shared/project'
import type { OpenFolder, WorkspaceInfo } from '../shared/workspace'
import { isProjectFolder, openProject, workspaceOf } from './project'
import { type Config, listed, recentWith } from './recent'
import { scanOrder, scanWorkspace } from './workspace'

export interface OpenedDeps {
  home: string
  readConfig(): Promise<Config>
  changeConfig(change: (c: Config) => Config): Promise<void>
  /** The folder dialog, or the test hook's answer. */
  pickFolder(): Promise<string | null>
  /** Ends the open project's session (and one starting): `Sessions.stopAll`. */
  stopAll(): Promise<void>
  /** The project is no longer open: routing, fab and the build loop let it go. */
  closed(project: ProjectInfo): void
  opened(project: ProjectInfo): void
  /** Called with every workspace opened, before it is listed. */
  sweep?(root: string): void
}

export interface Opened {
  workspace(): WorkspaceInfo | undefined
  project(): ProjectInfo | undefined
  /** What is open; rejects once with why the folder pino was started with could not be. */
  current(): Promise<{ workspace: WorkspaceInfo | null; project: ProjectInfo | null }>
  openWorkspace(root: string): Promise<WorkspaceInfo>
  /** Asks for a folder, held to the rule of a folder named at start: a project opens its parent, on it. */
  pickWorkspace(): Promise<OpenFolder | null>
  suggested(): Promise<{ path: string; exists: boolean }>
  useSuggested(): Promise<WorkspaceInfo>
  recent(): Promise<RecentFolder[]>
  /** The open workspace listed again. */
  list(): Promise<WorkspaceInfo>
  /** A project of the open workspace, by the name the listing gave it. */
  openProject(name: string): Promise<ProjectInfo>
  /** Ends the project's session and leaves it: the page of projects. */
  closeProject(): Promise<void>
  /**
   * Opens the folder pino starts with. One named at this start (`said`) that is a project opens its parent on it, and
   * any other folder is a workspace. A remembered one is the project open last. Never rejects: `current` says why.
   */
  startAt(dir: string, said: boolean): Promise<void>
}

/** The folder in the home folder that is suggested on a first run. */
export const SUGGESTED = 'boards'

export function openedHolder(deps: OpenedDeps): Opened {
  let workspace: WorkspaceInfo | undefined
  let project: ProjectInfo | undefined
  let startProblem: string | undefined
  /** One opening or closing at a time. */
  let turn: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(change: () => Promise<T>): Promise<T> => {
    const done = turn.then(change)
    turn = done.catch(() => {})
    return done
  }
  const order = scanOrder()

  /** The home folder by its real path, as a folder that is opened is. */
  const realHome = (): Promise<string> => realpath(deps.home).catch(() => resolve(deps.home))

  /** Ends the open project: no start is taken for it from here on, and `stopAll` waits for one under way. */
  const leave = async (): Promise<void> => {
    if (project) {
      deps.closed(project)
      project = undefined
    }
    await deps.stopAll()
  }

  /** A folder looked at as a workspace: nothing that is open is touched when it cannot be one. */
  const lookAt = async (root: string): Promise<WorkspaceInfo> => {
    const { dir } = await openProject(root)
    if (dir === '/') throw new Error('The top of the disk cannot be your folder of boards: choose a folder in your home folder, such as ~/boards.')
    if (dir === (await realHome())) throw new Error('Your home folder cannot be your folder of boards: choose a folder in it, such as ~/boards.')
    deps.sweep?.(dir)
    return scanWorkspace(dir)
  }

  /** A project of this listing, ready to be opened. */
  const listedProject = async (listing: WorkspaceInfo, name: string): Promise<ProjectInfo> => {
    const missing = new Error(`There is no project ${name} in ${listing.name}.`)
    const found = listing.projects.find((p) => p.name === name)
    if (!found) throw missing
    const info = await openProject(found.dir)
    // Made a link since it was listed: it is not the workspace's own.
    if (info.dir !== found.dir) throw missing
    return info
  }

  /** The workspace on show, with this project of it, or none: the page of projects. */
  const enter = async (listing: WorkspaceInfo, next: ProjectInfo | undefined): Promise<void> => {
    if (project && project.id !== next?.id) await leave()
    workspace = listing
    project = next
    if (next) deps.opened(next)
    await deps.changeConfig((config) => ({
      workspace: listing.root,
      ...(next ? { project: next.dir } : {}),
      workspaces: recentWith(config.workspaces, listing.root)
    }))
  }

  const openWorkspace = (root: string): Promise<WorkspaceInfo> =>
    inTurn(async () => {
      const listing = await lookAt(root)
      await enter(listing, undefined)
      return listing
    })

  /** Why a project that is not in a folder of boards cannot be opened. */
  class Stray extends Error {}

  /**
   * A folder given to pino, as a project in its workspace or as a workspace: the rule of a folder named at start, of
   * the project open last (`asProject`, whatever it holds) and of the folder dialog.
   */
  const openFolder = async (dir: string, asProject = false): Promise<OpenFolder> => {
    const { dir: real } = await openProject(dir)
    const home = await realHome()
    if (real === home || !(asProject || (await isProjectFolder(real)))) return { workspace: await openWorkspace(real), project: null }
    const parent = workspaceOf(real, home)
    if (parent === null) {
      const name = basename(real)
      const where = dirname(real) === home ? 'in your home folder' : 'at the top of the disk'
      throw new Stray(`${name} is ${where}, not in a folder of boards. Choose a folder for your boards, such as ~/${SUGGESTED}, and move ${name} into it.`)
    }
    return inTurn(async () => {
      const listing = await lookAt(parent)
      const next = await listedProject(listing, basename(real))
      await enter(listing, next)
      return { workspace: listing, project: next }
    })
  }

  return {
    workspace: () => workspace,
    project: () => project,
    async current() {
      await turn
      if (startProblem !== undefined) {
        const problem = startProblem
        startProblem = undefined
        throw new Error(problem)
      }
      return { workspace: workspace ?? null, project: project ?? null }
    },
    openWorkspace,
    async pickWorkspace() {
      const root = await deps.pickFolder()
      return root === null ? null : openFolder(root)
    },
    async suggested() {
      const path = join(deps.home, SUGGESTED)
      const exists = await lstat(path).then(
        (s) => s.isDirectory(),
        () => false
      )
      return { path, exists }
    },
    async useSuggested() {
      const path = join(deps.home, SUGGESTED)
      try {
        await mkdir(path)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error(`${SUGGESTED} could not be made in your home folder: ${(e as Error).message}`)
        const there = await lstat(path)
        if (!there.isDirectory()) throw new Error(`${SUGGESTED} in your home folder is a ${there.isSymbolicLink() ? 'link' : 'file'}: choose a folder instead.`)
      }
      return openWorkspace(path)
    },
    async recent() {
      return listed((await deps.readConfig()).workspaces)
    },
    async list() {
      await turn
      const at = workspace
      if (!at) throw new Error('No folder of boards is open.')
      const keep = order()
      // A folder that has gone is said in the words of one that cannot be opened.
      const next = await scanWorkspace(at.root).catch(async (e: unknown) => {
        await openProject(at.root)
        throw e
      })
      if (keep() && workspace?.root === at.root) workspace = next
      return next
    },
    openProject: (name) =>
      inTurn(async () => {
        if (!workspace) throw new Error('No folder of boards is open.')
        const listing = await scanWorkspace(workspace.root)
        const next = await listedProject(listing, name)
        await enter(listing, next)
        return next
      }),
    closeProject: () =>
      inTurn(async () => {
        await leave()
        await deps.changeConfig(({ project: _closed, ...config }) => config)
      }),
    async startAt(dir, said) {
      const config = await deps.readConfig()
      try {
        await openFolder(dir, !said && config.project === dir)
      } catch (e) {
        // Said also of a remembered project: without this the first screen would give no reason.
        if (e instanceof Stray) return void (startProblem = e.message)
        // A folder named at this start that cannot be opened is said; a remembered one that is gone is only quiet,
        // and its workspace is opened without it.
        console.error((e as Error).message)
        if (said) startProblem = (e as Error).message
        else if (config.workspace && config.workspace !== dir) await openWorkspace(config.workspace).catch((again: Error) => console.error(again.message))
      }
    }
  }
}
