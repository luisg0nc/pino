import { useEffect, useMemo, useState } from 'react'
import { type Card, fabText } from '../../../shared/cards'
import { briefSections, briefWords, handOf, referenceNotes, sizeAgainst } from '../../../shared/brief'
import type { PromptRow } from '../../../shared/chat'
import type { SizeFact } from '../../../shared/size'
import { cardsActions, useCards } from '../../state/cards'
import { useViewModel } from '../../state/viewModel'
import { FabBlock } from '../route/FabBlock'
import { addNote, addRule, addSize, editSize, editText, removeCard, restoreCard } from './ops'
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

/** The prompts a card's hand is numbered by. */
const NO_PROMPTS: ReadonlyMap<string, PromptRow> = new Map()

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
  const prompts = NO_PROMPTS
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
    onRemove: () => void remove(card, what)
  })
  const done = (): void => {
    setAdding(null)
    setEditing(null)
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
        </div>
        <p className="brief-by">Claude has written nothing down yet.</p>
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
            {sections.rules.map((c) => (editing === c.id ? <TextForm key={c.id} initial={c.text} label="Rule" onKeep={keepText(c, true)} onCancel={done} /> : <RuleRow key={c.id} projectId={id} card={c} acts={acts(c, 'the rule')} hand={handOf(c, prompts)} />))}
            {adding === 'rule' && <TextForm label="New rule" onKeep={keepText(null, true)} onCancel={done} />}
          </div>
        )}
      </section>

      <section className="brief-block" aria-label="Fab">
        <div className="brief-block-head">
          <h2>Fab</h2>
        </div>
        {sections.fab?.fab && <p className="brief-asked-fab">{`You asked for ${fabText(sections.fab.fab)}`}</p>}
        <FabBlock />
      </section>

      {viewing && <PictureView url={viewing.url} label={viewing.label} onClose={() => setViewing(null)} />}
    </section>
  )
}
