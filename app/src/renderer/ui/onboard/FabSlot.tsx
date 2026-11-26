import type { ReactNode } from 'react'
import type { FabAsk } from '../../../shared/cards'
import { ASSEMBLIES, checkFab, MAX_BOARDS, THICKNESSES } from '../../../shared/slots'
import { onboarding } from '../../state/onboard'
import { chosen, pointerChoice } from '../typing'
import { RowProblem } from './RowField'

const ASSEMBLY: Record<FabAsk['assembly'], string> = { jlc: 'JLC assembles it', hand: 'I solder it', mix: 'A mix' }

function Choice({ label, value, disabled, onChange, children }: { label: string; value: string | number; disabled: boolean; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <select
      className="new-select"
      aria-label={label}
      title={label}
      data-first=""
      value={value}
      disabled={disabled}
      {...pointerChoice}
      onChange={(e) => {
        onChange(e.target.value)
        chosen(e.currentTarget)
      }}
    >
      {children}
    </select>
  )
}

/** What the person asks of the fab: the layers, the thickness, who assembles it and how many boards. */
export function FabSlot({ fab, disabled }: { fab: FabAsk; disabled: boolean }) {
  const set = (patch: Partial<FabAsk>): void => onboarding.setFab({ ...fab, ...patch })
  const checked = checkFab(fab)
  return (
    <ul className="size-list" aria-label="What you ask of the fab">
      <li className="size-row">
        <Choice label="Layers" value={fab.layers} disabled={disabled} onChange={(v) => set({ layers: Number(v) as FabAsk['layers'] })}>
          <option value={2}>2 layers</option>
          <option value={4}>4 layers</option>
        </Choice>
        <Choice label="Board thickness" value={fab.thickness} disabled={disabled} onChange={(v) => set({ thickness: Number(v) as FabAsk['thickness'] })}>
          {THICKNESSES.map((t) => (
            <option key={t} value={t}>
              {t.toFixed(1)} mm
            </option>
          ))}
        </Choice>
        <Choice label="Who assembles it" value={fab.assembly} disabled={disabled} onChange={(v) => set({ assembly: v as FabAsk['assembly'] })}>
          {ASSEMBLIES.map((a) => (
            <option key={a} value={a}>
              {ASSEMBLY[a]}
            </option>
          ))}
        </Choice>
        <label className="fab-boards">
          <input className="size-value num" type="number" min={1} max={MAX_BOARDS} step={1} aria-label="How many boards" value={fab.boards === 0 ? '' : fab.boards} disabled={disabled} onChange={(e) => set({ boards: Number(e.target.value) })} />
          <span aria-hidden="true">boards</span>
        </label>
        <RowProblem problem={typeof checked === 'string' ? checked : null} />
      </li>
    </ul>
  )
}
