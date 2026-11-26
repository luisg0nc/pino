import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { RecentFolder } from '../shared/project'
import { workspaceOf } from './project'

// The workspaces opened lately, for the first screen and the title bar. They are kept in pino's own config file,
// beside the workspace and the project to open at the next start: never in a project, and nowhere else.

export const MAX_RECENT = 8

/** What the config file holds: the workspace and the project open last, and the workspaces opened lately, the newest first. */
export interface Config {
  workspace?: string
  project?: string
  workspaces: string[]
}

/** The folders with one more opened: it comes first, is there once, and the oldest beyond `MAX_RECENT` go. */
export function recentWith(list: readonly string[], root: string): string[] {
  return [root, ...list.filter((one) => one !== root)].slice(0, MAX_RECENT)
}

export function recentWithout(list: readonly string[], root: string): string[] {
  return list.filter((one) => one !== root)
}

/**
 * A config out of whatever the file holds. One written before there were workspaces has recent project folders:
 * their parents become the recent workspaces, once, since what is written back has `workspaces`. The home folder and
 * the root are never workspaces (`workspaceOf`).
 */
export function configOf(value: unknown, home: string): Config {
  const file = (typeof value === 'object' && value !== null ? value : {}) as Record<'workspace' | 'project' | 'workspaces' | 'recent', unknown>
  const whole = (one: unknown): one is string => typeof one === 'string' && isAbsolute(one)
  const allowed = (root: string): boolean => resolve(root) !== '/' && resolve(root) !== resolve(home)
  const project = typeof file.project === 'string' && file.project ? file.project : undefined
  const before = !Array.isArray(file.workspaces)
  const parentOf = (dir: string): string[] => {
    const parent = workspaceOf(dir, home)
    return parent === null ? [] : [parent]
  }
  const list: string[] = Array.isArray(file.workspaces)
    ? file.workspaces.filter(whole).filter(allowed)
    : Array.isArray(file.recent)
      ? file.recent.filter(whole).flatMap(parentOf)
      : []
  const last = before ? (whole(project) ? parentOf(project)[0] : undefined) : whole(file.workspace) && allowed(file.workspace) ? file.workspace : undefined
  return { ...(last ? { workspace: last } : {}), ...(project ? { project } : {}), workspaces: [...new Set(list)].slice(0, MAX_RECENT) }
}

/** The folders as the first screen lists them: one that is no longer a folder is said to be missing, and stays until it is removed. */
export function listed(recent: readonly string[]): Promise<RecentFolder[]> {
  return Promise.all(
    recent.map(async (root) => ({
      root,
      missing: !(await stat(root).then(
        (s) => s.isDirectory(),
        () => false
      ))
    }))
  )
}
