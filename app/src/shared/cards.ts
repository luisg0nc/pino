import type { PartsResult } from './fab'
import type { SizeFact, SizeUnit } from './size'

// The cards of a project's Brief (`<project>/.pino/brief/cards.json`): what the person asked for and what Claude
// settled, each a card of a kind, some grouped in frames. Main is the only writer (`main/cards/store.ts`); the window
// and the agent's tools ask it for changes. In pino a "board" is the printed circuit board, never this.

export type CardKind = 'frame' | 'note' | 'rule' | 'link' | 'size' | 'requirement' | 'decision' | 'question' | 'part' | 'power' | 'connection' | 'fab'

export const CARD_KINDS = ['frame', 'note', 'rule', 'link', 'size', 'requirement', 'decision', 'question', 'part', 'power', 'connection', 'fab'] as const
/** What Claude may add (`add_card` `kind`). */
export const AGENT_KINDS = ['requirement', 'decision', 'question', 'part', 'power', 'connection', 'size', 'rule', 'link', 'note'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]
/** What the person may add on the Brief page. */
export const PERSON_KINDS: readonly CardKind[] = [...AGENT_KINDS, 'fab']

/** What the engine's lookup said of a part: main's alone, never Claude's or the window's. `fresh` is false when jlcsearch could not be reached and the answer is from an earlier day. */
export type PartReading =
  | { class: 'basic' | 'preferred' | 'extended'; package: string; stock: number | null; price: number | null; checkedAt: string; fresh: boolean }
  | { missing: true; checkedAt: string; fresh: boolean }

/** A part card's own field. */
export interface PartFact {
  lcsc?: string
  reading?: PartReading
}

/** What the person asked of the fab: a `fab` card's own field. */
export interface FabAsk {
  layers: 2 | 4
  thickness: 0.8 | 1.0 | 1.2 | 1.6 | 2.0
  assembly: 'jlc' | 'hand' | 'mix'
  boards: number
}

export interface Card {
  /** `C<n>`, given by main. */
  id: string
  kind: CardKind
  /** Whose it is. */
  by: 'person' | 'agent'
  /** The id of the frame it is in. */
  frame?: string
  /** A frame's name. */
  name?: string
  text?: string
  /** What a `size` card says: only ever on that kind. */
  size?: SizeFact
  /** What a `part` card names: only ever on that kind. */
  part?: PartFact
  /** What a `fab` card asks: only ever on that kind. */
  fab?: FabAsk
  /** The prompt the agent made or last changed it in. Main's only (#336): never taken from the window or a tool's arguments. */
  turn?: CardTurn
  /** When it was made or last changed, ISO 8601. Main's only. */
  at?: string
  /** What an agent's card said before each edit of its words, oldest first, the last `MAX_WAS`. Main's only. */
  was?: CardWas[]
  /** A card the person made theirs (`adopt`, #339): it was the agent's, written in that prompt. Main's only. */
  from?: CardFrom
}

/** A prompt, as a build's turn names it (`BuildTurn`) without its words: those stay in the chat log, which does not travel with the project. */
export interface CardTurn {
  /** The chat's `user` item. */
  prompt: string
  conversation?: string
}

/** What a card said before an edit, and the prompt and time it said it from. */
export interface CardWas {
  text: string
  turn?: CardTurn
  at?: string
}

/** Who a card the person made theirs was by, and when and in which prompt that one wrote it. */
export interface CardFrom {
  by: 'agent'
  turn?: CardTurn
  /** When the agent wrote it. */
  at?: string
  /** When the person made it theirs. */
  since?: string
}

/** The most earlier words a card keeps (`was`). */
export const MAX_WAS = 6

export interface CardsFile {
  next: number
  cards: Card[]
}

/** An id of a card or a frame. */
export const CARD_ID = /^C[1-9]\d*$/
/** A part's number at LCSC. */
export const LCSC = /^C[1-9]\d{0,9}$/

export const MAX_CARDS = 2000
export const MAX_TEXT_CHARS = 4000
/** The longest name of a frame. */
export const MAX_NAME_CHARS = 200

/** What the window may ask of the cards. Never an id, an author or a part's reading: those are main's. */
export type PersonChange =
  | { op: 'add'; kind: CardKind; text?: string; size?: SizeFact; lcsc?: string; fab?: FabAsk }
  | { op: 'edit'; id: string; text?: string; size?: SizeFact; fab?: FabAsk }
  | { op: 'remove'; ids: string[] }
  /** Puts back cards main removed in this run, by id: what they were is main's to say, never the window's. */
  | { op: 'restore'; ids: string[] }
  /** Makes a card of the agent's the person's own (#339): main keeps who wrote it, in which prompt and when (`from`). */
  | { op: 'adopt'; id: string }

/**
 * What the agent's tools may ask of the cards (`add_card`). It only ever adds cards of its own and changes or removes
 * those: never an id, an author or a reading, and never a card of the person's.
 */
