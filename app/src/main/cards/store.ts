import { checkSize, saySize } from '../../shared/size'
import { type AgentChange, type Card, type CardsFile, type CardTurn, type PartReading, type PersonChange, AGENT_KINDS, LCSC, MAX_CARDS, MAX_TEXT_CHARS, MAX_WAS, PERSON_KINDS } from '../../shared/cards'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FOLDER, ownFolder, writeOwn } from '../own'
import { ensureIgnored } from '../ignored'
import { diskText, fabOf, loadCardsFile, nextAbove, saveCardsFile, textOf } from './file'
import { type Seen, seenOf } from '../../shared/brief'

const TOLD = 'told.json'
/** What the person had seen of Claude's cards when they last had the Brief on screen (#340). */
const SEEN = 'seen.json'
/** What git passes over of the Brief's folder: what one person was told and has seen. The cards are the project's. */
const IGNORED = [`brief/${SEEN}`, `brief/${TOLD}`]

function checkedText(text: unknown, max: number, what: string): string {
  if (typeof text !== 'string') throw new Error(`The ${what} must be text.`)
  if (text.length > max) throw new Error(`The ${what} is ${text.length} characters long, and a card keeps at most ${max}.`)
  return text
}

/** A size, as a size card keeps it: whole, or an error that says what is not. */
function checkedSize(raw: unknown, by: 'person' | 'agent'): NonNullable<Card['size']> {
  const size = checkSize(raw, by)
  if (typeof size === 'string') throw new Error(size)
  return size
}

function checkedFab(raw: unknown): NonNullable<Card['fab']> {
  const fab = fabOf(raw)
  if (!fab) throw new Error('What is asked of the fab is 2 or 4 layers, a thickness it makes, who assembles it and how many boards.')
  return fab
}

const isLcsc = (value: unknown): value is string => typeof value === 'string' && LCSC.test(value)

/** What a part card holds: its number, and main's reading of it when there is one. */
const partOf = (lcsc: string, reading: PartReading | undefined): NonNullable<Card['part']> => ({ lcsc, ...(reading ? { reading: { ...reading } } : {}) })

const cardOf = (file: CardsFile, id: unknown): Card => {
  const card = typeof id === 'string' ? file.cards.find((c) => c.id === id) : undefined
  if (!card) throw new Error(`There is no card ${String(id)} in the Brief.`)
  return card
}

const give = (file: CardsFile): string => `C${file.next++}`

/** Takes a card out of the file, and its cards out of it when it is a frame. */
function drop(file: CardsFile, id: string): void {
  file.cards = file.cards.filter((c) => c.id !== id)
  for (const c of file.cards) if (c.frame === id) delete c.frame
}

/** What main took out of the cards in this run: the cards as they were, by id. */
type Removed = Map<string, Card>

/** How many cards taken out `restore` can bring back: the last this many. */
export const REMOVED_KEPT = 200

/**
 * What the person asked, done to `file` (a copy). Throws and the copy is thrown away. Nothing the window says is taken
 * for an id, an author, a time or a part's reading: those are main's.
 */
