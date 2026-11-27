import { useMemo } from 'react'
import { boardDisagreements } from '../../../shared/brief'
import { useCards } from '../../state/cards'
import { actions, useStore } from '../../state/store'
import { useViewModel } from '../../state/viewModel'
import { numbered } from '../numbered'
import { Section } from './Section'

/**
 * The Brief at the foot of the left column: the fab the board is checked against, by name (its limits are on the Brief
 * page), a row for each place the build on show and the Brief disagree, with a button to the Brief, and the way to it.
 */
export function BriefBlock() {
  const cards = useCards((s) => s.file?.cards)
  const profiles = useStore((s) => s.fabProfiles)
  const { model } = useViewModel()
  const fab = profiles.find((p) => p.name === model?.circuit?.fab)
  const outline = model?.board.box
  const rows = useMemo(() => boardDisagreements(cards ?? [], outline ? { w: outline.x1 - outline.x0, h: outline.y1 - outline.y0 } : null), [cards, outline])
  const open = (): void => actions.setTab('brief')
  return (
    <Section title="Brief">
      {fab && <p className="route-brief-fab">{numbered(fab.title)}</p>}
      {rows.length > 0 && (
        <ul className="on-rows">
          {rows.map((row) => (
            <li key={row.card} className="on-row">
              <span className="on-dot" aria-hidden="true" />
              <span className="on-words">{numbered(row.words)}</span>
              <button type="button" className="button button-quiet" title="Open the Brief page, where the size is" onClick={open}>
                Brief
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="link-button route-brief" onClick={open}>
        Open the Brief
      </button>
    </Section>
  )
}
