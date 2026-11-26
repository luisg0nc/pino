// What the Brief page may have of a project besides its words and cards: the pictures and PDFs of `reference/`, and
// the web address behind a link. The window names a file or a link's place; what is read or opened is main's to find,
// so no path and no address is ever taken from the window.

import { lstat, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type CardsFile, linksIn } from '../../shared/cards'

const FOLDER = 'reference'
/** A photo or a doodle, as pino names them, or a PDF. */
const LISTED = /^(?:(?:photo|doodle)-\d+\.(?:png|jpe?g|webp)|[^.].*\.pdf)$/i
const MEDIA: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
export const MAX_REFERENCE_BYTES = 25 * 1024 * 1024

const isPlain = (path: string): Promise<boolean> =>
  lstat(path).then(
    (s) => s.isFile(),
    () => false
  )

/** The plain files of `<dir>/reference/` the page shows, by name; none when that folder is not there or is a link. */
export async function listReferences(dir: string): Promise<string[]> {
  const folder = join(dir, FOLDER)
  try {
    if (!(await lstat(folder)).isDirectory()) return []
    const entries = await readdir(folder, { withFileTypes: true })
    return entries.flatMap((e) => (e.isFile() && LISTED.test(e.name) ? [e.name] : [])).sort((a, b) => a.localeCompare(b, 'en'))
  } catch {
    return []
  }
}

/** A photo or a doodle of that list, whole; null for any other name, or a picture over the cap. */
export async function readReference(dir: string, file: string): Promise<{ mediaType: string; bytes: Uint8Array } | null> {
  const mediaType = MEDIA[file.slice(file.lastIndexOf('.') + 1).toLowerCase()]
  if (!mediaType || !(await listReferences(dir)).includes(file)) return null
  const path = join(dir, FOLDER, file)
  if (!(await isPlain(path)) || (await lstat(path)).size > MAX_REFERENCE_BYTES) return null
  return { mediaType, bytes: new Uint8Array(await readFile(path)) }
}

/**
 * The `nth` web address of a card's words (a card of main's own file), or of `brief.md` when `from` is `brief`; null
 * when there is none, or it is not an `http` or `https` address that reads as one.
 */
export function linkOf(file: CardsFile, brief: string | undefined, from: string, nth = 0): string | null {
  const text = from === 'brief' ? brief : file.cards.find((c) => c.id === from)?.text
  const link = text === undefined ? undefined : linksIn(text)[nth]
  if (link === undefined) return null
  try {
    const { protocol } = new URL(link)
    // The address as it is written, which is what the page shows.
    return protocol === 'http:' || protocol === 'https:' ? link : null
  } catch {
    return null
  }
}
