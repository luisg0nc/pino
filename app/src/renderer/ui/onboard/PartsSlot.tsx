import { checkPartHad, MAX_PARTS_HAD, MAX_ROW, MAX_ROW_NOTE } from '../../../shared/slots'
import { onboarding, type PartDraft } from '../../state/onboard'
import { partBlank } from './make'
import { partState, useStockCheck } from './parts'
import { RowField, RowProblem } from './RowField'

function Row({ row, n, disabled }: { row: PartDraft; n: number; disabled: boolean }) {
  useStockCheck(row)
  const state = partState(row)
  const checked = checkPartHad(row)
  return (
    <li className="size-row" aria-label={`Part ${n}`}>
      <RowField className="size-what num" label={`Part ${n}`} placeholder="C25804, or an ESP32-C3 module" value={row.what} max={MAX_ROW} disabled={disabled} onChange={(what) => onboarding.setPart(row.key, { what })} />
      <RowField className="size-note" label={`Note for part ${n}`} placeholder="What it is for" value={row.note} max={MAX_ROW_NOTE} disabled={disabled} onChange={(note) => onboarding.setPart(row.key, { note })} />
      <button type="button" className="button button-quiet" aria-label={`Remove part ${n}`} disabled={disabled} onClick={() => onboarding.remove('parts', row.key)}>
        Remove
      </button>
      {/* Always there, so that what the check says is told as it comes. */}
      <p className={`size-help part-state${state.kind === 'read' ? ' num' : ''}`} data-tone={state.kind === 'refused' ? 'warn' : undefined} aria-live="polite">
        {state.said}
      </p>
      <RowProblem problem={typeof checked === 'string' && !partBlank(row) ? checked : null} />
    </li>
  )
}

/**
 * The parts the person has, a row each: an LCSC number, checked against JLC stock as it is typed, or a module in
 * words. A stock that cannot be checked does not hold the project back.
 */
export function PartsSlot({ rows, disabled, onSaid }: { rows: PartDraft[]; disabled: boolean; onSaid: (why: string | null) => void }) {
  return (
    <>
      <ul className="size-list" aria-label="Part rows">
        {rows.map((row, i) => (
          <Row key={row.key} row={row} n={i + 1} disabled={disabled} />
        ))}
      </ul>
      <div>
        <button type="button" className="button button-quiet" data-first="" disabled={disabled || rows.length >= MAX_PARTS_HAD} onClick={() => onSaid(onboarding.addPart())}>
          <span aria-hidden="true">+ </span>Add a part
        </button>
      </div>
    </>
  )
}
