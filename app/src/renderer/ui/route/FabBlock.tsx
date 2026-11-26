import { fabRows } from '../../../shared/fab'
import { useStore } from '../../state/store'
import { useViewModel } from '../../state/viewModel'
import { numbered } from '../numbered'
import { Row } from './Section'

/**
 * The limits of the fab the board is built for, in the Brief from the first build: they are read before any choice
 * about layers, copper, holes or tracks is offered.
 */
export function FabBlock() {
  const profiles = useStore((s) => s.fabProfiles)
  const { model } = useViewModel()
  const profile = profiles.find((p) => p.name === model?.circuit?.fab)
  if (!profile) return null
  return (
    <div className="fab-limits">
      <h4 className="fab-limits-title">{profile.title}</h4>
      {fabRows(profile).map((row) => (
        <Row key={row.label} name={row.label} value={numbered(row.value)} />
      ))}
      <p className="muted">
        From JLC's capability page, read <span className="num">{profile.read_on}</span>.
      </p>
    </div>
  )
}
