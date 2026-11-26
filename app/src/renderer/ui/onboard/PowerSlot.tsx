import { checkPower, MAX_POWER, MAX_ROW, MAX_ROW_NOTE, POWER_SOURCES, type PowerRow } from '../../../shared/slots'
import { onboarding, type PowerDraft } from '../../state/onboard'
import { chosen, pointerChoice } from '../typing'
import { RowField, RowProblem } from './RowField'

function Row({ row, n, disabled }: { row: PowerDraft; n: number; disabled: boolean }) {
  const set = (patch: Partial<PowerRow>): void => onboarding.setPower(row.uid, patch)
  const checked = checkPower(row)
  return (
    <li className="size-row" aria-label={`Power ${n}`}>
      <select
        className="new-select"
        aria-label={`Source of power ${n}`}
        value={row.source}
        disabled={disabled}
        {...pointerChoice}
        onChange={(e) => {
          set({ source: e.target.value as PowerRow['source'] })
          chosen(e.currentTarget)
        }}
      >
        {POWER_SOURCES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {row.source === 'battery' && <RowField className="size-what" label={`Which battery, power ${n}`} placeholder="LiPo 1S, 2 × AA" value={row.kind} max={MAX_ROW} disabled={disabled} onChange={(kind) => set({ kind })} />}
      <RowField className="size-value num" label={`Voltage of power ${n}`} placeholder="Volts" value={row.volts} max={MAX_ROW} disabled={disabled} onChange={(volts) => set({ volts })} />
      <RowField className="size-value num" label={`Current of power ${n}`} placeholder="Amps" value={row.amps} max={MAX_ROW} disabled={disabled} onChange={(amps) => set({ amps })} />
      <RowField className="size-note" label={`Note for power ${n}`} placeholder="A few words more" value={row.note} max={MAX_ROW_NOTE} disabled={disabled} onChange={(note) => set({ note })} />
      <button type="button" className="button button-quiet" aria-label={`Remove power ${n}`} disabled={disabled} onClick={() => onboarding.remove('power', row.uid)}>
        Remove
      </button>
      <RowProblem problem={typeof checked === 'string' ? checked : null} />
    </li>
  )
}

/** Where the board's power comes from, a row each: the source, which battery, the voltage and the current if known. */
export function PowerSlot({ rows, disabled, onSaid }: { rows: PowerDraft[]; disabled: boolean; onSaid: (why: string | null) => void }) {
  return (
    <>
      <ul className="size-list" aria-label="Power sources">
        {rows.map((row, i) => (
          <Row key={row.uid} row={row} n={i + 1} disabled={disabled} />
        ))}
      </ul>
      <div>
        <button type="button" className="button button-quiet" data-first="" disabled={disabled || rows.length >= MAX_POWER} onClick={() => onSaid(onboarding.addPower())}>
          <span aria-hidden="true">+ </span>Add a power source
        </button>
      </div>
    </>
  )
}
