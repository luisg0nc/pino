import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { AgentChoice } from '../../shared/chat'
import { MAX_LINK_NOTE, MAX_LINKS, linkProblem, MOST_REFERENCES } from '../../shared/projectName'
import { type FabAsk, MAX_TEXT_CHARS, type PartReading } from '../../shared/cards'
import { MAX_SIZES, checkSize, type SizeFact } from '../../shared/size'
import { type ConnectionRow, MAX_CONNECTIONS, MAX_PARTS_HAD, MAX_POWER, MAX_SHAPE_NOTE, type PowerRow } from '../../shared/slots'
import { store as main } from './store'

// The draft of a new project (the page `ui/onboard/NewProject.tsx`): what the person has said and given so far. It
// lives in the window, for the workspace it was begun in, until the project is made or the draft is thrown away
// (asked about first). Nothing of it is on disk. Photos and doodles are kept as the pictures that will be
// handed to main; a doodle also as its strokes, so that it can be opened again and changed.

/** A stroke of the doodle board, in the board's own 1200 x 800 pixels. */
export interface Stroke {
  tool: 'pen' | 'eraser'
  width: number
  points: Array<[number, number]>
}

interface Item {
  /** Names it for as long as the draft lives: the list keeps its place when another is removed. */
  uid: string
  note: string
}

/**
 * A photo: `path` is where the file is on the disk (main copies it from there); `image` is the picture for the prompt, scaled to 1280 px.
 * A picture pasted from the clipboard has no file: `path` is empty, `pasted` is set, and `image` (a PNG) is what main writes as `photo-<n>.png`.
 */
export interface PhotoDraft extends Item {
  path: string
  pasted?: true
  file: string
  image: Uint8Array
  /** The picture as an object URL for a thumbnail; let go when the item goes. */
  url: string
  /** What is said under the file name: its size in pixels, and the size it is sent at. */
  detail?: string
}

export interface DoodleDraft extends Item {
  strokes: Stroke[]
  png: Uint8Array
  url: string
  /** The `uid` of the photo it is drawn over (the photo is under the ink in `png`). Cleared when that photo is removed: the picture keeps it. */
  over?: string
  /** True once the photo it was drawn over is removed from the draft: the picture still has that photo under the ink, though no file is named. */
  onPhoto?: true
}

/** A row of the Power slot, typed as it is. */
export type PowerDraft = PowerRow & { uid: string }
/** A row of the Connections slot, typed as it is. */
export type ConnectionDraft = ConnectionRow & { uid: string }

/** A row of "Parts I have": an LCSC number or a module, a note, and what the stock check says of the number. */
export interface PartDraft {
  key: string
  what: string
  note: string
  reading?: PartReading
  looking?: true
  /** Why the stock was not checked. */
  problem?: string
}

/**
 * A size the person knows, as a row of the draft: the fields are those of a `SizeFact`, typed as they are (a row that is
 * not whole yet is kept, and `sizeProblem` says what is missing); `note` is `''` for none.
 */
export interface SizeDraft extends Item, Omit<SizeFact, 'note'> {}

/** A link: `http` or `https`, kept as text and never opened by the window; `note` is on one line. */
export interface LinkDraft extends Item {
  url: string
}

/** A PDF: `path` is where it is on the disk (main copies it from there into `reference/`). */
export interface PdfDraft extends Item {
  path: string
  file: string
  /** In bytes, when the window knows it (a dropped file). */
  size?: number
}

export interface Draft {
  name: string
  description: string
  photos: PhotoDraft[]
  doodles: DoodleDraft[]
  sizes: SizeDraft[]
  /** Size and shape's two fields: an enclosure it fits in, and the edges its connectors must sit on. */
  enclosure: string
  edges: string
  /** Free text: "hand-solderable, 0805 or larger". */
  rules: string
  links: LinkDraft[]
  pdfs: PdfDraft[]
  power: PowerDraft[]
  connections: ConnectionDraft[]
  parts: PartDraft[]
  /** What is asked of the fab; null until its slot is opened. */
  fab: FabAsk | null
}

export type Kind = 'photos' | 'doodles' | 'sizes' | 'links' | 'pdfs' | 'power' | 'connections' | 'parts'

/** A first prompt that was not sent, kept for the project until a session can take it. */
export interface Held {
  text: string
  reason: string
  /** The text was sent to a session: the reason stays to be read, the text is no longer held. */
  taken?: true
}

