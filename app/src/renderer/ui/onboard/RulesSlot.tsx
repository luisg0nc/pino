import { MAX_TEXT_CHARS } from '../../../shared/cards'
import { onboarding } from '../../state/onboard'

/** The rules: free text ("hand-solderable", "antenna at the edge"), kept as one rule card. */
export function RulesSlot({ rules, disabled, onRefused }: { rules: string; disabled: boolean; onRefused: (why: string | null) => void }) {
  return (
    <>
      <textarea
        className="new-input rules-input"
        rows={3}
        data-first=""
        aria-label="Rules"
        value={rules}
        disabled={disabled}
        placeholder="Hand-solderable, 0805 or larger; the antenna at the edge…"
        onChange={(e) => onRefused(onboarding.setRules(e.target.value))}
      />
      <p className="new-help">
        Claude is told these as they are written. <span className="num">{rules.length}</span> of <span className="num">{MAX_TEXT_CHARS}</span> characters.
      </p>
    </>
  )
}
