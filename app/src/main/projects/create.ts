import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstatSync, readdirSync, rmSync } from 'node:fs'
import { type FileHandle, lstat, mkdir, open, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { APP } from '../../shared/app'
import type { CreateRequest } from '../../shared/bridge'
import { linkProblem, MAX_LINK_NOTE, MAX_LINKS, MAX_PDF_BYTES, MAX_PHOTO_BYTES, MOST_REFERENCES, PDF_FORMATS, projectNameProblem, referenceFiles } from '../../shared/projectName'
import { MAX_SIZES, checkSize } from '../../shared/size'
import { LCSC, MAX_TEXT_CHARS } from '../../shared/cards'
import { checkConnection, checkFab, checkPartHad, checkPower, MAX_CONNECTIONS, MAX_PARTS_HAD, MAX_POWER, MAX_SHAPE_NOTE } from '../../shared/slots'
import { writeFileAtomic } from '../atomic'
import { FILE, textOf } from '../cards/file'
import { startCards, type StartRequest } from '../cards/start'
import { FOLDER } from '../own'
import type { Readings } from './readings'

// Making a project is the one thing pino writes in a workspace outside `<project>/.pino/`: one new folder,
// `<root>/<name>/`, with `brief.md`, `reference/` and the cards. Everything is made in a hidden
// folder beside it (`.<name>.pino-new-<random>`, which the listing of a workspace never shows) and that
// folder takes the name as the last step, so that the folder is whole or not there. Nothing that exists is
// written into or replaced; whatever the window sent is checked here again.

/** The most of each kind of reference. */
export const MOST = MOST_REFERENCES
/** The biggest photo, and the biggest doodle, in bytes. */
export const MAX_PHOTO = MAX_PHOTO_BYTES
/** The biggest PDF, in bytes (25 MB). */
export const MAX_PDF = MAX_PDF_BYTES
export const MAX_DOODLE = 8 * 1024 * 1024
/** The longest description and the longest note, in characters. */
const MAX_DESCRIPTION = 20_000
const MAX_NOTE = 2_000
/** What the cards take of the rest: the rules (a card holds this much), the links, and a link's note. */
export const MAX_RULES = MAX_TEXT_CHARS
export { MAX_LINKS }
const PDF_SIGNATURE = '%PDF-'
const PHOTO_TYPES = ['.png', '.jpg', '.jpeg', '.webp']
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface CreateDeps {
  /** The open workspace's folder. */
  root: string
  /** The stock readings main gave this run: a part card's reading is one of these, never the window's. */
  readings: Readings
  /** For tests: called with the temp folder when everything is written, before it takes the name. */
  hooks?: {
    /** Called with the temp folder once it is made, before anything is written in it. */
    afterTemp?: (temp: string) => void | Promise<void>
    /** Called with the temp folder when the files are written, before the cards are. */
    beforeCards?: (temp: string) => void | Promise<void>
    beforeRename?: (temp: string) => void | Promise<void>
  }
}

/** What a crash before the rename leaves: `.<name>.pino-new-<12 hex>`. Nothing else is ours to remove. */
const TEMP_FOLDER = new RegExp(`^\\.[A-Za-z0-9][A-Za-z0-9._-]*\\.${APP.name}-new-[0-9a-f]{12}$`)
/** A new one's name for a project of this name: hidden, so that no listing shows it. */
const tempName = (name: string): string => `.${name}.${APP.name}-new-${randomBytes(6).toString('hex')}`

/** How old a hidden folder is before it is taken for a crash's: no create takes this long, however big the photos. */
export const STALE_AFTER_MS = 10 * 60 * 1000

/** Whether a crashed create's folder holds files in `reference/`: the doodles in it exist nowhere else, so it is left for the person. */
function holdsReferences(folder: string): boolean {
  try {
    return readdirSync(join(folder, 'reference')).length > 0
  } catch {
    return false
  }
}

/**
 * Removes the hidden folders of a create that never ended (`.<name>.pino-new-<random>`) from the root of a
 * workspace, when they are real folders last changed more than 10 minutes before `now` (another pino may be
 * creating in the same workspace) and hold nothing in `reference/` (what the person gave is not deleted). A link of that name is left alone, as is
 * whatever it leads to. Whatever cannot be removed is left; nothing is said.
 */
export function sweepStaleNew(root: string, now: number): void {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return
  }
  for (const name of names) {
    if (!TEMP_FOLDER.test(name)) continue
    try {
      const stat = lstatSync(join(root, name))
      if (stat.isDirectory() && stat.mtimeMs < now - STALE_AFTER_MS && !holdsReferences(join(root, name))) rmSync(join(root, name), { recursive: true, force: true })
    } catch {
      // Gone, or not ours to remove.
    }
  }
}

