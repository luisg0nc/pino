import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import type { ProjectInfo } from '../shared/project'

/** `p` and the first 12 hex characters of the sha256 of the folder's real path: one URL segment, whatever the path holds. */
export const projectIdOf = (realDir: string): string => `p${createHash('sha256').update(realDir).digest('hex').slice(0, 12)}`

/**
 * A folder opened as a project, by its real path. Rejects, in words for the person, for a path that is not a whole
 * one, is not there, is not a folder, or may not be read.
 */
export async function openProject(dir: string): Promise<ProjectInfo> {
  const refused = (reason: string): Error => new Error(`${basename(dir) || dir} is not a folder pino can open: ${reason}`)
  // A relative path would be read from wherever pino itself was started.
  if (!isAbsolute(dir)) throw refused('it is not a whole path')
  let real: string
  try {
    real = await realpath(dir)
    if (!(await stat(real)).isDirectory()) throw refused('it is a file')
    await access(real, constants.R_OK | constants.X_OK)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === undefined) throw e
    throw refused(code === 'ENOENT' || code === 'ENOTDIR' ? 'it is not there' : code === 'EACCES' || code === 'EPERM' ? 'it cannot be read' : (e as Error).message)
  }
  return { id: projectIdOf(real), dir: real, name: basename(real) || real }
}
