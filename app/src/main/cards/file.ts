import { copyFile, lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type Card, type CardKind, type CardsFile, type CardTurn, type CardWas, type FabAsk, type PartFact, type PartReading, CARD_ID, CARD_KINDS, emptyCards, LCSC, MAX_NAME_CHARS, MAX_TEXT_CHARS, MAX_WAS } from '../../shared/cards'
import { checkSize } from '../../shared/size'
import { checkFab } from '../../shared/slots'
import { FOLDER, ownFolder, writeOwn } from '../own'

const FOLDER_NAME = 'brief'
export const FILE = 'cards.json'
const KINDS: readonly CardKind[] = CARD_KINDS

/** The text of a cards file: what is written, and what a change is compared with. */
export const textOf = (file: CardsFile): string => `${JSON.stringify(file, null, 2)}\n`

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const str = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.length <= max ? value : undefined)
const idNumber = (id: string): number => Number(id.slice(1))

const PART_CLASSES = ['basic', 'preferred', 'extended'] as const
/** The longest name of a part's package. */
const MAX_PACKAGE = 120

/** A part's reading, whole and with only its fields; undefined when it is not one. */
function readingOfFile(value: unknown): PartReading | undefined {
  if (!isRecord(value)) return undefined
  const checkedAt = timeOf(value.checkedAt)
  const fresh = value.fresh
  if (checkedAt === undefined || typeof fresh !== 'boolean') return undefined
  if (value.missing === true) return { missing: true, checkedAt, fresh }
  const kind = PART_CLASSES.find((c) => c === value.class)
  const pack = str(value.package, MAX_PACKAGE)
  const { stock, price } = value
  if (!kind || pack === undefined || (stock !== null && !finite(stock)) || (price !== null && !finite(price))) return undefined
  return { class: kind, package: pack, stock, price, checkedAt, fresh }
}

/** What a part card names: null when it names a number that is not an LCSC one, and undefined when it names none. */
function partOf(value: unknown): PartFact | null | undefined {
  if (!isRecord(value) || value.lcsc === undefined) return undefined
  if (typeof value.lcsc !== 'string' || !LCSC.test(value.lcsc)) return null
  const reading = readingOfFile(value.reading)
  return { lcsc: value.lcsc, ...(reading ? { reading } : {}) }
}

/** What a fab card asks, whole; undefined when it is not. The rule is the New project page's (`checkFab`). */
export function fabOf(value: unknown): FabAsk | undefined {
  const checked = checkFab(value)
  return typeof checked === 'string' ? undefined : checked
}

/** The longest id of a prompt or a conversation a card keeps. */
const MAX_TURN_ID = 200

/** A prompt as a card names it (`turn`), with only its two fields; undefined when it is not one. */
function turnOf(value: unknown): CardTurn | undefined {
  if (!isRecord(value)) return undefined
  const prompt = str(value.prompt, MAX_TURN_ID)
  if (prompt === undefined || prompt === '') return undefined
  const conversation = str(value.conversation, MAX_TURN_ID)
  return { prompt, ...(conversation !== undefined && conversation !== '' ? { conversation } : {}) }
}

/** A time as a card keeps it: ISO 8601 that reads as a date; undefined otherwise. */
const timeOf = (value: unknown): string | undefined => (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : undefined)

/** What a card said before its edits, each whole, the last `MAX_WAS`; undefined when none is. */
function wasOf(value: unknown): CardWas[] | undefined {
  if (!Array.isArray(value)) return undefined
  const kept = value.flatMap((one): CardWas[] => {
    if (!isRecord(one)) return []
    const text = str(one.text, MAX_TEXT_CHARS)
    if (text === undefined) return []
    const turn = turnOf(one.turn)
    const at = timeOf(one.at)
    return [{ text, ...(turn ? { turn } : {}), ...(at ? { at } : {}) }]
  })
  return kept.length > 0 ? kept.slice(-MAX_WAS) : undefined
}

/** A card as the file holds it, with only the fields this version knows and each of the right shape; null when it is not a card. */
export function sanitiseCard(value: unknown): Card | null {
  if (!isRecord(value)) return null
  const { id, kind, by } = value
  if (typeof id !== 'string' || !CARD_ID.test(id) || !KINDS.includes(kind as CardKind)) return null
  if (by !== 'person' && by !== 'agent') return null
  const card: Card = { id, kind: kind as CardKind, by }
  if (typeof value.frame === 'string' && CARD_ID.test(value.frame)) card.frame = value.frame
  if (card.kind === 'frame') {
    const name = str(value.name, MAX_NAME_CHARS)
    if (name !== undefined) card.name = name
  } else {
    const text = str(value.text, MAX_TEXT_CHARS)
    if (text !== undefined) card.text = text
  }
  const turn = turnOf(value.turn)
  if (turn) card.turn = turn
  const at = timeOf(value.at)
  if (at !== undefined) card.at = at
  const was = wasOf(value.was)
  if (was) card.was = was
  // A card the person made theirs: it was the agent's (#339). Only on the person's.
  if (card.by === 'person' && isRecord(value.from) && value.from.by === 'agent') {
    const from = value.from
    const fromTurn = turnOf(from.turn)
    const fromAt = timeOf(from.at)
    const since = timeOf(from.since)
    card.from = { by: 'agent', ...(fromTurn ? { turn: fromTurn } : {}), ...(fromAt !== undefined ? { at: fromAt } : {}), ...(since !== undefined ? { since } : {}) }
  }
  // A kind's own field is kept only on a card of that kind. A size or a fab card without a whole one is not a card, nor
  // is a part card that names a number that is not an LCSC one.
  if (card.kind === 'size') {
    let size = checkSize(value.size, card.by === 'agent' ? 'agent' : 'person')
    // A size of Claude's the person made theirs keeps Claude's source until they say where it came from.
    if (typeof size === 'string' && card.from?.by === 'agent' && (value.size as { source?: unknown } | undefined)?.source === 'from Claude') size = checkSize(value.size, 'agent')
    if (typeof size === 'string') return null
    card.size = size
  }
  if (card.kind === 'part') {
    const part = partOf(value.part)
    if (part === null) return null
    if (part) card.part = part
  }
  if (card.kind === 'fab') {
    const fab = fabOf(value.fab)
    if (!fab) return null
    card.fab = fab
  }
  return card
}

