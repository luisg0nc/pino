import type { ComponentProps, ReactNode } from 'react'
import { bandFor, type BandKind } from '../../../shared/view'
import { numbered } from '../numbered'
import { actions, useStore } from '../../state/store'

/**
 * The band at the foot of the view: one sentence for what is true of the whole view, with the buttons it calls for as
 * pills (torno's band, placed where the design mocks place it). It drops in once. Tags stand clear of it
 * (`data-tag-avoid`).
 */
export function Band({ kind, label, controls = true, children }: { kind: BandKind; label: string; controls?: boolean; children: ReactNode }) {
  return (
    <div className="band" role={controls ? 'toolbar' : 'status'} aria-label={label} data-band={kind} data-tag-avoid="">
      {children}
    </div>
  )
}

/** A button inside a band: filled when it is what the band asks for. */
export function BandButton({ primary = false, ...rest }: ComponentProps<'button'> & { primary?: boolean }) {
  return <button type="button" {...rest} className={`band-button${rest.className ? ` ${rest.className}` : ''}`} data-primary={primary ? '' : undefined} />
}

/** The band the view wears now, or nothing: a build that failed over the last one drawn, or an older build on show. */
export function ViewBand() {
  const build = useStore((s) => s.build)
  const shown = useStore((s) => s.shown)
  const band = bandFor(build, shown)
  if (!band) return null
  if (band.kind === 'older') {
    return (
      <Band kind="older" label="An older build is on show">
        <span>{numbered(band.text)}</span>
        <BandButton primary onClick={() => actions.showBuild(null)}>
          Back to latest
        </BandButton>
      </Band>
    )
  }
  return (
    <Band kind="failed" label="Build failed" controls={false}>
      <span className="band-dot" aria-hidden="true" />
      <span className="band-words selectable" title={band.text}>
        {numbered(band.text)}
      </span>
    </Band>
  )
}
