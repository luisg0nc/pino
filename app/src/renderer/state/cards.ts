import { useStore as useZustand } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { CardsFile } from '../../shared/cards'
import { store } from './store'

// The Brief of the open project in the window: what main last said of its cards, the words of `brief.md`, the files of
// `reference/`, and what main refused of the last thing the person did.

export interface CardsState {
  projectId: string | null
  /** As main last told it; null until it has, and for no project. */
  file: CardsFile | null
  /** The words of `brief.md`: null when there is none, undefined until it has been read. */
  brief: string | null | undefined
  /** The photos, doodles and PDFs of `reference/`, by name. */
  references: string[]
  /** What main refused of the last thing the person did, in its words; null when all is well. */
  problem: string | null
}

const NONE: CardsState = { projectId: null, file: null, brief: undefined, references: [], problem: null }

export const cardsStore = createStore<CardsState>(() => NONE)

export const useCards = <T>(select: (s: CardsState) => T): T => useZustand(cardsStore, select)

/** The cards main just told, with each that is as it was kept as that very object, so that only a changed row is drawn again. */
function sharing(prev: CardsFile | null, next: CardsFile): CardsFile {
  if (prev === null) return next
  const cards = new Map(prev.cards.map((c) => [c.id, c]))
  return { ...next, cards: next.cards.map((c) => (JSON.stringify(cards.get(c.id)) === JSON.stringify(c) ? cards.get(c.id)! : c)) }
}

const isOpen = (projectId: string): boolean => cardsStore.getState().projectId === projectId

export const cardsActions = {
  /** Main's cards of a project; those of one that is not open are let go. */
  setFile(projectId: string, file: CardsFile): void {
    if (isOpen(projectId)) cardsStore.setState({ file: sharing(cardsStore.getState().file, file) })
  },

  /** `brief.md` and the files of `reference/` read again: the person edits the one in their own editor. */
  async readWords(projectId: string): Promise<void> {
    const [brief, references] = await Promise.all([window.pino.cards.brief(projectId), window.pino.cards.references(projectId)])
    if (isOpen(projectId)) cardsStore.setState({ brief, references })
  },

  /** Another project is open, or none: its Brief is read. What cannot be read is left out, and the next change main tells of tries again. */
  async load(projectId: string | null): Promise<void> {
    cardsStore.setState({ ...NONE, projectId }, true)
    if (projectId === null) return
    await Promise.all([
      window.pino.cards.read(projectId).then(
        (file) => cardsActions.setFile(projectId, file),
        () => {}
      ),
      cardsActions.readWords(projectId).catch(() => {})
    ])
  },

  say(problem: string | null): void {
    if (cardsStore.getState().problem !== problem) cardsStore.setState({ problem })
  }
}

/** Joins the Brief to the open project and to what main tells of it. Returns what stops it. */
export function connectCards(): () => void {
  const open = store.getState().project?.id ?? null
  if (open !== cardsStore.getState().projectId) void cardsActions.load(open)
  const offStore = store.subscribe((s, prev) => {
    if (s.project?.id !== prev.project?.id) void cardsActions.load(s.project?.id ?? null)
  })
  const offCards = window.pino.cards.onChanged((m) => cardsActions.setFile(m.projectId, m.file))
  const offBrief = window.pino.cards.onBriefChanged((m) => void cardsActions.readWords(m.projectId).catch(() => {}))
  return () => {
    offStore()
    offCards()
    offBrief()
  }
}
