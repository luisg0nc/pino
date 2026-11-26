import type { ReactNode } from 'react'
import { pressed } from '../../../shared/keys'
import { onboarding, type Draft, type Kind } from '../../state/onboard'
import { giveKeysBack } from '../typing'

/** The longest note a card takes (main folds it to one line and takes up to 2000). */
const NOTE_MAX = 500

/** A file size as a person reads it: kilobytes up to a megabyte, then megabytes. */
export function sizeSaid(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-US')} KB` : `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toLocaleString('en-US')} MB`
}

function Note({ kind, itemKey, value, label }: { kind: Kind; itemKey: string; value: string; label: string }) {
  return (
    <input
      className="ref-note"
      type="text"
      value={value}
      maxLength={NOTE_MAX}
      placeholder="Note for Claude"
      aria-label={label}
      spellCheck
      autoComplete="off"
      onChange={(e) => onboarding.setNote(kind, itemKey, e.target.value)}
      onKeyDown={(e) => {
        // Enter keeps what was typed and gives the keys back to the page, as every field does.
        if (pressed(e, 'field.keep')) giveKeysBack(e.currentTarget)
      }}
    />
  )
}

function Card({ kind, word, itemKey, file, detail, note, thumb, onEdit, name }: { kind: Kind; word: string; itemKey: string; file: string; detail?: string; note: string; thumb: ReactNode; onEdit?: () => void; name: string }) {
  return (
    <li className="ref-card" data-kind={kind} aria-label={`${word} ${name}`}>
      <div className="ref-thumb">{thumb}</div>
      <div className="ref-body">
        <p className="ref-head">
          <span className="ref-kind">{word}</span>
          <span className="ref-file num" title={file}>
            {file}
          </span>
          {detail && <span className="ref-detail num">{detail}</span>}
        </p>
        <Note kind={kind} itemKey={itemKey} value={note} label={`Note for ${word.toLowerCase()} ${file}`} />
      </div>
      <div className="ref-actions">
        {onEdit && (
          <button type="button" className="button button-quiet" aria-label={`Change ${name}`} onClick={onEdit}>
            Change
          </button>
        )}
        <button type="button" className="button button-quiet" aria-label={`Remove ${name}`} onClick={() => onboarding.remove(kind, itemKey)}>
          Remove
        </button>
      </div>
    </li>
  )
}

/** The kinds that are cards of files, in the order they are listed in. */
export type FileKind = 'photos' | 'doodles' | 'pdfs'

/** What the person has given of the kinds named (all of them when none are), a card each, in the order of the kinds: photos, doodles, PDFs. `tail`: more items (`<li>`) after the cards. */
export function ReferenceCards({ draft, kinds, label = 'What you have', onEditDoodle, tail }: { draft: Draft; kinds?: readonly FileKind[]; label?: string; onEditDoodle: (key: string) => void; tail?: ReactNode }) {
  const has = (kind: FileKind): boolean => kinds === undefined || kinds.includes(kind)
  return (
    <ul className="ref-list" aria-label={label}>
      {has('photos') && draft.photos.map((p, n) => (
        <Card key={p.uid} kind="photos" word="Photo" itemKey={p.uid} file={p.file} detail={p.detail} note={p.note} name={`photo ${n + 1}`} thumb={<img src={p.url} alt="" draggable={false} />} />
      ))}
      {has('doodles') && draft.doodles.map((d, n) => (
        <Card key={d.uid} kind="doodles" word="Doodle" itemKey={d.uid} file={`doodle-${n + 1}.png`} note={d.note} name={`doodle ${n + 1}`} thumb={<img src={d.url} alt="" draggable={false} />} onEdit={() => onEditDoodle(d.uid)} />
      ))}
      {has('pdfs') &&
        draft.pdfs.map((p, n) => (
          <Card
            key={p.uid}
            kind="pdfs"
            word="PDF"
            itemKey={p.uid}
            file={p.file}
            detail={p.size === undefined ? undefined : sizeSaid(p.size)}
            note={p.note}
            name={`PDF ${n + 1}`}
            thumb={
              <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 4h10l5 5v19H9z" />
                <path d="M19 4v5h5M12 16h9M12 20h9M12 24h5" />
              </svg>
            }
          />
        ))}
      {tail}
    </ul>
  )
}
