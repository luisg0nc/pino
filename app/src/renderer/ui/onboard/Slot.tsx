import { useId, type ReactNode } from 'react'

/** A dashed tile that adds one more to the page: its name, and under it a muted line of what it takes. */
export function PicTile({ title, hint, help, disabled, onClick }: { title: string; hint: ReactNode; help?: string; disabled: boolean; onClick: () => void }) {
  const said = useId()
  return (
    <button type="button" className="pic-tile" aria-label={title} aria-describedby={said} disabled={disabled} title={help} onClick={onClick}>
      <span className="pic-tile-title">{title}</span>
      <span className="pic-tile-hint" id={said}>{hint}</span>
    </button>
  )
}

/**
 * A card of the New project page, one for each slot opened. It has its name and what it is for, `add` for the
 * quiet button that adds a row, and what is in it. `wide` takes the whole row.
 */
export function Slot({ id, title, hint, add, wide, children }: { id: string; title: string; hint: string; add?: ReactNode; wide?: boolean; children?: ReactNode }) {
  return (
    <section className="slot" data-slot={id} data-wide={wide ? '' : undefined} aria-labelledby={`slot-${id}`}>
      <div className="slot-head">
        <h3 className="slot-title" id={`slot-${id}`}>
          {title}
        </h3>
        <span className="slot-hint">{hint}</span>
        {add && <span className="slot-add">{add}</span>}
      </div>
      {children}
    </section>
  )
}
