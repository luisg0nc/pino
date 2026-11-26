import { memo, useEffect, useState } from 'react'
import { type Card, firstLink, readingLine } from '../../../shared/cards'
import { sizeSource, sizeValue, whenSaid } from '../../../shared/brief'
import { refPieces } from './refPieces'
import { openLink } from './ops'
import { numbered } from '../numbered'

// The pieces of the sheet. A row is drawn again only when its card changes.

function Pieces({ text }: { text: string }) {
  return (
    <>
      {refPieces(text).map((p, i) =>
        p.ref ? (
          <span key={i} className="num">
            {p.text}
          </span>
        ) : (
          p.text
        )
      )}
    </>
  )
}

/** The text of a card (or `text`, a part of it) with the web address in it as a link: main opens it in the browser, from the card, so no address is ever sent from here. */
export function Words({ projectId, card, text = card.text ?? '' }: { projectId: string; card: Card; text?: string }) {
  const link = firstLink(text)
  const at = link === null ? -1 : text.indexOf(link)
  if (link === null || at < 0) return <Pieces text={text} />
  return (
    <>
      <Pieces text={text.slice(0, at)} />
      <a
        className="brief-link num"
        href={link}
        title="Open in your browser"
        onClick={(e) => {
          e.preventDefault()
          openLink(projectId, card.id)
        }}
      >
        {link}
      </a>
      <Pieces text={text.slice(at + link.length)} />
    </>
  )
}

export interface Acts {
  onEdit?: () => void
  onRemove: () => void
}

/** Edit, where the card's words are the person's to change, and Remove. `what` says which card, to whoever does not see where they stand. */
function Buttons({ acts, what }: { acts: Acts; what: string }) {
  return (
    <span className="brief-acts">
      {acts.onEdit && (
        <button type="button" className="link-button" aria-label={`Edit ${what}`} onClick={acts.onEdit}>
          Edit
        </button>
      )}
      <button type="button" className="link-button" aria-label={`Remove ${what}`} title={`Remove ${what}`} onClick={acts.onRemove}>
        Remove
      </button>
    </span>
  )
}

export interface HandSaid {
  hand: 'you' | 'claude'
  label: string
}

/** Who wrote a row: a dot in the hand's colour and the hand with its prompt (`Claude, prompt 13`), never the colour of the words. */
export function Hand({ hand }: { hand: HandSaid }) {
  return (
    <span className="brief-hand-cell">
      <span className="brief-hand" data-hand={hand.hand}>
        {numbered(hand.label)}
      </span>
    </span>
  )
}

export const SizeRow = memo(function SizeRow({ card, acts, against, hand }: { card: Card; acts: Acts; against: { built: number; differs: boolean } | null; hand: HandSaid }) {
  const size = card.size!
  return (
    <div className="brief-row" data-card={card.id} data-by={card.by} data-differs={against?.differs ? '' : undefined}>
      <div className="brief-value num">
        {sizeValue(size)}
        <span className="brief-unit">{size.unit}</span>
      </div>
      <div className="brief-what">
        <b>{size.what}</b>
        <span className="brief-source">{sizeSource(size)}</span>
        <span className="brief-id num">{card.id}</span>
        <Buttons acts={acts} what={size.what} />
      </div>
      <Hand hand={hand} />
      <div className="brief-against">{against && <span className="brief-verdict">{numbered(`the board is ${against.built} mm`)}</span>}</div>
    </div>
  )
})

export const RuleRow = memo(function RuleRow({ projectId, card, acts, hand }: { projectId: string; card: Card; acts: Acts; hand: HandSaid }) {
  return (
    <div className="brief-row brief-rule" data-card={card.id} data-by={card.by}>
      <div className="brief-what">
        <p>
          <Words projectId={projectId} card={card} />
        </p>
        <span className="brief-id num">{card.id}</span>
        <Buttons acts={acts} what="the rule" />
      </div>
      <Hand hand={hand} />
    </div>
  )
})

/** What a card of the person's is said to be before its words; a note is only its words. */
const KIND_LABEL: Partial<Record<Card['kind'], string>> = { requirement: 'Requirement', decision: 'Decision', question: 'Open question', part: 'Part', power: 'Power', connection: 'Connection', link: 'Link' }

/** A card of the person's in their sheet: what it is, their words, a part's stock under them, and whose it is. */
export const YourRow = memo(function YourRow({ projectId, card, acts, hand }: { projectId: string; card: Card; acts: Acts; hand: HandSaid }) {
  const label = KIND_LABEL[card.kind]
  const at = card.at === undefined ? Number.NaN : Date.parse(card.at)
  const part = card.part?.lcsc
  return (
    <div className="brief-note" data-card={card.id} data-by={card.by}>
      <span className="brief-note-when">{label ?? (Number.isFinite(at) ? numbered(whenSaid(at)) : 'Note')}</span>
      <span className="brief-note-text">
        <Words projectId={projectId} card={card} />
        <span className="brief-id num">{card.id}</span>
        <Buttons acts={acts} what={label ? `the ${label.toLowerCase()}` : 'the note'} />
        {part !== undefined && <span className="brief-reading num">{`${part} · ${card.part?.reading ? readingLine(card.part.reading) : 'stock not checked'}`}</span>}
      </span>
      <Hand hand={hand} />
    </div>
  )
})

/** A picture of `reference/` as the window may have it: a URL for its bytes, null when main may not read it, undefined while it is asked. */
function usePicture(projectId: string, file: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    let made: string | undefined
    window.pino.cards.reference(projectId, file).then(
      (picture) => {
        if (!live) return
        made = picture ? URL.createObjectURL(new Blob([new Uint8Array(picture.bytes)], { type: picture.mediaType })) : undefined
        setUrl(made ?? null)
      },
      () => live && setUrl(null)
    )
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [projectId, file])
  return url
}

/** A photo or doodle as a tile: its file and note under it, large on a click. */
export function PictureTile({ projectId, file, note, onOpen }: { projectId: string; file: string; note: string; onOpen: (url: string, label: string) => void }) {
  const url = usePicture(projectId, file)
  return (
    <figure className="brief-tile">
      {url ? (
        <button type="button" className="brief-photo" aria-label={`Open ${file} large`} onClick={() => onOpen(url, note || file)}>
          <img src={url} alt={note || file} draggable={false} />
        </button>
      ) : (
        <div className="brief-photo" data-missing="">
          {url === null ? 'picture not on this computer' : ''}
        </div>
      )}
      <figcaption>
        <span className="num">{file}</span>
        {note !== '' && <small>{note}</small>}
      </figcaption>
    </figure>
  )
}

/** A PDF of `reference/`: its name and the person's note of it. */
export function ReferenceLine({ file, note }: { file: string; note: string }) {
  return (
    <div className="brief-ref">
      <span className="num">{file}</span>
      <small>{note ? `a PDF · ${note}` : 'a PDF'}</small>
    </div>
  )
}
