import { useEffect, useMemo, useState } from 'react'
import { type Card, fabText, readingOrder } from '../../../shared/cards'
import { type Seen, briefSections, briefSpine, briefWords, freshCards, handOf, promptsSaid, referenceNotes, sizeAgainst, spineSaid, whenSaid } from '../../../shared/brief'
import type { PromptRow } from '../../../shared/chat'
import type { SizeFact } from '../../../shared/size'
import { cardsActions, useCards } from '../../state/cards'
import { useStore } from '../../state/store'
import { useViewModel } from '../../state/viewModel'
import { usePrompts } from '../chat/usePrompts'
import { numbered } from '../numbered'
import { FabBlock } from '../route/FabBlock'
import { type CardActs, Spine } from './Spine'
import { addNote, addRule, addSize, adoptCard, editSize, editText, removeCard, restockCard, restoreCard } from './ops'
import { PictureView } from './PictureView'
import { type Acts, PictureTile, ReferenceLine, RuleRow, SizeRow, YourRow } from './Rows'
import { BriefWords } from './BriefWords'
import { SizeForm } from './SizeForm'
import { TextForm } from './TextForm'

// The Brief in the views' place, in two voices (#338): the person's words (`brief.md`, set as a page) on a sheet of
// their own with their pictures and their cards, then what Claude wrote down, then the ledgers of sizes and rules, each
// row saying whose it is, and what was asked of the fab above the fab's limits. The cards are main's
// (`.pino/brief/cards.json`), and `brief.md` is only read. Who wrote what is said by where it stands, and by the edge of
// a row, never by the colour of the words.

/** The pen of the person's hand, beside their words. */
function Pen() {
  return (
    <svg className="brief-pen" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="var(--user-mark)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 13l1-3.5L11 2.5 13.5 5 6.5 12z" />
      <path d="M9.5 4l2.5 2.5" />
    </svg>
  )
}

type Adding = 'size' | 'rule' | 'note' | null

/**
 * What is new since the person looked (#340): what main kept when the Brief was last on screen, read once as the page
 * opens; a project with none has nothing new, and is kept now. Leaving the page keeps what it showed.
 */
function useSince(projectId: string | null): [Seen | null, (seen: Seen) => void] {
  const [since, setSince] = useState<{ of: string; seen: Seen } | null>(null)
  useEffect(() => {
    if (projectId === null) return
    let live = true
    // Only a page that has read what was seen marks it seen when it goes: a mount undone at once (React's StrictMode in
    // development) would otherwise mark everything seen before the page read it.
    let read = false
    window.pino.cards.seen(projectId).then(
      (seen) => {
        if (!live) return
        read = true
        cardsActions.looking(projectId)
        if (seen !== null) setSince({ of: projectId, seen })
        else void window.pino.cards.markSeen(projectId).then((now) => live && setSince({ of: projectId, seen: now }), () => {})
      },
      () => {}
    )
    return () => {
      live = false
      if (read) void cardsActions.leaveBrief()
    }
  }, [projectId])
  return [since !== null && since.of === projectId ? since.seen : null, (seen) => projectId !== null && setSince({ of: projectId, seen })]
}