function applyPerson(file: CardsFile, change: PersonChange, removed: Removed, stamp: { at: string; reading?: PartReading }): void {
  switch (change.op) {
    case 'add': {
      if (!PERSON_KINDS.includes(change.kind)) throw new Error('The Brief takes no card of that kind from the person.')
      if (file.cards.length >= MAX_CARDS) throw new Error(`The Brief holds ${MAX_CARDS} cards, and that is all it takes.`)
      const card: Card = { id: give(file), kind: change.kind, by: 'person', at: stamp.at }
      if (card.kind === 'size') card.size = checkedSize(change.size, 'person')
      else if (card.kind === 'fab') card.fab = checkedFab(change.fab)
      else {
        if (card.kind !== 'part' || change.text !== undefined) card.text = checkedText(change.text ?? '', MAX_TEXT_CHARS, 'text')
        if (card.kind === 'part' && change.lcsc !== undefined) {
          if (!isLcsc(change.lcsc)) throw new Error('A part is named by its LCSC number, such as C2838500.')
          card.part = partOf(change.lcsc, stamp.reading)
        }
      }
      file.cards.push(card)
      return
    }
    case 'edit': {
      const card = cardOf(file, change.id)
      if (card.by !== 'person') throw new Error(`${card.id} is Claude's: make it yours first.`)
      const before = JSON.stringify(card)
      if (change.size !== undefined) {
        if (card.kind !== 'size') throw new Error(`${card.id} is not a size, and has no size to change.`)
        card.size = checkedSize(change.size, 'person')
      }
      if (change.fab !== undefined) {
        if (card.kind !== 'fab') throw new Error(`${card.id} is not what was asked of the fab.`)
        card.fab = checkedFab(change.fab)
      }
      if (change.text !== undefined) {
        if (card.kind === 'size' || card.kind === 'fab' || card.kind === 'frame') throw new Error(`${card.id} has no words to change.`)
        card.text = checkedText(change.text, MAX_TEXT_CHARS, 'text')
      }
      // Changed when it says something else: an edit that changes nothing is no change, and writes nothing.
      if (JSON.stringify(card) !== before) card.at = stamp.at
      return
    }
    case 'remove': {
      for (const id of new Set(change.ids)) if (file.cards.some((c) => c.id === id)) drop(file, id)
      return
    }
    case 'adopt': {
      const card = cardOf(file, change.id)
      if (card.by !== 'agent') throw new Error(`${card.id} is not Claude's: there is nothing to make yours.`)
      // Who wrote it, and when and in which prompt, stay with it; the card is the person's from now on.
      card.from = { by: 'agent', ...(card.turn ? { turn: card.turn } : {}), ...(card.at ? { at: card.at } : {}), since: stamp.at }
      card.by = 'person'
      delete card.turn
      card.at = stamp.at
      return
    }
    case 'restore': {
      const used = new Set(file.cards.map((c) => c.id))
      // Only what main took out in this run, by the id it had: undo puts back what was there, nothing new, and nothing the window describes.
      const asked = new Set(Array.isArray(change.ids) ? change.ids.filter((id): id is string => typeof id === 'string') : [])
      const added: Card[] = []
      for (const id of asked) {
        const card = removed.get(id)
        if (!card || used.has(id) || file.cards.length + added.length >= MAX_CARDS) continue
        used.add(id)
        added.push(structuredClone(card))
      }
      // Each in a frame that is there, or in none.
      const frames = new Set([...file.cards, ...added].filter((c) => c.kind === 'frame' && c.frame === undefined).map((c) => c.id))
      for (const card of added) if (card.frame !== undefined && !frames.has(card.frame)) delete card.frame
      file.cards.push(...added)
      return
    }
    default:
      throw new Error('That is not a change the Brief takes.')
  }
}

/** The card of `id`, when it is the agent's; an error that says it is the person's when it is not, or that there is none. */
function ownOf(file: CardsFile, id: string): Card {
  const card = cardOf(file, id)
  if (card.by !== 'agent') throw new Error(`${id} is the person's: you may change or remove only your own cards. Add a card of yours instead.`)
  return card
}

const NEEDS_LCSC = 'A part card names its part by LCSC number, such as lcsc: "C2838500". Nothing was done.'

/** What fields an agent's card of a kind takes: refused in words when it was given another's. */
function checkFields(kind: Card['kind'], said: { text?: unknown; size?: unknown; lcsc?: unknown }): void {
  if (said.lcsc !== undefined && kind !== 'part') throw new Error('Only a part card takes lcsc. Nothing was done.')
  if (said.size !== undefined && kind !== 'size') throw new Error('Only a size card takes size. Nothing was done.')
  if (said.text !== undefined && said.text !== '' && kind === 'size') throw new Error('A size card takes size, not text (a note goes in size.note). Nothing was done.')
}

/** What a card said, for the struck line of an earlier version: its size in words, or its text, after the part number it named when that changed. */
function saidBefore(before: Card, after: Card): string {
  if (before.size) return saySize(before.size)
  const text = before.text ?? ''
  const lcsc = before.part?.lcsc
  if (lcsc === undefined || lcsc === after.part?.lcsc) return text
  return (text === '' ? lcsc : `${lcsc}: ${text}`).slice(0, MAX_TEXT_CHARS)
}

/** What a card says that is Claude's to say: a reading is main's. */
const wordsOf = (card: Card): string => JSON.stringify([card.text ?? '', card.size ?? null, card.part?.lcsc ?? ''])

/** What the agent's change was given besides the change, all of it main's: the prompt under way, and a part's reading. */
export interface AgentStamp {
  turn?: CardTurn
  reading?: PartReading
}

/**
 * What the agent asked, done to `file` (a copy). Throws and the copy is thrown away. It only ever makes cards of its
 * own and changes or removes those: an id, an author and a part's reading are never its to say.
 */
