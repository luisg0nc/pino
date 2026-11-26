import type { BuildResult } from '../../../shared/build'
import { checkRows, checksSummary, type CheckRow } from '../../../shared/checks'
import { actions, useStore } from '../../state/store'
import { Section } from './Section'

const WORD: Record<CheckRow['word'], string> = { pass: 'pass', warn: 'warn', fail: 'fail', note: 'note', skipped: 'not run' }

/** The first finding of a row that has a place in a view. */
const placed = (r: BuildResult, row: CheckRow): number | undefined => row.findings.find((i) => ['board', 'sheet'].includes(r.findings[i].at?.space ?? ''))

/** Every check of the build by name, with its verdict. Pointing at a row lights its first finding where it is. */
export function ChecksBlock({ result }: { result: BuildResult }) {
  const hot = useStore((s) => s.hotFinding)
  const rows = checkRows(result)
  return (
    <Section title="Checks" count={checksSummary(rows)}>
      <ul className="route-checks">
        {rows.map((row) => {
          const at = placed(result, row)
          const first = row.findings.length ? result.findings[row.findings[0]] : null
          const lit = hot !== null && row.findings.includes(hot)
          const count = row.findings.length > 1 ? row.findings.length : null
          return (
            <li key={row.label}>
              <button
                type="button"
                className="route-check"
                data-word={row.word}
                data-hot={lit || undefined}
                title={first ? first.message : undefined}
                onPointerEnter={() => at !== undefined && actions.hoverFinding(at)}
                onPointerLeave={() => actions.hoverFinding(null)}
                onFocus={() => at !== undefined && actions.hoverFinding(at)}
                onBlur={() => actions.hoverFinding(null)}
                // A press goes to the view that has the finding, where its pin is.
                onClick={() => at !== undefined && actions.setTab(result.findings[at].at!.space === 'sheet' ? 'schematic' : 'board')}
              >
                <span className="route-grow">
                  {row.label}
                  {count !== null && <span className="num route-times">{count}</span>}
                </span>
                <span className="route-word">{WORD[row.word]}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
