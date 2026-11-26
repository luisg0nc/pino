import type { PersonChange } from '../../../shared/cards'
import type { SizeFact } from '../../../shared/size'
import { cardsActions } from '../../state/cards'

// What the person does on the Brief page, asked of main as ordinary changes (`window.pino.cards.change`). Main decides;
// a refusal is said on the page in its own words and nothing is kept of it.

const wordsOf = (error: unknown): string => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '') : String(error))

/** One change of main's: the cards it answers with are the page's. Whether it took it, with why not said on the page. */
async function ask(projectId: string, change: PersonChange): Promise<boolean> {
  try {
    const next = await window.pino.cards.change(projectId, change)
    cardsActions.say(null)
    cardsActions.setFile(projectId, next)
    return true
  } catch (error) {
    cardsActions.say(wordsOf(error))
    return false
  }
}

export const addNote = (projectId: string, text: string): Promise<boolean> => ask(projectId, { op: 'add', kind: 'note', text })
export const addRule = (projectId: string, text: string): Promise<boolean> => ask(projectId, { op: 'add', kind: 'rule', text })
export const addSize = (projectId: string, size: SizeFact): Promise<boolean> => ask(projectId, { op: 'add', kind: 'size', size })

/** The words of a card of the person's, changed. */
export const editText = (projectId: string, id: string, text: string): Promise<boolean> => ask(projectId, { op: 'edit', id, text })
export const editSize = (projectId: string, id: string, size: SizeFact): Promise<boolean> => ask(projectId, { op: 'edit', id, size })

/** A card taken off. Whether main did it; `restoreCard` brings it back by id. */
export const removeCard = (projectId: string, id: string): Promise<boolean> => ask(projectId, { op: 'remove', ids: [id] })

/** Puts back what main took off in this run, by id. */
export const restoreCard = (projectId: string, id: string): Promise<boolean> => ask(projectId, { op: 'restore', ids: [id] })

/** Main opens the `nth` address of a card, or of `brief.md` (`brief`), from its own file: none is sent from here. */
export function openLink(projectId: string, from: string, nth?: number): void {
  window.pino.cards.openLink(projectId, from, nth).catch((error: unknown) => cardsActions.say(wordsOf(error)))
}