function applyAgent(file: CardsFile, change: AgentChange, stamp: AgentStamp & { at: string }): string {
  switch (change.op) {
    case 'add': {
      const { kind } = change
      if (!AGENT_KINDS.includes(kind)) throw new Error(`A card of yours is one of: ${AGENT_KINDS.join(', ')}. Nothing was done.`)
      checkFields(kind, change)
      if (kind === 'part' && !isLcsc(change.lcsc)) throw new Error(NEEDS_LCSC)
      const hasText = typeof change.text === 'string' && change.text !== ''
      if (kind !== 'size' && kind !== 'part' && !hasText) throw new Error(`A ${kind} card has some text. Nothing was done.`)
      const size = kind === 'size' ? checkedSize(change.size, 'agent') : undefined
      const text = hasText ? checkedText(change.text, MAX_TEXT_CHARS, 'text') : undefined
      if (file.cards.length >= MAX_CARDS) throw new Error(`The Brief holds ${MAX_CARDS} cards, and that is all it takes.`)
      const card: Card = { id: give(file), kind, by: 'agent', ...(text !== undefined ? { text } : {}), ...(size ? { size } : {}), ...(kind === 'part' ? { part: partOf(change.lcsc as string, stamp.reading) } : {}), ...(stamp.turn ? { turn: { ...stamp.turn } } : {}), at: stamp.at }
      file.cards.push(card)
      return card.id
    }
    case 'edit': {
      const card = ownOf(file, change.id)
      checkFields(card.kind, change)
      if (change.text === undefined && change.size === undefined && change.lcsc === undefined) throw new Error('A change gives text, size or lcsc. Nothing was done.')
      const before = structuredClone(card)
      if (change.size !== undefined) card.size = checkedSize(change.size, 'agent')
      if (change.text !== undefined && card.kind !== 'size') {
        if (change.text === '') throw new Error(`A ${card.kind} card has some text. Nothing was done.`)
        card.text = checkedText(change.text, MAX_TEXT_CHARS, 'text')
      }
      if (card.kind === 'part') {
        if (change.lcsc !== undefined && !isLcsc(change.lcsc)) throw new Error(NEEDS_LCSC)
        if (change.lcsc !== undefined && change.lcsc !== card.part?.lcsc) card.part = partOf(change.lcsc, stamp.reading)
        else if (card.part?.lcsc !== undefined && stamp.reading) card.part = partOf(card.part.lcsc, stamp.reading)
      }
      // Its words changed: what they were is kept, with the prompt and time they were written in, and the card is now of this prompt.
      if (wordsOf(card) !== wordsOf(before)) {
        card.was = [...(card.was ?? []), { text: saidBefore(before, card), ...(before.turn ? { turn: before.turn } : {}), ...(before.at ? { at: before.at } : {}) }].slice(-MAX_WAS)
        if (stamp.turn) card.turn = { ...stamp.turn }
        else delete card.turn
        card.at = stamp.at
      }
      return card.id
    }
    case 'remove': {
      drop(file, ownOf(file, change.id).id)
      return change.id
    }
    default:
      throw new Error('That is not a change the Brief takes.')
  }
}

/** What the agent's change did: the cards as they now are, and the id of the card added, changed or removed. */
export interface AgentResult {
  id: string
  file: CardsFile
}

interface CardStoreDeps {
  dirOf(projectId: string): string | undefined
  /** The clock a card's `at` is read from: the system's when none is given. */
  now?(): Date
  /** The cards of a project changed: all of them, as they now are. */
  onChange?(projectId: string, file: CardsFile): void
  /** Something about a project's cards file the person should know, as a sentence. Said once. */
  onProblem?(projectId: string, message: string): void
}

/**
 * The cards of a project's Brief, and the only writer of its `.pino/brief/cards.json`. The file is read once and then
 * kept in memory; what is done to it is done one thing at a time per project, each change written before it is told.
 * Every method rejects for a project whose folder is not known.
 */
export class CardStore {
  /** By project folder: the cards as last read or written. */
  private files = new Map<string, CardsFile>()
  /** By project folder: the text of the cards file as main last read or wrote it (null: no file, or none it may read). A file that is other than this was changed from outside. */
  private disk = new Map<string, string | null>()
  /** By project folder: what was taken out of its cards in this run (the last `REMOVED_KEPT`), which `restore` may bring back. */
  private removed = new Map<string, Removed>()
  /** By project folder: the last thing asked of its cards, which the next waits for. */
  private turns = new Map<string, Promise<unknown>>()
  /** By project folder: counts `forget`: what was read before one is not kept after it, and what waited out one is not told. */
  private epochs = new Map<string, number>()
  /** The folder each project was last found in, for `forget` of one that is no longer open. */
  private folders = new Map<string, string>()