/** What the notice of a held entry says, above the pane of the session. */
export function heldSaid(held: Held): string {
  const why = held.reason.replace(/\.$/, '')
  return `The first prompt of this project was not sent: ${why}. ${held.text !== '' ? 'The first prompt is kept: it goes when you start a session.' : 'What was given is in brief.md, reference/ and the Brief.'}`
}

interface OnboardState {
  draft: Draft
  /** Where leaving the page goes back to: the page the draft was begun from. */
  from: 'project' | 'projects'
  held: Record<string, Held>
  /** The model and effort the next new project's session starts on: the person's, kept from one draft to the next in this window; empty for their defaults. */
  choice: AgentChoice
}

const empty = (): Draft => ({ name: '', description: '', photos: [], doodles: [], sizes: [], enclosure: '', edges: '', rules: '', links: [], pdfs: [], power: [], connections: [], parts: [], fab: null })

export const onboard = createStore<OnboardState>(() => ({ draft: empty(), from: 'projects', held: {}, choice: {} }))

export function useOnboard<T>(selector: (s: OnboardState) => T): T {
  return useZustand(onboard, selector)
}

/** Whether the person has put anything into the draft: a close or a discard would lose it. */
export function draftHas(draft: Draft): boolean {
  return (
    draft.name.trim() !== '' ||
    draft.description.trim() !== '' ||
    draft.rules.trim() !== '' ||
    draft.enclosure.trim() !== '' ||
    draft.edges.trim() !== '' ||
    draft.fab !== null ||
    draft.photos.length + draft.doodles.length + draft.sizes.length + draft.links.length + draft.pdfs.length + draft.power.length + draft.connections.length + draft.parts.length > 0
  )
}

/** Why a size row cannot be sent yet (what it measures, a value, its length), or null when it can. */
export function sizeProblem(size: SizeDraft): string | null {
  const checked = checkSize({ what: size.what, value: size.value, unit: size.unit, source: size.source, ...(size.note === '' ? {} : { note: size.note }) }, 'person')
  return typeof checked === 'string' ? checked : null
}

/** A row nothing is typed in (what it measures and the value are both empty): it is left alone, neither a problem nor a size. */
export const sizeBlank = (size: SizeDraft): boolean => size.what.trim() === '' && size.value.trim() === ''

/** Whether a row of the draft is half done: not blank and not whole. */
export const sizesWrong = (sizes: readonly SizeDraft[]): boolean => sizes.some((s) => !sizeBlank(s) && sizeProblem(s) !== null)

/** The size row as the fact main takes (a note only when there is one), or null when it is not whole. */
export function sizeFact(size: SizeDraft): SizeFact | null {
  const checked = checkSize({ what: size.what, value: size.value, unit: size.unit, source: size.source, ...(size.note === '' ? {} : { note: size.note }) }, 'person')
  return typeof checked === 'string' ? null : checked
}

let counter = 0
let epoch = 0
const newKey = (): string => `r${++counter}`

const revoke = (url: string): void => {
  try {
    URL.revokeObjectURL(url)
  } catch {
    // Not a URL made here: nothing to let go.
  }
}

const change = (patch: (draft: Draft) => Draft): void => onboard.setState((s) => ({ draft: patch(s.draft) }))

/** What names a row of any list: `uid`, or a part's `key`. */
const keyOf = (item: { uid?: string; key?: string }): string => (item.uid ?? item.key)!

/** A field of Size and shape, as typed; over its most it is not kept, and the reason is given. */
function setShape(field: 'enclosure' | 'edges', text: string): string | null {
  if (text.length > MAX_SHAPE_NOTE) return `At most ${MAX_SHAPE_NOTE} characters.`
  change((d) => ({ ...d, [field]: text }))
  return null
}