/** What the window sent as a sentence in one line: a note is a line of `brief.md`. */
export function oneLine(note: unknown, what: string): string {
  if (note === undefined || note === null) return ''
  if (typeof note !== 'string') throw new Error(`The note of a ${what} is not text.`)
  if (note.length > 10 * MAX_NOTE) throw new Error(`The note of a ${what} is over ${MAX_NOTE} characters.`)
  const folded = note.replace(/\s+/g, ' ').trim()
  if (folded.length > MAX_NOTE) throw new Error(`The note of a ${what} is over ${MAX_NOTE} characters.`)
  return folded
}

const line = (what: string, note: string): string => (note === '' ? `- ${what}` : `- ${what}: ${note}`)

/**
 * A plain file opened for reading, of at most `cap` bytes, and nothing else: a link, a folder, a pipe and a file that
 * is too big are refused before any of it is read. The file is opened without following a link and looked at
 * through the open handle, so that what was checked is what is read. The caller closes the handle.
 */
async function openRegular(path: unknown, cap: number, what: string, types: readonly string[]): Promise<{ handle: FileHandle; size: number; ext: string; path: string }> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`A ${what} is given by the path of a file; this is not one.`)
  const ext = extname(path).toLowerCase()
  if (!types.includes(ext)) throw new Error(`${path} is not a ${types.join(', ')} file.`)
  const stat = await lstat(path).catch(() => null)
  if (!stat) throw new Error(`${path} is not there.`)
  if (!stat.isFile()) throw new Error(`${path} is ${stat.isSymbolicLink() ? 'a link' : 'not a plain file'}: pino copies only plain files.`)
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => {
    throw new Error(`${path} cannot be opened as a plain file.`)
  })
  try {
    const opened = await handle.stat()
    if (!opened.isFile()) throw new Error(`${path} is not a plain file: pino copies only plain files.`)
    if (opened.size > cap) throw new Error(`${path} is over ${cap / (1024 * 1024)} MB.`)
    return { handle, size: opened.size, ext, path }
  } catch (e) {
    await handle.close()
    throw e
  }
}

/** The bytes of a regular file of at most `cap` bytes, and nothing else (`openRegular`). */
export async function readRegular(path: unknown, cap: number, what: string, types: readonly string[] = PHOTO_TYPES): Promise<{ bytes: Buffer; ext: string }> {
  const { handle, size, ext, path: at } = await openRegular(path, cap, what, types)
  try {
    // One byte more than the size said: a file that grew since is caught, not read whole.
    const bytes = Buffer.alloc(size + 1)
    let got = 0
    while (got < bytes.length) {
      const { bytesRead } = await handle.read(bytes, got, bytes.length - got, got)
      if (bytesRead === 0) break
      got += bytesRead
    }
    if (got > size) throw new Error(`${at} changed while it was read.`)
    return { bytes: bytes.subarray(0, got), ext }
  } finally {
    await handle.close()
  }
}

/** Whether `bytes` start as a PDF does. */
const isPdf = (bytes: Uint8Array): boolean => PDF_SIGNATURE.split('').every((c, i) => bytes[i] === c.charCodeAt(0))

/** Looks at a PDF without reading it: a plain file of at most 25 MB that starts `%PDF-`. Throws the reason. */
async function checkPdf(path: unknown): Promise<void> {
  const { handle, path: at } = await openRegular(path, MAX_PDF, 'PDF', PDF_FORMATS)
  try {
    const head = Buffer.alloc(PDF_SIGNATURE.length)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    if (bytesRead < head.length || !isPdf(head)) throw new Error(`${at} is not a PDF: it does not start with ${PDF_SIGNATURE}.`)
  } finally {
    await handle.close()
  }
}

/**
 * The bytes of an image file the window was given by a dialog or a drop, for it to draw a thumbnail and scale a
 * copy for the first prompt (it cannot read a file itself). The same file rules as a photo copied into `reference/`.
 */
export async function readPhoto(path: unknown): Promise<Uint8Array> {
  const { bytes } = await readRegular(path, MAX_PHOTO, 'photo')
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length)
}

/** A link: `http` or `https` only (any case of the scheme), one word, a host, at most 2000 characters. */
export function checkLink(link: unknown): { url: string; note: string } {
  const url = (link as { url?: unknown } | null)?.url
  const problem = linkProblem(url)
  if (problem !== null) throw new Error(problem)
  const note = oneLine((link as { note?: unknown }).note, 'link')
  if (note.length > MAX_LINK_NOTE) throw new Error(`The note of a link is over ${MAX_LINK_NOTE} characters.`)
  return { url: url as string, note }
}