  constructor(private deps: CardStoreDeps) {}

  private stamp(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  /** The cards as they are now (a copy). */
  read(projectId: string): Promise<CardsFile> {
    return this.turn(projectId, (file) => structuredClone(file))
  }

  /** A change the person asked of their Brief. Resolves with the cards, written, or rejects and changes nothing. A part's reading is main's, in `stamp`. */
  async person(projectId: string, change: PersonChange, stamp: { reading?: PartReading } = {}): Promise<CardsFile> {
    const { file } = await this.change(projectId, (next, removed) => applyPerson(next, change, removed, { ...stamp, at: this.stamp() }))
    return file
  }

  /**
   * A change the agent asked through its tools: it makes cards of its own and changes or removes those (`applyAgent`).
   * Resolves with the cards, written, and the id; or rejects and changes nothing. `turn` is the prompt the session is
   * answering (`Sessions.turnNow`): a card made or changed is stamped with it and the time.
   */
  async agent(projectId: string, change: AgentChange, stamp: AgentStamp): Promise<AgentResult> {
    const { file, result } = await this.change(projectId, (next) => applyAgent(next, change, { ...stamp, at: this.stamp() }))
    return { id: result, file }
  }

  /** A new reading of a part card: main's fields only, no `was`, no `at`. */
  async restock(projectId: string, id: string, reading: PartReading): Promise<CardsFile> {
    const { file } = await this.change(projectId, (next) => {
      const card = cardOf(next, id)
      if (card.kind !== 'part' || card.part?.lcsc === undefined) throw new Error(`${card.id} is no part with an LCSC number: there is no stock to check.`)
      card.part = partOf(card.part.lcsc, reading)
    })
    return file
  }

  /**
   * What the person had seen of Claude's cards when they last had the Brief on screen (`.pino/brief/seen.json`, ignored
   * by git, #340); null for a project that has none, or whose file cannot be read.
   */
  seen(projectId: string): Promise<Seen | null> {
    return this.turn(projectId, async (_file, dir) => {
      const parsed = await jsonIn(dir, SEEN)
      if (typeof parsed !== 'object' || parsed === null) return null
      const { at, cards } = parsed as { at?: unknown; cards?: unknown }
      if (typeof at !== 'string' || typeof cards !== 'object' || cards === null || Array.isArray(cards)) return null
      return { at, cards: strings(cards) }
    })
  }

  /** The person has seen the Brief as it is now: every card of Claude's, by its hash, and when (`seenOf`). Written in the cards' turn. */
  markSeen(projectId: string): Promise<Seen> {
    return this.turn(projectId, async (file, dir) => {
      const seen = seenOf(file.cards, this.stamp())
      await keep(dir, SEEN, seen)
      return seen
    })
  }

  /**
   * What Claude was last told of each card, as a hash (`.pino/brief/told.json`, ignored by git). Empty for a project
   * that has none, or whose file cannot be read: everything is then news.
   */
  told(projectId: string): Promise<Record<string, string>> {
    return this.turn(projectId, async (_file, dir) => {
      const parsed = await jsonIn(dir, TOLD)
      return typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ? {} : strings(parsed)
    })
  }

  /** Keeps what a prompt that has been delivered told of the cards: in the turn of their changes, whole or not at all. */
  markTold(projectId: string, told: Record<string, string>): Promise<void> {
    return this.turn(projectId, (_file, dir) => keep(dir, TOLD, told))
  }

  /** Main has read the file again from disk (a pull, an edit by hand): what it holds is dropped. Never rejects for a file that cannot be read. */
  refresh(projectId: string): Promise<void> {
    return this.turn(projectId, async (current, dir, epoch) => {
      await this.takeDisk(projectId, dir, current, epoch)
    })
  }

  /** Forgets what was read of a project, as when it is closed. Its file is read again when next asked for. */
  forget(projectId: string): void {
    const dir = this.folders.get(projectId)
    if (dir === undefined) return
    this.epochs.set(dir, (this.epochs.get(dir) ?? 0) + 1)
    this.files.delete(dir)
    this.disk.delete(dir)
    this.removed.delete(dir)
    this.folders.delete(projectId)
  }

  /**
   * One change, written and told. Before it, the file is compared with what main last read or wrote: when it was changed
   * from outside (a git pull) the disk's cards are the base the change is made on, and the window is told of them. What
   * the change took out is kept for `restore`.
   */
  private change<R>(projectId: string, edit: (next: CardsFile, removed: Removed) => R): Promise<{ file: CardsFile; result: R }> {
    return this.turn(projectId, async (current, dir, epoch) => {
      const file = await this.takeDisk(projectId, dir, current, epoch)
      const removed: Removed = this.removed.get(dir) ?? new Map()
      const edited = structuredClone(file)
      const result = edit(edited, removed)
      const next: CardsFile = { next: nextAbove(edited.next, edited.cards), cards: edited.cards }
      if (textOf(next) === textOf(file)) return { file: structuredClone(file), result }
      // Written before it is kept or told: a write that fails leaves the cards as they were.
      await saveCardsFile(dir, next)
      if (this.same(dir, epoch)) {
        this.files.set(dir, next)
        this.disk.set(dir, textOf(next))
        this.removed.set(dir, removed)
        keepRemoved(removed, file, next)
        this.deps.onChange?.(projectId, structuredClone(next))
      }
      return { file: structuredClone(next), result }
    })
  }

  private same(dir: string, epoch: number): boolean {
    return epoch === (this.epochs.get(dir) ?? 0)
  }

  /** The cards as the file now says them: read again when the file is other than main last read or wrote, and the window told when that changes them. */
  private async takeDisk(projectId: string, dir: string, current: CardsFile, epoch: number): Promise<CardsFile> {
    if (!this.same(dir, epoch) || !this.disk.has(dir) || (await diskText(dir)) === this.disk.get(dir)) return current
    const file = await this.load(projectId, dir, epoch)
    if (this.same(dir, epoch) && textOf(file) !== textOf(current)) this.deps.onChange?.(projectId, structuredClone(file))
    return file
  }

  /** Reads the cards file of a project, keeping what it says and saying what was wrong with it. */
  private async load(projectId: string, dir: string, epoch: number): Promise<CardsFile> {
    const loaded = await loadCardsFile(dir)
    if (this.same(dir, epoch)) {
      this.files.set(dir, loaded.file)
      this.disk.set(dir, loaded.text)
      if (loaded.problem !== undefined) this.deps.onProblem?.(projectId, loaded.problem)
    }
    return loaded.file
  }

  private turn<T>(projectId: string, task: (file: CardsFile, dir: string, epoch: number) => T | Promise<T>): Promise<T> {
    const dir = this.deps.dirOf(projectId)
    if (dir === undefined) return Promise.reject(new Error(`no project named ${projectId} is open`))
    this.folders.set(projectId, dir)
    // As of the asking: the project may be left while this waits its turn.
    const epoch = this.epochs.get(dir) ?? 0
    const turn = (this.turns.get(dir) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const file = this.files.get(dir) ?? (await this.load(projectId, dir, epoch))
        return task(file, dir, epoch)
      })
      .finally(() => {
        if (this.turns.get(dir) === turn) this.turns.delete(dir)
      })
    this.turns.set(dir, turn)
    return turn
  }
}