export const onboarding = {
  /** Begins a draft (or goes on with the one there is) from this page. */
  begin(from: 'project' | 'projects'): void {
    onboard.setState({ from })
  },

  /** The model or effort to start on; an empty value is the person's default. A draft thrown away keeps it. */
  setChoice(choice: AgentChoice): void {
    onboard.setState({ choice: { ...(choice.model ? { model: choice.model } : {}), ...(choice.effort ? { effort: choice.effort } : {}) } })
  },
  setName: (name: string): void => change((d) => ({ ...d, name })),
  setDescription: (description: string): void => change((d) => ({ ...d, description })),

  /** Adds photos that are ready; those beyond the most, and those already there (by path), are counted and left out. */
  addPhotos(items: Array<Omit<PhotoDraft, 'uid' | 'note'>>): { added: number; left: number; same: number } {
    const now = onboard.getState().draft.photos
    const kept: PhotoDraft[] = []
    let left = 0
    let same = 0
    for (const item of items) {
      if (item.pasted !== true && [...now, ...kept].some((p) => p.path === item.path)) {
        same += 1
        revoke(item.url)
      } else if (now.length + kept.length >= MOST_REFERENCES.photos) {
        left += 1
        revoke(item.url)
      } else kept.push({ ...item, uid: newKey(), note: '' })
    }
    if (kept.length > 0) change((d) => ({ ...d, photos: [...d.photos, ...kept] }))
    return { added: kept.length, left, same }
  },

  addDoodle(item: Omit<DoodleDraft, 'uid' | 'note'>): boolean {
    if (onboard.getState().draft.doodles.length >= MOST_REFERENCES.doodles) {
      revoke(item.url)
      return false
    }
    change((d) => ({ ...d, doodles: [...d.doodles, { ...item, uid: newKey(), note: '' }] }))
    return true
  },

  /** The doodle drawn again: its note and its place stay; what it is drawn over is the new item's. */
  replaceDoodle(uid: string, item: Omit<DoodleDraft, 'uid' | 'note'>): void {
    const old = onboard.getState().draft.doodles.find((d) => d.uid === uid)
    if (!old) return revoke(item.url)
    revoke(old.url)
    change((d) => ({ ...d, doodles: d.doodles.map((x) => (x.uid === uid ? { ...item, uid, note: x.note } : x)) }))
  },

  /** Adds a blank row of Power; the reason it was not, or null. */
  addPower(): string | null {
    if (onboard.getState().draft.power.length >= MAX_POWER) return `At most ${MAX_POWER} power rows.`
    change((d) => ({ ...d, power: [...d.power, { uid: newKey(), source: 'USB-C', kind: '', volts: '', amps: '', note: '' }] }))
    return null
  },
  setPower(uid: string, patch: Partial<PowerRow>): void {
    change((d) => ({ ...d, power: d.power.map((x) => (x.uid === uid ? { ...x, ...patch } : x)) }))
  },

  addConnection(): string | null {
    if (onboard.getState().draft.connections.length >= MAX_CONNECTIONS) return `At most ${MAX_CONNECTIONS} connections.`
    change((d) => ({ ...d, connections: [...d.connections, { uid: newKey(), what: '', bus: 'I2C', connector: '' }] }))
    return null
  },
  setConnection(uid: string, patch: Partial<ConnectionRow>): void {
    change((d) => ({ ...d, connections: d.connections.map((x) => (x.uid === uid ? { ...x, ...patch } : x)) }))
  },

  addPart(): string | null {
    if (onboard.getState().draft.parts.length >= MAX_PARTS_HAD) return `At most ${MAX_PARTS_HAD} parts.`
    change((d) => ({ ...d, parts: [...d.parts, { key: newKey(), what: '', note: '' }] }))
    return null
  },
  /** A change of a part's row. Another number is another part: what was read of the old one goes with it. */
  setPart(key: string, patch: Partial<Omit<PartDraft, 'key'>>): void {
    change((d) => ({
      ...d,
      parts: d.parts.map((x) => {
        if (x.key !== key) return x
        const kept = patch.what !== undefined && patch.what !== x.what ? { key, what: x.what, note: x.note } : x
        return { ...kept, ...patch }
      })
    }))
  },

  setFab(fab: FabAsk | null): void {
    change((d) => ({ ...d, fab }))
  },
  setEnclosure: (text: string): string | null => setShape('enclosure', text),
  setEdges: (text: string): string | null => setShape('edges', text),

  /** Adds a row of sizes (blank unless given); the reason it was not added, or null. */
  addSize(size: Partial<Omit<SizeDraft, 'uid'>> = {}): string | null {
    if (onboard.getState().draft.sizes.length >= MAX_SIZES) return `At most ${MAX_SIZES} sizes.`
    // A size of a board not drawn yet is what is wanted of it: a guess until the person says otherwise.
    change((d) => ({ ...d, sizes: [...d.sizes, { what: '', value: '', unit: 'mm', source: 'a guess', note: '', ...size, uid: newKey() }] }))
    return null
  },

  setSize(uid: string, patch: Partial<Pick<SizeDraft, 'what' | 'value' | 'unit' | 'source' | 'note'>>): void {
    change((d) => ({ ...d, sizes: d.sizes.map((x) => (x.uid === uid ? { ...x, ...patch } : x)) }))
  },

  /** The rules, as typed; text over the most a text card holds is not kept, and the reason is given. */
  setRules(rules: string): string | null {
    if (rules.length > MAX_TEXT_CHARS) return `The rules are at most ${MAX_TEXT_CHARS} characters.`
    change((d) => ({ ...d, rules }))
    return null
  },

  /** Adds a link; the reason it was not, or null. */
  addLink(url: string, note = ''): string | null {
    const now = onboard.getState().draft.links
    if (now.length >= MAX_LINKS) return `At most ${MAX_LINKS} links.`
    const trimmed = url.trim()
    const wrong = linkProblem(trimmed)
    if (wrong !== null) return wrong
    if (now.some((l) => l.url === trimmed)) return 'That link is there already.'
    const said = note.replace(/\s+/g, ' ').trim()
    if (said.length > MAX_LINK_NOTE) return `The note of a link is at most ${MAX_LINK_NOTE} characters.`
    change((d) => ({ ...d, links: [...d.links, { url: trimmed, uid: newKey(), note: said }] }))
    return null
  },

  /** Adds a PDF by its path; the reason it was not, or null. */
  addPdf(item: Omit<PdfDraft, 'uid' | 'note'>): string | null {
    const now = onboard.getState().draft.pdfs
    if (now.length >= MOST_REFERENCES.pdfs) return `At most ${MOST_REFERENCES.pdfs} PDFs.`
    if (now.some((p) => p.path === item.path)) return `${item.file} is there already.`
    change((d) => ({ ...d, pdfs: [...d.pdfs, { ...item, uid: newKey(), note: '' }] }))
    return null
  },

  setNote(kind: Kind, uid: string, note: string): void {
    change((d) => ({ ...d, [kind]: (d[kind] as Item[]).map((x) => (x.uid === uid ? { ...x, note } : x)) }))
  },

  remove(kind: Kind, uid: string): void {
    const gone = (onboard.getState().draft[kind] as Array<{ uid?: string; key?: string; url?: string }>).find((x) => keyOf(x) === uid)
    if (gone?.url) revoke(gone.url)
    change((d) => ({
      ...d,
      [kind]: (d[kind] as Array<{ uid?: string; key?: string }>).filter((x) => keyOf(x) !== uid),
      // A doodle drawn over this photo keeps its picture, and no longer says which photo it was, only that it is over a photo.
      ...(kind === 'photos' ? { doodles: d.doodles.map((x) => (x.over === uid ? { ...x, over: undefined, onPhoto: true as const } : x)) } : {})
    }))
  },

  /** Counts the times the draft was thrown away: a photo that began to be read before one is not added after it. */  epoch: (): number => epoch,

  /** Throws the draft away. */
  discard(): void {
    epoch += 1
    const d = onboard.getState().draft
    for (const item of [...d.photos, ...d.doodles]) revoke(item.url)
    onboard.setState({ draft: empty() })
  },

  /** The first prompt of a project that could not be sent, kept with the reason, for the next session. */
  hold(projectId: string, held: Held): void {
    onboard.setState((s) => ({ held: { ...s.held, [projectId]: held } }))
  },
  held: (projectId: string | null): Held | undefined => (projectId === null ? undefined : onboard.getState().held[projectId]),
  /** The held prompt's text, for the session that takes it; the reason stays (`taken`) until it is dismissed. */
  take(projectId: string | null): string {
    const held = onboarding.held(projectId)
    if (!held || projectId === null || held.taken || held.text === '') return ''
    onboard.setState((s) => ({ held: { ...s.held, [projectId]: { text: '', reason: held.reason, taken: true } } }))
    return held.text
  },
  /** The reason has been read. */
  dismiss(projectId: string): void {
    onboard.setState((s) => {
      const { [projectId]: _gone, ...rest } = s.held
      return { held: rest }
    })
  }
}

// A draft is written for a folder: once the workspace is another, it is not offered. (The window asked before it left.)
main.subscribe((s, prev) => {
  if (s.workspace?.root === prev.workspace?.root) return
  onboarding.discard()
  onboard.setState({ held: {} })
})
