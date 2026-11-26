import { createHash } from 'node:crypto'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { briefWords } from '../../shared/brief'
import { type Card, type CardKind, type CardsFile, fabText, readingLine, readingOrder } from '../../shared/cards'
import { saySize } from '../../shared/size'

// The Brief as Claude reads it: what the `brief` tool answers, and the one line a prompt carries (what is new since
// Claude was last told). Beside them, `brief.md` as main reads it. The two texts are pure.

export const CUT_SENTENCE = 'The rest of the Brief is cut here: narrow it with kind.'
/** The most of `brief.md`'s words the `brief` tool gives. */
export const BRIEF_LIMIT = 2000
/** The most of `brief.md` that is read, in characters. */
export const MAX_BRIEF_CHARS = 64_000
/** The most cards a line names as new. */
const MOST_NAMED = 8

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12)
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** The first `MAX_BRIEF_CHARS` characters of `<dir>/brief.md`, when it is a plain file; undefined when there is none or it cannot be read. */
export async function readBrief(dir: string): Promise<string | undefined> {
  try {
    const path = join(dir, 'brief.md')
    if (!(await lstat(path)).isFile()) return undefined
    const file = await open(path, 'r')
    try {
      // A character takes at most four bytes.
      const buffer = Buffer.alloc(MAX_BRIEF_CHARS * 4)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      return buffer.subarray(0, bytesRead).toString('utf8').slice(0, MAX_BRIEF_CHARS)
    } finally {
      await file.close()
    }
  } catch {
    return undefined
  }
}

/** What a card says, in words. */
function contentOf(card: Card): string {
  if (card.kind === 'frame') return oneLine(card.name ?? '')
  if (card.size) return saySize(card.size)
  if (card.fab) return fabText(card.fab)
  const text = oneLine(card.text ?? '')
  const lcsc = card.part?.lcsc
  if (lcsc === undefined) return text
  const reading = card.part?.reading
  return [text, `${lcsc} ${reading ? readingLine(reading) : 'stock not checked'}`].filter(Boolean).join(' · ')
}

/** Whose a card is: `by you, prompt 3`, `by the person`, and of one the person made theirs, that it was Claude's. */
function authorOf(card: Card, prompts: ReadonlyMap<string, number> | undefined): string {
  if (card.by === 'agent') {
    const number = card.turn && prompts?.get(card.turn.prompt)
    return number ? `by you, prompt ${number}` : 'by you'
  }
  if (card.from?.by !== 'agent') return 'by the person'
  const was = card.from.turn && prompts?.get(card.from.turn.prompt)
  return `by the person (it was yours${was ? `, prompt ${was}` : ''}: theirs now, not yours to change)`
}

const lineOf = (card: Card, prompts: ReadonlyMap<string, number> | undefined, frame: string | undefined): string =>
  `${card.id} · ${card.kind} · ${authorOf(card, prompts)}${frame ? `, in ${frame}` : ''}: ${contentOf(card)}`

/** A card in one line: its id, kind and author, the prompt Claude wrote it in when its number is known here, and what it says. */
export function cardLine(card: Card, prompts?: ReadonlyMap<string, number>): string {
  return lineOf(card, prompts, undefined)
}

/** `brief.md` as the tool gives it: the person's words, cut at `BRIEF_LIMIT`. */
function wordsPart(brief: string): string {
  if (brief === '') return 'There is no brief.md.'
  const words = briefWords(brief)
  if (words === '') return 'brief.md holds no words yet.'
  return `brief.md, the person's words:\n${words.length <= BRIEF_LIMIT ? words : `${words.slice(0, BRIEF_LIMIT)} (cut: the rest is in brief.md)`}`
}

/**
 * The Brief as text: `brief.md`'s words when `brief` is given ('' where there is none), then a line for each card in
 * reading order; with `kind`, the cards of that kind alone. At most `limit` characters, cut at a line, saying so.
 */
export function cardsText(file: CardsFile, opts: { brief?: string; limit: number; kind?: CardKind; prompts?: ReadonlyMap<string, number> }): string {
  const frames = new Map(file.cards.filter((c) => c.kind === 'frame').map((c) => [c.id, oneLine(c.name ?? '') || c.id]))
  const cards = readingOrder(file.cards).filter((c) => opts.kind === undefined || c.kind === opts.kind)
  const lines = cards.map((c) => lineOf(c, opts.prompts, c.frame === undefined ? undefined : frames.get(c.frame)))
  const none = opts.kind === undefined ? 'The Brief has no cards.' : `The Brief has no ${opts.kind} card.`
  const said = lines.length > 0 ? lines.join('\n') : none
  const full = [...(opts.brief === undefined ? [] : [wordsPart(opts.brief)]), said].join('\n\n')
  if (full.length <= opts.limit) return full
  const room = Math.max(0, opts.limit - CUT_SENTENCE.length - 1)
  const at = full.lastIndexOf('\n', room)
  return `${full.slice(0, at > 0 ? at : room)}\n${CUT_SENTENCE}`
}

/** What a card says to Claude, as a hash: a change of it is news. A part's reading is main's and no news; a card made the person's is. */
const saysHash = (card: Card): string => hash([card.kind, card.text ?? '', card.size ?? null, card.fab ?? null, card.part?.lcsc ?? '', card.from?.by ?? ''])

/** The key of `brief.md` among what was told. */
const WORDS = 'brief.md'

/**
 * The one line a prompt carries: how many cards there are, which are new to Claude since it was last told, and whether
 * `brief.md` changed since. A card is new when it is not in `told` or what it says has changed; Claude's own cards are
 * never news to it. Nothing for a Brief with no cards whose `brief.md` did not change. `told` in the answer is what
 * Claude will have been told once the prompt is delivered: kept by whoever delivers.
 */
export function cardsLine(file: CardsFile, told: Record<string, string>, brief: string | undefined, toolName: (t: string) => string): { line: string; told: Record<string, string> } {
  const cards = readingOrder(file.cards).filter((c) => c.kind !== 'frame')
  // Nothing there and nothing ever told: there is nothing to keep either.
  if (cards.length === 0 && brief === undefined && told[WORDS] === undefined) return { line: '', told: {} }
  const known: Record<string, string> = { [WORDS]: hash(brief ?? null) }
  const news: string[] = []
  for (const card of cards) {
    known[card.id] = saysHash(card)
    if (card.by !== 'agent' && told[card.id] !== known[card.id]) news.push(card.id)
  }
  const changed = told[WORDS] !== undefined && told[WORDS] !== known[WORDS]
  if (cards.length === 0 && !changed) return { line: '', told: known }
  const named = news.length > 0 ? `: ${news.slice(0, MOST_NAMED).join(', ')}${news.length > MOST_NAMED ? ` and ${news.length - MOST_NAMED} more` : ''}` : ''
  return { line: `Brief: ${cards.length} card${cards.length === 1 ? '' : 's'} (${news.length} new${named})${changed ? '; brief.md changed since' : ''}. Read them with ${toolName('brief')}.`, told: known }
}
