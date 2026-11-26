// Which chips the chat shows: those of the marks a prompt went with, and those Claude has just made by pointing.

import type { Mark } from '../../../shared/marks'
import type { Chip } from '../MarkChip'

/** The chips of the marks with these ids, in their order: an id the project no longer has is left out. */
export function chipsFor(ids: readonly string[], marks: readonly Mark[], hollow = true): Chip[] {
  return ids.flatMap((id) => {
    const mark = marks.find((m) => m.id === id)
    return mark ? [{ id, label: mark.label, author: mark.author, hollow, title: mark.payload }] : []
  })
}

/** The marks a `point` made, read from its answer: "Pointed: M7 U2, M8 U1. They are orange in the view." */
export function pointedIds(result: string | undefined): string[] {
  const said = /Pointed: (.*?)They are orange/s.exec(result ?? '')?.[1]
  return said ? [...said.matchAll(/(?:^|, )(M\d+) /g)].map((m) => m[1]) : []
}
