import { pressed } from '../../../shared/keys'
import { MAX_SIZES, MAX_SIZE_VALUE, MAX_SIZE_WHAT, MAX_SIZE_NOTE, PERSON_SOURCES, SIZE_UNITS, parseSize, type SizeSource, type SizeUnit } from '../../../shared/size'
import { MAX_SHAPE_NOTE } from '../../../shared/slots'
import { onboarding, sizeBlank, sizeProblem, type SizeDraft } from '../../state/onboard'
import { chosen, giveKeysBack, pointerChoice } from '../typing'


function SizeRow({ size, n, disabled }: { size: SizeDraft; n: number; disabled: boolean }) {
  const problem = sizeProblem(size)
  const read = size.value.trim() === '' ? null : parseSize(size.value, size.unit)
  const keep = (e: { key: string; currentTarget: HTMLElement }): void => {
    if (pressed(e as never, 'field.keep')) giveKeysBack(e.currentTarget)
  }
  return (
    <li className="size-row" aria-label={`Size ${n + 1}`}>
      <input
        className="size-what"
        type="text"
        data-first=""
        value={size.what}
        maxLength={MAX_SIZE_WHAT}
        disabled={disabled}
        placeholder="What it measures"
        aria-label={`What size ${n + 1} measures`}
        spellCheck
        autoComplete="off"
        onChange={(e) => onboarding.setSize(size.uid, { what: e.target.value })}
        onKeyDown={keep}
      />
      <input
        className="size-value num"
        type="text"
        value={size.value}
        maxLength={MAX_SIZE_VALUE}
        disabled={disabled}
        placeholder="186 × 128"
        aria-label={`Value of size ${n + 1}`}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onboarding.setSize(size.uid, { value: e.target.value })}
        onKeyDown={keep}
      />
      <select
        className="new-select num"
        aria-label={`Unit of size ${n + 1}`}
        value={size.unit}
        disabled={disabled}
        {...pointerChoice}
        onChange={(e) => {
          onboarding.setSize(size.uid, { unit: e.target.value as SizeUnit })
          chosen(e.currentTarget)
        }}
      >
        {SIZE_UNITS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <select
        className="new-select"
        aria-label={`Where size ${n + 1} came from`}
        value={size.source}
        disabled={disabled}
        {...pointerChoice}
        onChange={(e) => {
          onboarding.setSize(size.uid, { source: e.target.value as SizeSource })
          chosen(e.currentTarget)
        }}
      >
        {PERSON_SOURCES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        className="size-note"
        type="text"
        value={size.note}
        maxLength={MAX_SIZE_NOTE}
        disabled={disabled}
        placeholder="A few words more"
        aria-label={`Note for size ${n + 1}`}
        spellCheck
        autoComplete="off"
        onChange={(e) => onboarding.setSize(size.uid, { note: e.target.value.replace(/[\r\n]+/g, ' ') })}
        onKeyDown={keep}
      />
      <button type="button" className="button button-quiet" aria-label={`Remove size ${n + 1}`} disabled={disabled} onClick={() => onboarding.remove('sizes', size.uid)}>
        Remove
      </button>
      {problem !== null && !sizeBlank(size) && (
        <p className="size-help" data-tone="warn" role="status">
          {problem}
        </p>
      )}
      {problem === null && read === null && (
        <p className="size-help">Kept as typed: Claude is told it is not read as numbers.</p>
      )}
    </li>
  )
}

/** The sizes a board is most often held to, each a press away. The Brief compares the first two with the board drawn. */
export const OFFERED_SIZES = ['Board width', 'Board height', 'Height limit', 'Mounting holes'] as const

function ShapeField({ label, value, placeholder, disabled, onChange }: { label: string; value: string; placeholder: string; disabled: boolean; onChange: (text: string) => void }) {
  return (
    <label className="shape-field">
      <span className="shape-label">{label}</span>
      <input
        className="new-input"
        type="text"
        value={value}
        maxLength={MAX_SHAPE_NOTE}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (pressed(e, 'field.keep')) giveKeysBack(e.currentTarget)
        }}
      />
    </label>
  )
}

/**
 * Size and shape: the sizes the person has (a row each: what it measures, the value as typed, the unit, where it came
 * from), the four a board is most often held to a press away, and the enclosure it fits in and the edges its
 * connectors sit on.
 */
export function SizesSlot({ sizes, enclosure, edges, disabled, onSaid }: { sizes: SizeDraft[]; enclosure: string; edges: string; disabled: boolean; onSaid: (why: string | null) => void }) {
  const full = sizes.length >= MAX_SIZES
  return (
    <>
      <div className="size-offered" role="group" aria-label="Add a size">
        {OFFERED_SIZES.map((what) => (
          <button key={what} type="button" className="button button-quiet" data-first="" disabled={disabled || full || sizes.some((s) => s.what === what)} onClick={() => onSaid(onboarding.addSize({ what }))}>
            {what}
          </button>
        ))}
        <button type="button" className="button button-quiet" disabled={disabled || full} onClick={() => onSaid(onboarding.addSize())}>
          <span aria-hidden="true">+ </span>Another size
        </button>
      </div>
      <ul className="size-list" aria-label="Sizes">
        {sizes.map((s, n) => (
          <SizeRow key={s.uid} size={s} n={n} disabled={disabled} />
        ))}
      </ul>
      {sizes.length > 0 && <p className="new-help">A value is one number, or a × b, or a × b × c, with Ø or R in front. Say where it came from: Claude holds a measured size to the letter.</p>}
      <ShapeField label="Fits an enclosure" value={enclosure} placeholder="Which one, or what is known of it" disabled={disabled} onChange={(text) => onSaid(onboarding.setEnclosure(text))} />
      <ShapeField label="Connector edges" value={edges} placeholder="USB on a short edge, the sensor header opposite" disabled={disabled} onChange={(text) => onSaid(onboarding.setEdges(text))} />
    </>
  )
}