export type AgentChange =
  | { op: 'add'; kind: AgentKind; text?: string; size?: { what: string; value: string; unit?: SizeUnit; note?: string }; lcsc?: string }
  | { op: 'edit'; id: string; text?: string; size?: { what: string; value: string; unit?: SizeUnit; note?: string }; lcsc?: string }
  | { op: 'remove'; id: string }

/** The most characters of a link a card opens. */
export const MAX_LINK_CHARS = 2000

/** The first `http://` or `https://` address in a text, up to the next whitespace without the sentence's own punctuation at its end, at most `MAX_LINK_CHARS` characters; null when there is none. Whether it may be opened is main's to check. */
export function firstLink(text: string): string | null {
  const found = /https?:\/\/\S+/i.exec(text)
  if (!found) return null
  let link = found[0].slice(0, MAX_LINK_CHARS)
  // The punctuation of the sentence the address ends, and a `)` that closes a bracket opened before it.
  for (;;) {
    const last = link.at(-1)
    // The sentence's punctuation, and the markup that closes around an address in markdown (`**`, `_`, a table's `|`, a quote's `>`, a code's backtick).
    if (last !== undefined && '.,;:!?*_|>`'.includes(last)) link = link.slice(0, -1)
    else if (last === ')' && (link.match(/\(/g)?.length ?? 0) < (link.match(/\)/g)?.length ?? 0)) link = link.slice(0, -1)
    else break
  }
  return link
}

/** Every `http` or `https` address of a text, in order, each as `firstLink` reads one: what `brief.md`'s links are numbered by, in main and on the page alike. */
export function linksIn(text: string): string[] {
  const found: string[] = []
  let rest = text
  for (let link = firstLink(rest); link !== null; link = firstLink(rest)) {
    found.push(link)
    rest = rest.slice(rest.indexOf(link) + link.length)
  }
  return found
}

/** The day of a time, as it is said. */
const day = (at: string): string => at.slice(0, 10)

/**
 * What the engine's `parts get` said of one number: its reading, or why there is none. A number JLC does not have is
 * a reading too (`missing`); a jlcsearch that could not be asked, with nothing kept, is not.
 */
export function readingOf(result: PartsResult, lcsc: string, now: Date): PartReading | { refused: string } {
  const fresh = result.source.fresh
  const found = result.parts.find((p) => p.lcsc === lcsc)
  if (found) {
    return { class: found.class, package: found.package, stock: found.stock, price: found.price, checkedAt: found.checked_at ?? found.fetched_at, fresh }
  }
  const unknown = result.findings.some((f) => f.code === 'part_unknown')
  if (!unknown && result.findings.some((f) => f.code === 'parts_unavailable' || f.code === 'parts_request')) {
    return { refused: result.headline.replace(/^Parts: /, '') }
  }
  // The engine answered and knows no such number.
  return { missing: true, checkedAt: now.toISOString(), fresh: true }
}

/** A reading in one line: class, package, stock, price, and the day it holds for. */
export function readingLine(reading: PartReading): string {
  const when = reading.fresh ? `(checked ${day(reading.checkedAt)})` : `(from ${day(reading.checkedAt)}: jlcsearch could not be reached)`
  if ('missing' in reading) return `JLC has no such part ${when}`
  const stock = reading.stock === null ? 'stock not known' : `stock ${reading.stock.toLocaleString('en-US')}`
  const price = reading.price === null ? 'price not known' : `$${reading.price} each`
  return `${reading.class} · ${reading.package} · ${stock} · ${price} ${when}`
}

const ASSEMBLY_SAID: Record<FabAsk['assembly'], string> = { jlc: 'JLC assembles it', hand: 'you solder it', mix: 'JLC assembles some and you solder the rest' }

/** What the person asked of the fab, in one line. */
export function fabText(fab: FabAsk): string {
  return `${fab.layers} layers, ${fab.thickness.toFixed(1)} mm, ${ASSEMBLY_SAID[fab.assembly]}, ${fab.boards.toLocaleString('en-US')} ${fab.boards === 1 ? 'board' : 'boards'}`
}

export const emptyCards = (): CardsFile => ({ next: 1, cards: [] })

/** The cards as a person reads them: each frame by its id, followed by its cards by id, then the cards of no frame by id. */
export function readingOrder(cards: readonly Card[]): Card[] {
  const byId = [...cards].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
  const frames = byId.filter((c) => c.kind === 'frame')
  const members = (frame: Card): Card[] => byId.filter((c) => c.kind !== 'frame' && c.frame === frame.id)
  const inFrame = new Set(frames.flatMap((f) => members(f).map((c) => c.id)))
  return [...frames.flatMap((f) => [f, ...members(f)]), ...byId.filter((c) => c.kind !== 'frame' && !inFrame.has(c.id))]
}
