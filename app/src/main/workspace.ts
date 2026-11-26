import { lstat, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ListedProject, WorkspaceInfo } from '../shared/workspace'

/** Whether this is a plain file, not a link to one: a link could lead out of the project. */
async function plainFile(path: string): Promise<boolean> {
  return lstat(path).then(
    (s) => s.isFile(),
    () => false
  )
}

/**
 * The projects of a workspace: every direct subfolder that is not hidden and not a link, by name. One that holds
 * neither `board.py` nor `brief.md` is listed as empty.
 */
export async function scanWorkspace(root: string): Promise<WorkspaceInfo> {
  const entries = await readdir(root, { withFileTypes: true })
  const projects: ListedProject[] = []
  for (const entry of entries) {
    const name = entry.name
    if (name.startsWith('.') || !entry.isDirectory()) continue
    const dir = join(root, name)
    const [board, brief] = await Promise.all([plainFile(join(dir, 'board.py')), plainFile(join(dir, 'brief.md'))])
    projects.push({ name, dir, board, brief, empty: !board && !brief })
  }
  projects.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return { root, name: basename(root) || root, projects }
}

/**
 * Orders scans of one workspace that may overlap and end in any order. Call
 * what it returns when a scan begins; what that returns is asked when the scan
 * has ended, and says whether its result may be kept: not when a scan begun
 * later has already been kept, which is the newer word on the folder.
 */
export function scanOrder(): () => () => boolean {
  let begun = 0
  let kept = 0
  return () => {
    const mine = ++begun
    return () => {
      if (mine < kept) return false
      kept = mine
      return true
    }
  }
}