/** The next number to hand out, never at or below an id in use. */
export const nextAbove = (next: number, cards: readonly Card[]): number => Math.max(next, ...cards.map((c) => idNumber(c.id) + 1), 1)

/**
 * What a cards file may hold: the cards that are whole, each id once, every `frame` naming a frame that is there (a
 * card that does not is dropped, and so are the cards in it, and so on). `dropped` counts what was left out. Null when
 * the value is no cards file at all.
 */
export function readCardsFile(value: unknown): { file: CardsFile; dropped: number } | null {
  if (!isRecord(value) || !Array.isArray(value.cards)) return null
  const seen = new Set<string>()
  let cards: Card[] = []
  let dropped = 0
  for (const raw of value.cards) {
    const card = sanitiseCard(raw)
    if (!card || seen.has(card.id)) {
      dropped += 1
      continue
    }
    seen.add(card.id)
    cards.push(card)
  }
  for (;;) {
    const frames = new Set(cards.filter((c) => c.kind === 'frame' && c.frame === undefined).map((c) => c.id))
    const kept = cards.filter((c) => c.frame === undefined || frames.has(c.frame))
    if (kept.length === cards.length) break
    dropped += cards.length - kept.length
    cards = kept
  }
  const next = finite(value.next) && Number.isInteger(value.next) ? value.next : 1
  return { file: { next: nextAbove(next, cards), cards }, dropped }
}

/** The highest `C<n>` a file's text shows anywhere, plus one: where ids go on from when cards of it are lost. A part's LCSC number reads the same and is no id. */
function salvagedNext(text: string): number {
  let highest = 0
  for (const match of text.matchAll(/"C([1-9]\d*)"/g)) {
    if (/"lcsc"\s*:\s*$/.test(text.slice(Math.max(0, match.index - 16), match.index))) continue
    highest = Math.max(highest, Number(match[1]))
  }
  return highest + 1
}

/**
 * The text of the project's `cards.json`: null when there is none, or when what stands in its place is not a plain file
 * (a link would have pino read, and copy aside, whatever it leads to).
 */
export async function diskText(dir: string): Promise<string | null> {
  const path = join(dir, FOLDER, FOLDER_NAME, FILE)
  try {
    if (!(await lstat(path)).isFile()) return null
    return await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return null
    throw e
  }
}

/**
 * The cards of the project in `dir`; `text` is what the file holds afterwards (null: no file). A missing file is no
 * cards, and nothing is written. A link or a folder in the file's place is not read: no cards and a `problem` (the
 * next write puts a file there). A file that is no cards file (a merge left its marks in it) is copied aside as
 * `cards.json.corrupt-<time>` and a new one started. A file with cards that are not whole (a newer pino wrote a kind
 * this one lacks) is copied aside as `cards.json.dropped-<time>` and the others kept. Either way the ids go on above
 * every one the old file shows, the file is rewritten at once, and `problem` says so.
 */
export async function loadCardsFile(dir: string, now: () => Date = () => new Date()): Promise<{ file: CardsFile; text: string | null; problem?: string }> {
  const path = join(dir, FOLDER, FOLDER_NAME, FILE)
  const exists = await lstat(path).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false
      throw e
    }
  )
  const text = await diskText(dir)
  if (text === null) {
    if (!exists) return { file: emptyCards(), text: null }
    return { file: emptyCards(), text: null, problem: `${FOLDER}/${FOLDER_NAME}/${FILE} of this project is not a plain file, so pino did not read it. Its next change puts a cards file there.` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON
  }
  const read = readCardsFile(parsed)
  if (read && read.dropped === 0) return { file: read.file, text }

  const stamp = now().toISOString().replace(/[:.]/g, '-')
  await ownFolder(dir, FOLDER_NAME)
  const aside = `${FILE}.${read ? 'dropped' : 'corrupt'}-${stamp}`
  const kept = `${FOLDER}/${FOLDER_NAME}/${aside}`
  // Copied, not moved: were the write below to fail, the next read must find the bad file again, and its ids with it.
  await copyFile(path, join(dir, FOLDER, FOLDER_NAME, aside))
  const file: CardsFile = read ? { next: Math.max(read.file.next, salvagedNext(text)), cards: read.file.cards } : { next: salvagedNext(text), cards: [] }
  await saveCardsFile(dir, file)
  if (!read) return { file, text: textOf(file), problem: `The cards file of this project could not be read. It was kept as ${kept}, and a new one was started.` }
  const what = read.dropped === 1 ? '1 card in the cards file of this project was' : `${read.dropped} cards in the cards file of this project were`
  return { file, text: textOf(file), problem: `${what} not whole, and left out. The file as it was is kept as ${kept}.` }
}

/** Writes `<dir>/.pino/brief/cards.json` whole or not at all, once the folders are known to be pino's own. */
export async function saveCardsFile(dir: string, file: CardsFile): Promise<void> {
  await ownFolder(dir, FOLDER_NAME)
  await writeOwn(dir, `${FOLDER_NAME}/${FILE}`, textOf(file))
}
