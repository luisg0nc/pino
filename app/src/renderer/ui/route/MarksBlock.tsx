import { TOOL_VERBS } from '../../board/marks/tools'
import type { Mark } from '../../../shared/marks'
import { actions, useStore } from '../../state/store'
import { chipOf, MarkChip } from '../MarkChip'
import { numbered } from '../numbered'
import { Section } from './Section'

/** A mark's first line: its note, else what it asks. */
export function verbOf(mark: Mark): string {
  if (mark.note) return mark.note
  if (mark.kind === 'region') return mark.intent === 'put-here' ? 'Put these here' : mark.intent === 'keep-clear' ? TOOL_VERBS.region : 'A region'
  return TOOL_VERBS[mark.kind]
}

function count(marks: readonly Mark[]): string {
  const drafts = marks.filter((m) => m.status === 'draft').length
  if (drafts) return `${drafts} to send`
  const claude = marks.filter((m) => m.author === 'agent').length
  return claude ? `${marks.length}, ${claude} of them Claude's` : String(marks.length)
}

/** Every open mark, two lines each: what it asks, and exactly what Claude gets. */
export function MarksBlock({ marks }: { marks: readonly Mark[] }) {
  const held = useStore((s) => s.heldMark)
  const hot = useStore((s) => s.hotMark)
  const open = marks.filter((m) => m.status !== 'resolved')
  const resolved = marks.length - open.length
  return (
    <Section title="Marks" count={count(open)} lit={open.length > 0}>
      <ul className="mark-rows">
        {open.map((mark) => (
          <li key={mark.id}>
            <div
              className="mark-row"
              role="button"
              tabIndex={0}
              data-mark-row={mark.id}
              data-author={mark.author}
              data-held={held === mark.id || undefined}
              data-lit={hot === mark.id || undefined}
              onPointerEnter={() => actions.hoverMark(mark.id)}
              onPointerLeave={() => actions.hoverMark(null)}
              onClick={() => actions.holdMark(mark.id)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                actions.holdMark(mark.id)
              }}
            >
              <MarkChip chip={chipOf(mark, mark.status === 'sent' && mark.author === 'user')} />
              <span className="mark-words">
                <span className="mark-note">{numbered(verbOf(mark))}</span>
                <span className="mark-payload">{mark.payload}</span>
                {mark.anchor === 'moved' && <span className="mark-payload mark-state">moved by the last build</span>}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {resolved > 0 && <p className="mark-resolved">{numbered(`${resolved} resolved`)}</p>}
    </Section>
  )
}
