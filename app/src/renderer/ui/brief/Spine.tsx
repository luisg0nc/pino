import { memo, type ReactNode } from 'react'
import { type Card, readingLine } from '../../../shared/cards'
import type { PromptRow } from '../../../shared/chat'
import { type SpineNode, handOf, sizeSource, sizeValue, topicOf, whenSaid } from '../../../shared/brief'
import { numbered } from '../numbered'
import { Hand, Words } from './Rows'

// What Claude wrote down (#338): its cards, hung on a spine of the prompts that wrote them. Each prompt quotes what the
// person said in it (two lines, the edge of their hand), then Claude's cards (the edge of its). A card a later prompt
// changed shows its old words struck where they were written. Pointing at a card (a click, or Enter on its id) opens
// its prompt in full, what it replaced, and what may be done with it.

/** The prompt a node is, said as its head says it. */
function nodeName(node: SpineNode): string {
  if (node.prompt) return `Prompt ${node.prompt.number}`
  return node.id === '' ? 'Before pino kept the prompt' : 'A prompt not on this computer'
}

/** What a card of each kind is called before its words. */
const TAG: Partial<Record<Card['kind'], string>> = { requirement: 'requirement', decision: 'decision', question: 'open question', part: 'part', power: 'power budget', connection: 'connection', size: 'size', rule: 'rule', link: 'link' }

/** Words cut to a length, at a word. */
function cut(text: string, most: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= most) return one
  const at = one.lastIndexOf(' ', most - 1)
  return `${one.slice(0, at > most / 2 ? at : most - 1)}…`
}

export interface CardActs {
  onRemove: () => void
  /** Makes the card the person's and edits it (#339). */
  onAdopt?: () => void
  /** Edits a card that is the person's. */
  onEdit?: () => void
  /** A part with an LCSC number: its stock is looked up again. */
  onRestock?: () => void
}

interface ItemProps {
  projectId: string
  card: Card
  node: SpineNode
  hand: { hand: 'you' | 'claude'; label: string }
  pointed: boolean
  /** New since the person last looked (#340). */
  fresh: boolean
  /** Its earlier words, oldest first, with the number of the prompt that wrote each. */
  replaced: Array<{ text: string; number?: number }>
  onPoint: () => void
  acts: CardActs
  /** What takes the card's place while it is edited (#339). */
  editing?: ReactNode
}

/** One card of Claude's on the spine. */
const SpineCard = memo(function SpineCard({ projectId, card, node, hand, pointed, fresh, replaced, onPoint, acts, editing }: ItemProps) {
  const mine = card.by === 'person'
  const madeMine = mine && card.from?.since !== undefined ? Date.parse(card.from.since) : undefined
  const wrote = node.prompt ? `prompt ${node.prompt.number}` : 'an earlier prompt'
  const body = ((): ReactNode => {
    if (card.kind === 'size' && card.size) {
      const size = card.size
      return (
        <span className="brief-cn-size">
          <span className="brief-cn-tag">size</span>
          <span className="brief-cn-value num">
            {sizeValue(size)}
            <small>{size.unit}</small>
          </span>
          <span className="brief-cn-what">{size.what}</span>
          <span className="brief-cn-from">{sizeSource(size)}</span>
        </span>
      )
    }
    const text = card.text ?? ''
    const topic = topicOf(text)
    const tag = TAG[card.kind]
    const lcsc = card.part?.lcsc
    return (
      <span className="brief-cn-text">
        {tag && <span className="brief-cn-tag">{tag}</span>}
        {topic ? (
          <>
            <b>{topic.topic}:</b> <Words projectId={projectId} card={card} text={topic.rest} />
          </>
        ) : (
          <Words projectId={projectId} card={card} />
        )}
        {lcsc !== undefined && <span className="brief-cn-reading num">{`${lcsc} · ${card.part?.reading ? readingLine(card.part.reading) : 'stock not checked'}`}</span>}
      </span>
    )
  })()
  if (editing) {
    return (
      <div className="brief-cn" data-card={card.id} data-by={card.by} data-editing="">
        {editing}
      </div>
    )
  }
  return (
    <div
      className="brief-cn"
      data-card={card.id}
      data-by={card.by}
      data-kind={card.kind}
      data-pointed={pointed ? '' : undefined}
      data-fresh={fresh ? '' : undefined}
      onClick={(e) => {
        // A button or a link of the card does its own thing.
        if ((e.target as HTMLElement).closest('button, a') !== null) return
        onPoint()
      }}
    >
      <div className="brief-cn-line">
        {body}
        <Hand hand={hand} />
        <button type="button" className="brief-cn-id num" aria-expanded={pointed} aria-label={`${card.id}, ${mine ? 'yours' : 'Claude’s'}, from ${wrote}: ${pointed ? 'put away' : 'what it replaced, and what to do with it'}`} onClick={onPoint}>
          {card.id}
        </button>
      </div>
      {mine && <span className="brief-cn-since">{madeMine !== undefined ? <>Yours since {numbered(whenSaid(madeMine))}. </> : 'Yours now. '}Claude wrote it in {numbered(wrote)}.</span>}
      {pointed && (
        <>
          {replaced.length > 0 && (
            <p className="brief-cn-replaced">
              It replaced{' '}
              {replaced.map((w, i) => (
                <span key={i}>
                  {i > 0 && ', then '}
                  {numbered(cut(w.text, 90))}
                  {w.number !== undefined && <> (prompt {numbered(String(w.number))})</>}
                </span>
              ))}
              .
            </p>
          )}
          <div className="brief-cn-acts">
            {acts.onRestock && (
              <button type="button" className="button brief-small" onClick={acts.onRestock}>
                Check stock again
              </button>
            )}
            {acts.onAdopt && (
              <button type="button" className="button brief-small" onClick={acts.onAdopt}>
                Make it yours
              </button>
            )}
            {acts.onEdit && (
              <button type="button" className="button brief-small" onClick={acts.onEdit}>
                Edit
              </button>
            )}
            <button type="button" className="button brief-small button-quiet" onClick={acts.onRemove}>
              Remove
            </button>
          </div>
        </>
      )}
    </div>
  )
})