/** Holds a list of the request to what it may be: a list, of at most `most`. */
function checkList(list: unknown, most: number, named: string): asserts list is unknown[] {
  if (!Array.isArray(list)) throw new Error(`The ${named} are not a list.`)
  if (list.length > most) throw new Error(`At most ${most} ${named}.`)
}

/** Each row through its check, which answers the row or why it is refused. */
const rows = <T>(list: readonly unknown[], check: (raw: unknown) => T | string): T[] =>
  list.map((raw) => {
    const row = check(raw)
    if (typeof row === 'string') throw new Error(row)
    return row
  })

/** A field of Size and shape: text of one line, within its cap. */
function shapeText(value: unknown, as: string): string {
  if (typeof value !== 'string') throw new Error(`The ${as} is not text.`)
  const folded = value.replace(/\s+/g, ' ').trim()
  if (folded.length > MAX_SHAPE_NOTE) throw new Error(`The ${as} is at most ${MAX_SHAPE_NOTE} characters.`)
  return folded
}

/** The request, held to what it may be; throws a plain reason. Returns what the cards are made from. */
async function checked(req: CreateRequest, deps: CreateDeps, existing: readonly string[]): Promise<StartRequest> {
  if (typeof req !== 'object' || req === null) throw new Error('No project to make.')
  if (typeof req.name !== 'string') throw new Error('Give the project a name.')
  const problem = projectNameProblem(req.name, existing)
  if (problem) throw new Error(problem)
  if (typeof req.description !== 'string' || req.description.trim() === '') throw new Error('Say what it does first.')
  if (req.description.length > MAX_DESCRIPTION) throw new Error(`The description is over ${MAX_DESCRIPTION} characters.`)
  checkList(req.photos, MOST.photos, 'photos')
  checkList(req.doodles, MOST.doodles, 'doodles')
  checkList(req.pdfs, MOST.pdfs, 'PDFs')
  checkList(req.power, MAX_POWER, 'power rows')
  checkList(req.connections, MAX_CONNECTIONS, 'connections')
  checkList(req.parts, MAX_PARTS_HAD, 'parts')
  for (const photo of req.photos) {
    if (photo !== null && typeof photo === 'object' && 'png' in photo && !('path' in photo)) checkedPng(photo.png, 'photo')
    else if (typeof (photo as { path?: unknown })?.path !== 'string' || 'png' in photo) throw new Error('A photo is given by the path of a file, or as the bytes of a PNG; this is neither.')
    oneLine(photo.note, 'photo')
  }
  for (const doodle of req.doodles) {
    oneLine(doodle?.note, 'doodle')
    const over = doodle?.over
    if (doodle?.onPhoto !== undefined && doodle.onPhoto !== true) throw new Error('A doodle is over a photo or it is not.')
    if (over !== undefined && (!Number.isInteger(over) || over < 0 || over >= req.photos.length)) throw new Error('A doodle is drawn over one of the photos given.')
  }
  for (const pdf of req.pdfs) {
    if (typeof pdf?.path !== 'string' || !isAbsolute(pdf.path) || !(PDF_FORMATS as readonly string[]).includes(extname(pdf.path).toLowerCase())) {
      throw new Error('A PDF is a .pdf file given by its path.')
    }
    oneLine(pdf.note, 'PDF')
  }
  for (const [kind, keys] of [['photo', req.photos.flatMap((p) => ('path' in p ? [p.path] : []))], ['PDF', req.pdfs.map((p) => p.path)]] as const) {
    if (new Set(keys).size !== keys.length) throw new Error(`The same ${kind} is given twice.`)
  }
  checkList(req.sizes, MAX_SIZES, 'sizes')
  const sizes = rows(req.sizes, (raw) => checkSize(raw, 'person'))
  const power = rows(req.power, checkPower)
  const connections = rows(req.connections, checkConnection)
  // A part's reading is the one main gave for its number: the row's own fields are all that is taken from the window.
  const parts = rows(req.parts, checkPartHad).map((part) => {
    const reading = LCSC.test(part.what) ? deps.readings.get(part.what) : undefined
    return reading ? { ...part, reading } : part
  })
  const fab = req.fab === null ? null : rows([req.fab], checkFab)[0]
  const enclosure = shapeText(req.enclosure, 'enclosure')
  const edges = shapeText(req.edges, 'note on the connector edges')
  if (typeof req.rules !== 'string') throw new Error('The rules are not text.')
  if (req.rules.length > MAX_RULES) throw new Error(`The rules are over ${MAX_RULES} characters.`)
  checkList(req.links, MAX_LINKS, 'links')
  const links = req.links.map(checkLink)
  // The files last, the one thing that reads the disk: each is looked at, not read, so that nothing is made for a PDF that is no good.
  for (const pdf of req.pdfs) await checkPdf(pdf.path)
  return { power, connections, sizes, enclosure, edges, parts, fab, rules: req.rules, links }
}

