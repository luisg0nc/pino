import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureIgnored } from './ignored'
import { FOLDER, whyNotOwn, writeOwn } from './own'

// The picture each project has on file for its card on the page of projects: the board of its newest build, drawn by
// the window while the project was open. Listing a project makes none and writes nothing.

export const THUMB_PNG = 'thumb.png'
export const THUMB_JSON = 'thumb.json'
/** The most a picture may weigh. */
export const THUMB_MAX_BYTES = 512 * 1024
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** `IHDR`: the chunk a PNG starts with. */
const PNG_FIRST_CHUNK = [0x49, 0x48, 0x44, 0x52]

/** Why bytes the window handed over are not kept as a picture, or null: a PNG, at most `THUMB_MAX_BYTES`. */
export function thumbnailRefusal(png: Uint8Array): string | null {
  const notPng = 'A thumbnail is a PNG; this is not one.'
  if (!(png instanceof Uint8Array)) return notPng
  if (png.length > THUMB_MAX_BYTES) return 'A thumbnail is at most 512 KB.'
  if (png.length < 24 || PNG_HEAD.some((byte, i) => png[i] !== byte) || PNG_FIRST_CHUNK.some((byte, i) => png[12 + i] !== byte)) return notPng
  return null
}

/** The last save of each folder: a picture and its facts are written as a pair, one pair after the other. */
const saves = new Map<string, Promise<void>>()

/**
 * Keeps a picture of a project and the build it is of, by its hash: `<dir>/.pino/thumb.png`, then `thumb.json`, each
 * whole or not at all, and one save of a folder after the other, so that the last one asked for is what is there. Git
 * is told to pass over the two, which change with the builds (`ensureIgnored`).
 */
export function saveThumbnail(dir: string, png: Uint8Array, of: { hash: string }, now: Date): Promise<void> {
  const save = (saves.get(dir) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await writeOwn(dir, THUMB_PNG, png)
      await writeOwn(dir, THUMB_JSON, `${JSON.stringify({ hash: of.hash, at: now.toISOString() })}\n`)
      await ensureIgnored(dir, [THUMB_PNG, THUMB_JSON])
    })
    .finally(() => {
      if (saves.get(dir) === save) saves.delete(dir)
    })
  saves.set(dir, save)
  return save
}

/**
 * The picture a folder has on file, when it is one a card may show: a plain file reached through no link, at most
 * `THUMB_MAX_BYTES` (a larger one is not read at all), and a PNG. Null otherwise.
 */
export async function thumbnailOnFile(dir: string): Promise<Uint8Array | null> {
  const path = join(dir, FOLDER, THUMB_PNG)
  try {
    if ((await whyNotOwn(dir)) !== null) return null
    const there = await lstat(path)
    if (!there.isFile() || there.size > THUMB_MAX_BYTES) return null
    const png = await readFile(path)
    return thumbnailRefusal(png) === null ? png : null
  } catch {
    return null
  }
}
