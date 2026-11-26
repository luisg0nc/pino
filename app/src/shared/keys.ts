/**
 * The one table of keys. Every key pino listens to is a row here: the handlers ask `pressed` or `which`
 * with the row's id and never name a key themselves, the buttons and tooltips take their key from `hint`,
 * and the sheet of keys (`?`) is `cheatSheet()`. A new key is added here first.
 *
 * A key is written as it is read: `V`, `?`, `Esc`, `Enter`, `Tab`, `Left`, `F12`, and with what is held
 * before it, `Ctrl+Shift+E`, `Shift+Enter`. `keyName` gives that of a key press.
 */

/** Where the sheet lists a row. */
export type KeyContext = 'Everywhere' | 'All projects' | 'The views' | 'Session' | 'In a field, a menu or a sheet'

/**
 * Where a key is listened to. Two rows of one scope would answer the same press.
 * - `global`: everywhere, also while typing. Nobody else may have such a key.
 * - `window`: everywhere outside a field. Nobody else's either.
 * - `composer`: in the box a chat prompt is written in. `ask`: on a card of the chat that asks the person.
 * - `tabs`: on a focused tab of the views. `view`: over a view of the board, outside a field.
 * - `separator`: on the focused edge of the session dock. `cards`: on a focused card of the page of projects.
 * - `field`, `menu`, `sheet`: in a field, an open menu, a sheet or a question.
 */
export type KeyScope = 'global' | 'window' | 'composer' | 'ask' | 'tabs' | 'view' | 'separator' | 'cards' | 'field' | 'menu' | 'sheet'

interface Row<Id extends string> {
  id: Id
  keys: readonly string[]
  /** What the key does, as the sheet says it. */
  does: string
  context: KeyContext
  scope: KeyScope
  /** Held to every rule of the table, and not shown in the sheet: nothing a person needs to be told. */
  hidden?: true
}

const row = <Id extends string>(id: Id, keys: readonly string[], does: string, context: KeyContext, scope: KeyScope, hidden?: true): Row<Id> => ({ id, keys, does, context, scope, ...(hidden ? { hidden } : {}) })

const ROWS = [
  row('view.prev', ['Left'], 'On a tab of the views: the view before', 'Everywhere', 'tabs'),
  row('view.next', ['Right'], 'On a tab of the views: the next view', 'Everywhere', 'tabs'),

  row('boards.move', ['Left', 'Right', 'Up', 'Down'], 'On a board of the page: the card that way', 'All projects', 'cards'),

  row('board.layer', ['1', '2', '3', '4', '5', '6', '7', '8'], 'Board: look at the copper layer of that number, from the top', 'The views', 'view'),
  row('board.fit', ['F'], 'Fit the whole drawing in the view', 'The views', 'view'),
  row('board.nets', ['N'], 'Board: net colours on or off', 'The views', 'view'),
  row('view.drop', ['Esc'], 'Put down the tool in hand, then what is selected', 'The views', 'view'),
  row('mark.select', ['V'], 'Marks: put the tool down and select', 'The views', 'view'),
  row('mark.point', ['P'], 'Marks: point at a part, pad or track', 'The views', 'view'),
  row('mark.arrow', ['A'], 'Marks: an arrow, move this here', 'The views', 'view'),
  row('mark.stroke', ['D'], 'Marks: a stroke, route this way', 'The views', 'view'),
  row('mark.region', ['R'], 'Marks: a region, keep this clear', 'The views', 'view'),

  row('chat.send', ['Enter'], 'Chat: send the prompt', 'Session', 'composer'),
  row('chat.newline', ['Shift+Enter'], 'Chat: a new line in the prompt, not a send', 'Session', 'composer'),
  row('chat.stop', ['Esc', 'Ctrl+C'], 'Chat: stop the turn while Claude Code works (Ctrl+C with nothing selected in the box)', 'Session', 'composer'),
  row('chat.allow', ['Enter'], 'Chat: allow what the card in focus asks (in its reason field, Enter denies)', 'Session', 'ask'),
  row('ask.option', ['1', '2', '3', '4', '5', '6', '7', '8', '9'], 'Ask: the option of that number picks or toggles it on a question Claude Code asks', 'Session', 'ask'),
  row('dock.resize', ['Left', 'Right'], 'On the edge of the session dock: wider or narrower', 'Session', 'separator'),

  row('field.keep', ['Enter'], 'Field: keep what was typed', 'In a field, a menu or a sheet', 'field'),
  row('field.leave', ['Esc'], 'Field: leave it as it was', 'In a field, a menu or a sheet', 'field'),
  row('sheet.close', ['Esc'], 'Sheet or question: put it away', 'In a field, a menu or a sheet', 'sheet'),

  row('menu.next', ['Down', 'Right'], 'Menu: the next item', 'In a field, a menu or a sheet', 'menu'),
  row('menu.previous', ['Up', 'Left'], 'Menu: the one before', 'In a field, a menu or a sheet', 'menu'),
  row('menu.ends', ['Home', 'End'], 'Menu: the first or the last', 'In a field, a menu or a sheet', 'menu'),
  row('menu.close', ['Esc', 'Tab'], 'Menu: close it', 'In a field, a menu or a sheet', 'menu')
] as const

export type KeyId = (typeof ROWS)[number]['id']
export type KeyRow = Row<KeyId>

/** Every row. */
export const KEYS: readonly KeyRow[] = ROWS

/** The groups of the sheet, in its order, each with when its keys are listened to. */
export const CONTEXTS: ReadonlyArray<{ name: KeyContext; when: string }> = [
  { name: 'Everywhere', when: 'Also while typing' },
  { name: 'All projects', when: 'On the page of projects' },
  { name: 'The views', when: 'Over a view, outside a field' },
  { name: 'Session', when: 'In the chat' },
  { name: 'In a field, a menu or a sheet', when: 'Where something is typed, chosen or asked' }
]