/** The bytes of a PNG that main writes (a doodle, or a picture pasted as a photo); rejects with what is wrong. */
function checkedPng(png: unknown, what: 'doodle' | 'photo'): Uint8Array {
  const article = what === 'doodle' ? 'A doodle' : 'A pasted photo'
  if (!(png instanceof Uint8Array)) throw new Error(`${article} is the bytes of a PNG.`)
  if (png.length > MAX_DOODLE) throw new Error(`${article} is at most 8 MB.`)
  if (png.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => png[i] !== b)) throw new Error(`${article} is a PNG; this is not one.`)
  return png
}

/** The extension `reference/photo-<n>` has: that of the file it is copied from, or `.png` for a pasted picture. */
const photoExt = (photo: CreateRequest['photos'][number]): string => ('path' in photo ? extname(photo.path).toLowerCase() : '.png')

/**
 * Makes `<root>/<name>/` and answers with the project's name. Rejects, with the reason, when it could not, and
 * then nothing of it is left. The caller refreshes the workspace's listing.
 */
export async function createProject(req: CreateRequest, deps: CreateDeps): Promise<{ name: string }> {
  const name = typeof req?.name === 'string' ? req.name : ''
  const target = join(deps.root, name)
  const slots = await checked(req, deps, await readdir(deps.root))
  const temp = join(deps.root, tempName(name))
  let claimed = false
  await mkdir(temp)
  try {
    await deps.hooks?.afterTemp?.(temp)
    const references: string[] = []
    const reference = (file: string, note: string): void => void references.push(line(file, note))
    let n = 0
    for (const photo of req.photos) {
      const { bytes, ext } = 'path' in photo ? await readRegular(photo.path, MAX_PHOTO, 'photo') : { bytes: photo.png, ext: '.png' }
      const file = `reference/photo-${++n}${ext}`
      await writeFileAtomic(join(temp, file), bytes)
      reference(file, oneLine(photo.note, 'photo'))
    }
    n = 0
    for (const doodle of req.doodles) {
      const png = checkedPng(doodle?.png, 'doodle')
      const file = `reference/doodle-${++n}.png`
      await writeFileAtomic(join(temp, file), png)
      const note = oneLine(doodle.note, 'doodle')
      const over = doodle.over !== undefined ? `drawn over reference/photo-${doodle.over + 1}${photoExt(req.photos[doodle.over])}` : doodle.onPhoto ? 'drawn over a photo' : ''
      reference(file, over === '' ? note : note === '' ? over : `${note} (${over})`)
    }
    const pdfNames = referenceFiles(req.pdfs.map((pdf) => pdf.path), PDF_FORMATS)
    for (const [i, pdf] of req.pdfs.entries()) {
      // Copied as it is, under its own name, once it is read whole: a PDF that is no PDF is not kept.
      const { bytes } = await readRegular(pdf.path, MAX_PDF, 'PDF', PDF_FORMATS)
      if (!isPdf(bytes)) throw new Error(`${pdf.path} is not a PDF: it does not start with ${PDF_SIGNATURE}.`)
      await writeFileAtomic(join(temp, pdfNames[i]), bytes)
      reference(pdfNames[i], oneLine(pdf.note, 'PDF'))
    }
    const brief = [`# ${name}`, '', req.description.trim(), ...(references.length ? ['', '## References', '', ...references] : []), ''].join('\n')
    await writeFileAtomic(join(temp, 'brief.md'), brief)
    // The cards, whole in the hidden folder like the rest. Nothing else of `.pino/` is written; its `.gitignore`
    // lines are the store's, when it first writes what they are for.
    await deps.hooks?.beforeCards?.(temp)
    await writeFileAtomic(join(temp, FOLDER, 'brief', FILE), textOf(startCards(slots)))

    await deps.hooks?.beforeRename?.(temp)
    // The name is taken by making it, which fails if it is there (in any case, on a disk that does not tell them
    // apart): then the finished folder takes the place of that empty one, which refuses to be replaced if anyone
    // put anything in it meanwhile. The last step.
    await mkdir(target).catch((e: NodeJS.ErrnoException) => {
      throw e.code === 'EEXIST' ? new Error(`A folder \`${name}\` is there already.`) : e
    })
    // Only a folder made here is removed again.
    claimed = true
    // A folder that had something put in it meanwhile is not replaced: the rename fails.
    await rename(temp, target).catch((e: NodeJS.ErrnoException) => {
      throw e.code === 'ENOTEMPTY' || e.code === 'EEXIST' ? new Error(`A folder \`${name}\` is there already.`) : e
    })
  } catch (e) {
    if (claimed) await rmdir(target).catch(() => {})
    await rm(temp, { recursive: true, force: true }).catch(() => {})
    throw e
  }
  return { name }
}
