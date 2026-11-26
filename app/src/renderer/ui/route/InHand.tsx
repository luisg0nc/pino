import type { Selection } from '../../../shared/view'
import { numbered } from '../numbered'
import { Section } from './Section'

/** What is selected in the views, with the exact reference Claude gets with the next prompt. */
export function InHand({ selection }: { selection: Selection }) {
  return (
    <Section title="In hand" count={selection.label} lit>
      <p className="route-reference selectable">{selection.text}</p>
      <p className="route-note">{numbered('Claude gets this line with your next prompt.')}</p>
    </Section>
  )
}
