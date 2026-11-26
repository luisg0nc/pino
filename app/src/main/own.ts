import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { APP } from '../shared/app'
import { writeFileAtomic } from './atomic'

// `<project>/.pino/`: the one folder of a project pino writes into. Its name comes from here and nowhere else,
// and so is the rule every write there is held to: it is a real folder inside the project. A link in its place
// (a project cloned or copied from elsewhere may hold one) would have pino write wherever it leads, outside
// the project; a file in its place is nothing to write into. Either is refused before anything is written, with
// a sentence the person can act on, and the window is told of it once for each folder.
//
// The folders pino keeps under it (`chat`, and later `build`, `routes` and `marks`) are held to the
// same rule by the same function: whoever writes or deletes there names the folder, and a link in its place is
// refused before anything is written or deleted, and told once.

/** The name of pino's own folder in a project's folder. */
export const FOLDER = APP.folder

/**
 * Who hears of a folder that is not pino's own: the project's folder, the refusal, and which folder under
 * `.pino` it is of (`chat`); null for `.pino` itself, where nothing of the project is kept.
 */
export type NotOwnListener = (dir: string, message: string, inside: string | null) => void

/** The folders the window was told of, by their paths. */
const told = new Set<string>()
let listener: NotOwnListener | null = null

/** Who is told, once for each folder, that it is not pino's own to write into. Null for no one, and whoever is named next is told anew. */
export function onNotOwn(cb: NotOwnListener | null): void {
  listener = cb
  told.clear()
}

function refused(dir: string, path: string, inside: string | null, message: string): Error {
  if (!told.has(path)) {
    told.add(path)
    try {
      listener?.(dir, message, inside)
    } catch {
      // Whoever listens is not a reason to say something else of the folder.
    }
  }
  return new Error(message)
}

/** What stands at `<dir>/.pino` and the names under it: the folder pino may write into, or why it may not. */
async function look(dir: string, inside: string[]): Promise<{ folder: string } | { path: string; name: string | null; message: string }> {
  let path = join(dir, FOLDER)
  for (let depth = 0; ; depth++) {
    const what = await lstat(path).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    // Not there: nothing under it is either, and whoever writes makes real folders.
    if (what === null) return { folder: join(dir, FOLDER, ...inside) }
    const name = depth === 0 ? null : inside.slice(0, depth).join('/')
    if (what.isSymbolicLink()) {
      const message =
        name === null
          ? `${path} is a link, not a folder of ${APP.name}'s own inside the project: ${APP.name} writes nothing there. Put a real folder in its place.`
          : `${path} is a link, not a folder of ${APP.name}'s own inside the project: ${APP.name} writes nothing there and deletes nothing through it. Take the link away.`
      return { path, name, message }
    }
    if (!what.isDirectory()) return { path, name, message: `${path} is a file, not a folder: ${APP.name} writes nothing there. Remove it.` }
    if (depth === inside.length) return { folder: path }
    path = join(path, inside[depth])
  }
}

/**
 * `<dir>/.pino`, when pino may write there: it is a real folder, or not there yet (whoever writes makes it).
 * Rejects, with a plain reason, when a link or a file is in its place. Asked before every write under it.
 *
 * With names after the folder (`ownFolder(dir, 'chat')`), the folder of that name under it, held to the
 * same at every step down: asked before every write into it and before every delete in it.
 */
export async function ownFolder(dir: string, ...inside: string[]): Promise<string> {
  const found = await look(dir, inside)
  if ('folder' in found) return found.folder
  throw refused(dir, found.path, found.name, found.message)
}

/**
 * Why pino may not use `<dir>/.pino/...`, or null when it may, said to the caller alone: the window is not told, so
 * that what is only read, or shown elsewhere, does not use up the one time it is told of a folder.
 */
export async function whyNotOwn(dir: string, ...inside: string[]): Promise<string | null> {
  const found = await look(dir, inside)
  return 'folder' in found ? null : found.message
}

/** The last `writeOwn` of each file: the folder check is awaited before `writeFileAtomic` has the path, so the line is kept here, taken before any await. */
const saves = new Map<string, Promise<void>>()

/**
 * Writes `<dir>/.pino/<name>` whole or not at all (`writeFileAtomic`), once the folder is known to be pino's own.
 * Writes of one file land in the order `writeOwn` was called, however long each folder check takes.
 */
export function writeOwn(dir: string, name: string, data: string | Uint8Array): Promise<void> {
  const key = join(dir, FOLDER, name)
  const save = (saves.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => writeFileAtomic(join(await ownFolder(dir), name), data))
    .finally(() => {
      if (saves.get(key) === save) saves.delete(key)
    })
  saves.set(key, save)
  return save
}
