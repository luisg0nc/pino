import { useState } from 'react'
import type { Board } from '../../../shared/board/board'
import { layerWords } from '../../../shared/board/refs'
import { pressed } from '../../../shared/keys'
import { MAX_NOTE, type Mark, type MarkPatch } from '../../../shared/marks'
import { actions, store } from '../../state/store'
import { chipOf, MarkChip } from '../MarkChip'
import { Section } from './Section'

/** Asks main to change a mark; why it would not is said in the status line. */
function ask(change: (projectId: string) => Promise<unknown>): void {
  const id = store.getState().project?.id
  if (id) void change(id).catch((e: Error) => actions.notice(e.message))
}

/** The mark in hand: what Claude gets for it, and what can be done with it. */
export function MarkInHand({ mark, board }: { mark: Mark; board: Board | null }) {
  const [writing, setWriting] = useState(false)
  const update = (patch: MarkPatch) => ask((id) => window.pino.marks.update(id, mark.id, patch))
  const layers = board?.copper ?? []
  const layer = mark.kind === 'stroke' ? mark.layer : mark.kind === 'region' ? (mark.layers.length === layers.length && layers.length > 1 ? 'all' : mark.layers[0]) : null
  return (
    <Section title="In hand" count={`${mark.id}, ${mark.kind}`} lit>
      <div className="mark-hand" data-author={mark.author}>
        <p>
          <MarkChip chip={chipOf(mark)} /> {mark.note || (mark.author === 'agent' ? 'from Claude' : '')}
        </p>
        <p className="mark-payload selectable">{mark.payload}</p>
        {mark.status === 'resolved' && mark.resolvedNote && <p className="mark-payload">resolved: {mark.resolvedNote}</p>}
        {writing && (
          <input
            className="mark-field"
            aria-label={`Note on ${mark.id}`}
            autoFocus
            maxLength={MAX_NOTE}
            defaultValue={mark.note}
            placeholder="What should Claude do here?"
            onKeyDown={(e) => {
              if (pressed(e, 'field.keep')) {
                update({ note: e.currentTarget.value })
                setWriting(false)
              } else if (pressed(e, 'field.leave')) setWriting(false)
              else return
              e.preventDefault()
              e.stopPropagation()
            }}
          />
        )}
        <div className="mark-acts">
          {mark.author === 'user' && (
            <button type="button" className="mark-act" onClick={() => setWriting((w) => !w)}>
              Note
            </button>
          )}
          {mark.author === 'user' && layer !== null && layers.length > 0 && (
            <select className="mark-act" aria-label="Layer" value={layer} onChange={(e) => update({ layer: e.target.value })}>
              {mark.kind === 'region' && layers.length > 1 && <option value="all">{layers.length === 2 ? 'Both layers' : 'All layers'}</option>}
              {layers.map((l) => (
                <option key={l} value={l}>
                  {layerWords(l).replace(/^./, (c) => c.toUpperCase())}
                </option>
              ))}
            </select>
          )}
          {mark.author === 'user' && mark.kind === 'region' && (
            <>
              <button type="button" className="mark-act" aria-pressed={mark.intent === 'keep-clear'} onClick={() => update({ intent: 'keep-clear' })}>
                Keep this clear
              </button>
              <button type="button" className="mark-act" aria-pressed={mark.intent === 'put-here'} onClick={() => update({ intent: 'put-here' })}>
                Put these here
              </button>
            </>
          )}
          {mark.author === 'user' && mark.status === 'sent' && (
            <button type="button" className="mark-act" onClick={() => update({ status: 'draft' })}>
              Send again
            </button>
          )}
          {mark.status === 'sent' && (
            <button type="button" className="mark-act" onClick={() => ask((id) => window.pino.marks.resolve(id, mark.id, ''))}>
              Resolve
            </button>
          )}
          <button type="button" className="mark-act" onClick={() => ask((id) => window.pino.marks.remove(id, mark.id))}>
            Remove
          </button>
        </div>
      </div>
    </Section>
  )
}
