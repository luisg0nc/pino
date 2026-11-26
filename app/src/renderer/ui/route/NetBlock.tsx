import { netMembers } from '../../../shared/board/refs'
import { netVerdict } from '../../../shared/checks'
import type { ViewModel } from '../../state/viewModel'
import { Row, Section } from './Section'

const MOST = 24

/** The net in hand on the sheet: its pins by part and pin, and what the check by pin said of it. */
export function NetBlock({ model, net }: { model: ViewModel; net: string }) {
  const members = netMembers(model.board, model.circuit, net)
  const verdict = netVerdict(model.result, net)
  return (
    <Section
      title={
        <>
          Net <span className="num route-net">{net}</span>
        </>
      }
      count={`${members.length} pins`}
    >
      <p className="route-line">
        {members
          .slice(0, MOST)
          .map((m) => `${m.ref}.${m.number}${m.pin ? ` ${m.pin}` : ''}`)
          .join(' · ')}
        {members.length > MOST && ` and ${members.length - MOST} more`}
      </p>
      <Row name="Checked by part and pin, not by name" value={verdict === 'skipped' ? 'not run' : verdict} tone={verdict === 'fail' ? 'fail' : verdict === 'pass' ? 'ok' : undefined} />
    </Section>
  )
}