export function BriefPage() {
  const projectId = useCards((s) => s.projectId)
  const file = useCards((s) => s.file)
  const brief = useCards((s) => s.brief)
  const references = useCards((s) => s.references)
  const problem = useCards((s) => s.problem)
  const { model } = useViewModel()
  const [adding, setAdding] = useState<Adding>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ url: string; label: string } | null>(null)
  const [removed, setRemoved] = useState<{ id: string; what: string } | null>(null)
  const sections = useMemo(() => (file ? briefSections(file) : null), [file])
  const words = useMemo(() => (brief ? briefWords(brief) : ''), [brief])
  const notes = useMemo(() => (brief ? referenceNotes(brief) : new Map<string, string>()), [brief])
  // The project's prompts, numbered across its conversations: asked again when a card names another prompt, and when the
  // session moves on, since a prompt's own line may reach its log after the card it wrote.
  const status = useStore((s) => s.session?.status ?? '')
  const turnsKey = useMemo(() => (file?.cards ?? []).map((c) => c.turn?.prompt ?? c.from?.turn?.prompt ?? '').join(','), [file])
  const rows = usePrompts(projectId !== null, `${turnsKey} ${status}`)
  const prompts = useMemo(() => new Map((rows ?? []).map((r): [string, PromptRow] => [r.id, r])), [rows])
  const nodes = useMemo(() => (file ? briefSpine(readingOrder(file.cards), prompts) : []), [file, prompts])
  const spineCards = useMemo(() => nodes.flatMap((n) => n.cards), [nodes])
  const [since, setSince] = useSince(projectId)
  const [unfolded, setUnfolded] = useState(false)
  const fresh = useMemo(() => freshCards(nodes, since), [nodes, since])
  const freshNodes = useMemo(() => new Set(nodes.filter((n) => n.cards.some((c) => fresh.has(c.id))).map((n) => n.id)), [nodes, fresh])
  // What a new card said before stays on show, struck where it was written: it is part of what is new.
  const kept = nodes.filter((n) => freshNodes.has(n.id) || n.ghosts.some((g) => fresh.has(g.card)))
  const seenNodes = nodes.filter((n) => !kept.includes(n))
  const folded = freshNodes.size > 0 && !unfolded && seenNodes.length > 0
  const newPrompts = nodes.filter((n) => freshNodes.has(n.id) && n.prompt).map((n) => n.prompt!.number)
  const [pointed, setPointed] = useState<string | null>(null)
  /** The card made the person's a moment ago, while it is edited (#339). */
  const [justMine, setJustMine] = useState<string | null>(null)
  const outline = model?.board.box
  const box = useMemo(() => (outline ? { w: outline.x1 - outline.x0, h: outline.y1 - outline.y0 } : null), [outline])

  // What main refused is said for a few seconds, and a removal can be taken back for a while.
  useEffect(() => {
    if (problem === null) return
    const timer = setTimeout(() => cardsActions.say(null), 7000)
    return () => clearTimeout(timer)
  }, [problem])
  useEffect(() => {
    if (removed === null) return
    const timer = setTimeout(() => setRemoved(null), 10000)
    return () => clearTimeout(timer)
  }, [removed])

  if (projectId === null || sections === null) return <section className="brief-page" aria-label="Brief" />
  const id = projectId

  const pictures = references.filter((name) => !/\.pdf$/i.test(name))
  const pdfs = references.filter((name) => /\.pdf$/i.test(name))
  const noteOf = (name: string): string => notes.get(`reference/${name}`) ?? ''

  async function remove(card: Card, what: string): Promise<void> {
    if (await removeCard(id, card.id)) setRemoved({ id: card.id, what })
  }
  const edit = (what: string): void => {
    setAdding(null)
    setEditing(what)
  }
  const add = (what: Adding): void => {
    setEditing(null)
    setAdding(what)
  }
  // The words of a card of Claude's are not the person's to change.
  const acts = (card: Card, what: string): Acts => ({
    ...(card.by === 'person' && card.kind !== 'fab' ? { onEdit: () => edit(card.id) } : {}),
    ...(card.part?.lcsc !== undefined ? { onRestock: () => void restockCard(id, card.id) } : {}),
    onRemove: () => void remove(card, what)
  })
  const done = (): void => {
    setAdding(null)
    setEditing(null)
    setJustMine(null)
  }
  const markSeen = (): void => {
    void window.pino.cards.markSeen(id).then((now) => {
      setSince(now)
      setUnfolded(false)
    }, (e: unknown) => cardsActions.say(e instanceof Error ? e.message : String(e)))
  }
  // A card may stand on the spine and in a table too: its form opens only where the person asked for it.
  const onSpine = (card: Card): string => `spine:${card.id}`
  const spineActs = (card: Card): CardActs => {
    const { onEdit, ...rest } = acts(card, card.size?.what ?? 'the card')
    return {
      ...rest,
      ...(onEdit ? { onEdit: () => edit(onSpine(card)) } : {}),
      // Make it yours (#339): the card becomes the person's and is edited where it stands.
      ...(card.by === 'agent'
        ? {
            onAdopt: () =>
              void adoptCard(id, card.id).then((ok) => {
                if (!ok) return
                setPointed(null)
                edit(onSpine(card))
                setJustMine(card.id)
              })
          }
        : {})
    }
  }
  /** The form that takes a spine card's place while the person edits it. */
  const editingOf = (card: Card) => {
    if (editing !== onSpine(card)) return undefined
    const wrote = handOf(card, prompts).label.replace(/^Yours, from /, '')
    const note = (
      <>
        Yours now, so you can change it. Claude is told at the next prompt.
        {card.from && (
          <>
            {' '}
            {justMine === card.id ? 'Made yours just now. ' : ''}Claude wrote it in {numbered(wrote === 'Yours, from Claude' ? 'an earlier prompt' : wrote)}.
          </>
        )}
      </>
    )
    return card.kind === 'size' ? <SizeForm was={card.size} onKeep={keepSize(card)} onCancel={done} note={note} /> : <TextForm initial={card.text} label="Words" onKeep={keepText(card, false)} onCancel={done} note={note} />
  }
  const keepSize = (card: Card | null) => async (size: SizeFact): Promise<void> => {
    if (await (card ? editSize(id, card.id, size) : addSize(id, size))) done()
  }
  const keepText = (card: Card | null, rule: boolean) => async (text: string): Promise<void> => {
    if (await (card ? editText(id, card.id, text) : rule ? addRule(id, text) : addNote(id, text))) done()
  }

  return (
    <section className="brief-page" aria-label="Brief">
      <header className="brief-head">
        <h1>What we are making</h1>
      </header>

      {(problem !== null || removed !== null) && (
        <div className="brief-notices">
          {problem !== null && (
            <p className="brief-problem" role="status">
              {problem}
            </p>
          )}
          {removed !== null && (
            <p className="brief-removed" role="status">
              Removed {removed.what}.{' '}
              <button type="button" className="link-button" onClick={() => void restoreCard(id, removed.id).then(() => setRemoved(null))}>
                Undo
              </button>
            </p>
          )}
        </div>
      )}

      {freshNodes.size > 0 && since !== null && (
        <div className="brief-band" role="status">
          <span className="brief-fresh-dot" />
          <span>
            <b>{numbered(newPrompts.length > 0 ? `New since you looked: ${promptsSaid(newPrompts)}` : 'New since you looked')}</b>
            <span className="brief-band-when">, {numbered(whenSaid(Date.parse(since.at)))}</span>
          </span>
          <span className="grow" />
          <button type="button" className="button button-quiet brief-small" onClick={markSeen}>
            Mark as seen
          </button>
        </div>
      )}

      <section className="brief-yours" aria-label="In your words">
        <div className="brief-yours-head">
          <Pen />
          <h2>In your words</h2>
          {typeof brief === 'string' && (
            <span className="brief-yours-from">
              kept in <span className="num">brief.md</span>
            </span>
          )}
        </div>
        <div className="brief-yours-body">
          <div className="brief-yours-words">
            {brief === null && <p className="brief-by">No brief.md yet. Write what the board does there, or tell Claude.</p>}
            {typeof brief === 'string' && (words === '' ? <p className="brief-by">brief.md has no words yet.</p> : <BriefWords projectId={id} words={words} full={brief} />)}
            {pdfs.map((name) => (
              <ReferenceLine key={name} file={name} note={noteOf(name)} />
            ))}
          </div>
          {pictures.length > 0 && (
            <div className="brief-tiles">
              {pictures.map((name) => (
                <PictureTile key={`${id}/${name}`} projectId={id} file={name} note={noteOf(name)} onOpen={(url, label) => setViewing({ url, label })} />
              ))}
            </div>
          )}
        </div>
        {(sections.yours.length > 0 || adding === 'note') && (
          <div className="brief-added">
            {sections.yours.map((group) => (
              <section key={group.frame?.id ?? ''} className="brief-group" aria-label={group.frame?.name ?? 'Your notes'}>
                {group.frame && <h3>{group.frame.name}</h3>}
                {group.cards.map((c) => (editing === c.id ? <TextForm key={c.id} initial={c.text} label="Note" onKeep={keepText(c, false)} onCancel={done} /> : <YourRow key={c.id} projectId={id} card={c} acts={acts(c, 'the card')} hand={handOf(c, prompts)} />))}
              </section>
            ))}
            {adding === 'note' && <TextForm label="New note" onKeep={keepText(null, false)} onCancel={done} />}
          </div>
        )}
        <div className="brief-yours-foot">
          <button type="button" className="link-button" onClick={() => add('note')}>
            Add a note
          </button>
        </div>
      </section>

      <section className="brief-voices" aria-label="What Claude wrote down">
        <div className="brief-block-head">
          <h2>What Claude wrote down</h2>
          {spineCards.length > 0 && <span className="brief-said">by the prompt that wrote it: {numbered(spineSaid(spineCards))}</span>}
        </div>
        {nodes.length === 0 ? (
          <p className="brief-by">Claude has written nothing down yet.</p>
        ) : (
          <Spine
            projectId={id}
            nodes={folded ? kept : nodes}
            fresh={freshNodes}
            freshCards={fresh}
            before={
              folded ? (
                <li className="brief-node brief-fold">
                  <span>Seen before: {numbered(spineSaid(seenNodes.flatMap((n) => n.cards)))}.</span>
                  <button type="button" className="button button-quiet brief-small" onClick={() => setUnfolded(true)}>
                    Show them
                  </button>
                </li>
              ) : undefined
            }
            prompts={prompts}
            pointed={pointed}
            onPoint={setPointed}
            actsOf={spineActs}
            editingOf={editingOf}
          />
        )}
      </section>

      <section className="brief-block" aria-label="Size and shape">
        <div className="brief-block-head">
          <h2>Size and shape</h2>
          <span className="brief-said" />
          <button type="button" className="link-button" onClick={() => add('size')}>
            Add a size
          </button>
        </div>
        {(sections.sizes.length > 0 || adding === 'size') && (
          <div className="brief-ledger">
            {sections.sizes.length > 0 && (
              <div className="brief-row brief-headrow" aria-hidden="true">
                <span>Size</span>
                <span>What it measures, from where</span>
                <span>Who</span>
                <span className="brief-against">Against the build on show</span>
              </div>
            )}
            {sections.sizes.map((c) =>
              editing === c.id ? <SizeForm key={c.id} was={c.size} onKeep={keepSize(c)} onCancel={done} /> : <SizeRow key={c.id} card={c} acts={acts(c, 'the size')} against={sizeAgainst(c, box)} hand={handOf(c, prompts)} />
            )}
            {adding === 'size' && <SizeForm onKeep={keepSize(null)} onCancel={done} />}
          </div>
        )}
      </section>

      <section className="brief-block" aria-label="Rules">
        <div className="brief-block-head">
          <h2>Rules</h2>
          <span className="brief-said" />
          <button type="button" className="link-button" onClick={() => add('rule')}>
            Add a rule
          </button>
        </div>
        {(sections.rules.length > 0 || adding === 'rule') && (
          <div className="brief-ledger">
            {sections.rules.map((c) => (editing === c.id && !spineCards.includes(c) ?<TextForm key={c.id} initial={c.text} label="Rule" onKeep={keepText(c, true)} onCancel={done} /> : <RuleRow key={c.id} projectId={id} card={c} acts={acts(c, 'the rule')} hand={handOf(c, prompts)} />))}
            {adding === 'rule' && <TextForm label="New rule" onKeep={keepText(null, true)} onCancel={done} />}
          </div>
        )}
      </section>

      <section className="brief-block" aria-label="Fab">
        <div className="brief-block-head">
          <h2>Fab</h2>
        </div>
        {sections.fab?.fab ? <p className="brief-asked-fab">{`You asked for ${fabText(sections.fab.fab)}`}</p> : <p className="brief-by">Nothing is asked of the fab on a card.</p>}
        <FabBlock />
      </section>

      {viewing && <PictureView url={viewing.url} label={viewing.label} onClose={() => setViewing(null)} />}
    </section>
  )
}
