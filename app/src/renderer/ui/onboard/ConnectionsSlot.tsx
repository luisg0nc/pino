import { BUSES, checkConnection, MAX_CONNECTIONS, MAX_ROW, type ConnectionRow } from '../../../shared/slots'
import { onboarding, type ConnectionDraft } from '../../state/onboard'
import { chosen, pointerChoice } from '../typing'
import { connectionBlank } from './make'
import { RowField, RowProblem } from './RowField'

function Row({ row, n, disabled }: { row: ConnectionDraft; n: number; disabled: boolean }) {
  const set = (patch: Partial<ConnectionRow>): void => onboarding.setConnection(row.uid, patch)
  const checked = checkConnection(row)
  return (
    <li className="size-row" aria-label={`Connection ${n}`}>
      <RowField className="size-what" label={`What connection ${n} is`} placeholder="A sensor, a display, a button" value={row.what} max={MAX_ROW} disabled={disabled} onChange={(what) => set({ what })} />
      <select
        className="new-select"
        aria-label={`How connection ${n} talks`}
        value={row.bus}
        disabled={disabled}
        {...pointerChoice}
        onChange={(e) => {
          set({ bus: e.target.value as ConnectionRow['bus'] })
          chosen(e.currentTarget)
        }}
      >
        {BUSES.map((bus) => (
          <option key={bus} value={bus}>
            {bus}
          </option>
        ))}
      </select>
      <RowField className="size-note" label={`Connector of connection ${n}`} placeholder="Its connector, if known" value={row.connector} max={MAX_ROW} disabled={disabled} onChange={(connector) => set({ connector })} />
      <button type="button" className="button button-quiet" aria-label={`Remove connection ${n}`} disabled={disabled} onClick={() => onboarding.remove('connections', row.uid)}>
        Remove
      </button>
      <RowProblem problem={typeof checked === 'string' && !connectionBlank(row) ? checked : null} />
    </li>
  )
}

/** What plugs into the board or sits on it, a row each: what it is, how it talks, its connector if known. */
export function ConnectionsSlot({ rows, disabled, onSaid }: { rows: ConnectionDraft[]; disabled: boolean; onSaid: (why: string | null) => void }) {
  return (
    <>
      <ul className="size-list" aria-label="Connection rows">
        {rows.map((row, i) => (
          <Row key={row.uid} row={row} n={i + 1} disabled={disabled} />
        ))}
      </ul>
      <div>
        <button type="button" className="button button-quiet" data-first="" disabled={disabled || rows.length >= MAX_CONNECTIONS} onClick={() => onSaid(onboarding.addConnection())}>
          <span aria-hidden="true">+ </span>Add a connection
        </button>
      </div>
    </>
  )
}