/** The sheet of keys: every row that is shown, by where it is listened to. A group with none is left out. */
export function cheatSheet(): Array<{ context: KeyContext; when: string; rows: KeyRow[] }> {
  return CONTEXTS.map(({ name, when }) => ({ context: name, when, rows: KEYS.filter((r) => r.context === name && !r.hidden) })).filter((group) => group.rows.length > 0)
}

/** Scopes whose keys are heard whatever else is listening: no other row may have one of them. */
const ALONE: readonly KeyScope[] = ['global', 'window']

/**
 * The keys two rows would both answer to, as `Z (menu)`: two rows of one scope, or a key heard everywhere that a
 * row of another scope has too, as `? (window, menu)`. Empty when the table is sound.
 */
export function keyClashes(rows: readonly KeyRow[] = KEYS): string[] {
  const seen = new Set<string>()
  const clashes = new Set<string>()
  for (const r of rows) {
    for (const key of r.keys) {
      const where = `${key} (${r.scope})`
      if (seen.has(where)) clashes.add(where)
      seen.add(where)
    }
  }
  for (const alone of rows.filter((r) => ALONE.includes(r.scope))) {
    for (const other of rows) {
      if (other.scope === alone.scope) continue
      for (const key of alone.keys) if (other.keys.includes(key) && !ALONE.includes(other.scope)) clashes.add(`${key} (${alone.scope}, ${other.scope})`)
    }
  }
  return [...clashes]
}

/** What a handler knows of a key press: a `KeyboardEvent`, React's, or main's `before-input-event` made to fit. */
export interface KeyPress {
  key: string
  code?: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/** A key press as main hears it (Electron's `before-input-event`), made to fit: main reads no key itself. */
export function pressOf(input: { key: string; code?: string; control: boolean; shift: boolean; alt: boolean; meta: boolean }): KeyPress {
  return { key: input.key, ...(input.code ? { code: input.code } : {}), ctrlKey: input.control, shiftKey: input.shift, altKey: input.alt, metaKey: input.meta }
}

const WORDS: Record<string, string> = { Escape: 'Esc', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space' }

/**
 * A key press as the table writes it. A letter is its capital whatever Shift does. Within a chord the key is
 * named by its place on the keyboard where that is known: with Ctrl held, the character a key gives is no
 * longer its letter.
 */
export function keyName(e: KeyPress): string {
  const chord = e.ctrlKey === true || e.altKey === true || e.metaKey === true
  const placed = chord && e.code ? (/^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit(\d)$/.exec(e.code)?.[1] ?? (e.code === 'Backquote' ? '`' : undefined)) : undefined
  const base = placed ?? WORDS[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  // Shift is part of the name only where it is not already in the character: `?` is not `Shift+/`.
  const shift = e.shiftKey === true && (chord || base.length > 1)
  return `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.metaKey ? 'Meta+' : ''}${shift ? 'Shift+' : ''}${base}`
}

/** A key of the table as the DOM names it, for a press that is made up and handed on: `Esc` is `Escape`. */
export function domKey(name: string): string {
  return Object.keys(WORDS).find((dom) => WORDS[dom] === name) ?? name
}

const BY_ID = new Map<KeyId, KeyRow>(KEYS.map((r) => [r.id, r]))

/**
 * Which key of a row a press is: its place among the row's keys, or -1. Shift held with a key, and nothing
 * else, is that key, unless Shift with it is a row of its own where this one is listened to. A chord is never anything but itself. A row that names a figure with Shift (`Shift+1`) hears
 * that key whatever character the layout gives it (`!`, `1`, `&`): the figure's key is told by its place, in this row
 * only, so that the character itself (`/` is Shift+7 on some layouts) keeps its name everywhere else.
 */
export function which(e: KeyPress, id: KeyId): number {
  const r = BY_ID.get(id)!
  if (e.shiftKey === true && e.ctrlKey !== true && e.altKey !== true && e.metaKey !== true && e.code) {
    const figure = /^Digit(\d)$/.exec(e.code)?.[1]
    const placed = figure === undefined ? -1 : r.keys.indexOf(`Shift+${figure}`)
    if (placed >= 0) return placed
  }
  const name = keyName(e)
  const at = r.keys.indexOf(name)
  if (at >= 0 || !name.startsWith('Shift+')) return at
  if (KEYS.some((other) => other.scope === r.scope && other.keys.includes(name))) return -1
  return r.keys.indexOf(name.replace('Shift+', ''))
}

/** Whether a press is a key of the row. */
export function pressed(e: KeyPress, id: KeyId): boolean {
  return which(e, id) >= 0
}

/** A key of a row, as a button or a tooltip shows it: the first, or the one at a place. */
export function hint(id: KeyId, at = 0): string {
  return BY_ID.get(id)!.keys[at]
}

/**
 * Whether a key is the field's or the terminal's own when one of them has the focus: a character, an
 * editing key, or a control character of the shell (`Ctrl+C`, `Ctrl+R`). Such a key cannot be heard
 * everywhere; a function key and a chord with Ctrl and Shift, or Ctrl and a sign, can.
 */
export function typed(name: string): boolean {
  const parts = name.split('+')
  const base = name.endsWith('+') ? '+' : parts.at(-1)!
  const held = new Set(name.endsWith('+') ? parts.slice(0, -2) : parts.slice(0, -1))
  if (/^F\d{1,2}$/.test(base)) return false
  if (!held.has('Ctrl') && !held.has('Alt') && !held.has('Meta')) return true
  return held.has('Ctrl') && held.size === 1 && /^[A-Z]$/.test(base)
}