export interface SpineProps {
  projectId: string
  nodes: SpineNode[]
  prompts: ReadonlyMap<string, PromptRow>
  pointed: string | null
  onPoint: (id: string | null) => void
  actsOf: (card: Card) => CardActs
  editingOf: (card: Card) => ReactNode | undefined
  /** The prompts new since the person last looked (#340), by id. */
  fresh?: ReadonlySet<string>
  /** The cards new since then, washed in the accent. */
  freshCards?: ReadonlySet<string>
  /** What stands before the first node: the fold of what was seen. */
  before?: ReactNode
}

export function Spine({ projectId, nodes, prompts, pointed, onPoint, actsOf, editingOf, fresh, freshCards, before }: SpineProps) {
  return (
    <ol className="brief-spine">
      {before}
      {nodes.map((node) => {
        const open = node.cards.some((c) => c.id === pointed)
        const isFresh = fresh?.has(node.id) === true
        return (
          <li key={node.id || 'none'} className="brief-node" data-prompt={node.id || undefined} data-open={open ? '' : undefined} data-fresh={isFresh ? '' : undefined}>
            <div className="brief-node-head">
              <b>{nodeName(node)}</b>
              {node.at !== undefined && <span className="num brief-node-when">· {whenSaid(node.at)}</span>}
              {isFresh && <span className="brief-newpill">new</span>}
            </div>
            {node.prompt && node.prompt.text.trim() !== '' && (
              <p className="brief-asked">
                <b>You:</b> {numbered(node.prompt.text.replace(/\s+/g, ' ').trim())}
              </p>
            )}
            <div className="brief-cns">
              {node.cards.map((card) => {
                const replaced = (card.was ?? []).map((w) => ({ text: w.text, ...(w.turn && prompts.get(w.turn.prompt) ? { number: prompts.get(w.turn.prompt)!.number } : {}) }))
                return (
                  <SpineCard
                    key={card.id}
                    projectId={projectId}
                    card={card}
                    node={node}
                    hand={handOf(card, prompts)}
                    pointed={pointed === card.id}
                    fresh={freshCards?.has(card.id) === true}
                    replaced={replaced}
                    onPoint={() => onPoint(pointed === card.id ? null : card.id)}
                    acts={actsOf(card)}
                    editing={editingOf(card)}
                  />
                )
              })}
              {node.ghosts.map((ghost, i) => (
                <p key={`${ghost.card}-${i}`} className="brief-ghost" data-ghost-of={ghost.card}>
                  <s>{cut(ghost.text, 140)}</s> {ghost.changedIn !== undefined ? <>Changed in prompt {numbered(String(ghost.changedIn))}.</> : 'Changed later.'}
                </p>
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
