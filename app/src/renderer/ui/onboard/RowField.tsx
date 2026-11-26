import { pressed } from '../../../shared/keys'
import { giveKeysBack } from '../typing'

/** One field of a PCB slot's row, on one line: Enter keeps what was typed and gives the keys back to the page. */
export function RowField({ className, label, placeholder, value, max, disabled, onChange }: { className: string; label: string; placeholder: string; value: string; max: number; disabled: boolean; onChange: (text: string) => void }) {
  return (
    <input
      className={className}
      type="text"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      maxLength={max}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (pressed(e, 'field.keep')) giveKeysBack(e.currentTarget)
      }}
    />
  )
}

/** Why a row is not whole, under it: it holds the project back until it is, or the row is removed. */
export function RowProblem({ problem }: { problem: string | null }) {
  if (problem === null) return null
  return (
    <p className="size-help" data-tone="warn" role="status">
      {problem}
    </p>
  )
}