/** What `after` lacks of `before` is kept for `restore`, the oldest let go past `REMOVED_KEPT`; what is back is not kept. */
function keepRemoved(kept: Removed, before: CardsFile, after: CardsFile): void {
  const now = new Set(after.cards.map((c) => c.id))
  for (const id of kept.keys()) if (now.has(id)) kept.delete(id)
  for (const card of before.cards) {
    if (now.has(card.id)) continue
    kept.delete(card.id)
    kept.set(card.id, structuredClone(card))
  }
  while (kept.size > REMOVED_KEPT) kept.delete(kept.keys().next().value as string)
}

const strings = (record: object): Record<string, string> => Object.fromEntries(Object.entries(record).filter((e): e is [string, string] => typeof e[1] === 'string'))

/** A file of the Brief's folder as JSON; undefined when it is not there or cannot be read. */
async function jsonIn(dir: string, name: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, FOLDER, 'brief', name), 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/** Writes a file of the Brief's that git passes over: ignored before it is there, as a file written first is for a moment one git would take. */
async function keep(dir: string, name: string, value: unknown): Promise<void> {
  await ownFolder(dir, 'brief')
  await ensureIgnored(dir, IGNORED)
  await writeOwn(dir, `brief/${name}`, `${JSON.stringify(value, null, 2)}\n`)
}
