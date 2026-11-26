import type { ComponentProps, ReactNode } from 'react'
import { clock } from '../../../shared/checks'
import { bandFor, type BandKind } from '../../../shared/view'
import { numbered } from '../numbered'
import { useNow } from '../useNow'
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

/**
 * The band the view wears now, or nothing: an older build on show, a build that failed over the last one drawn, a
 * route in the background, or copper that no longer fits. `from`: the number of the build that copper was made for.
 */
export function ViewBand({ from }: { from?: number }) {
  const build = useStore((s) => s.build)
  const shown = useStore((s) => s.shown)
  const kept = useStore((s) => s.keptStale)
  const projectId = useStore((s) => s.project?.id ?? null)
  const band = bandFor(build, shown, { kept, from })
  const now = useNow(band?.kind === 'routing')
  if (!band || !projectId) return null
  const failed = (e: Error) => actions.notice(e.message)
  if (band.kind === 'routing') {
    return (
      <Band kind="routing" label="Routing">
        <span className="band-words">{numbered(band.text)}</span>
        {band.progress && (
          <span className="band-progress" role="progressbar" aria-label="Nets routed" aria-valuemin={0} aria-valuemax={band.progress.of} aria-valuenow={band.progress.done}>
            <i style={{ width: `${(100 * band.progress.done) / band.progress.of}%` }} />
          </span>
        )}
        {build?.route && <span className="band-clock num">{clock(now - build.route.startedAt)}</span>}
        <BandButton onClick={() => void window.pino.route.cancel(projectId).catch(failed)}>Cancel</BandButton>
      </Band>
    )
  }
  if (band.kind === 'stale') {
    return (
      <Band kind="stale" label="The copper is stale">
        <span className="band-dot" aria-hidden="true" />
        <span className="band-words selectable" title={band.text}>
          {numbered(band.text)}
        </span>
        <BandButton primary onClick={() => void window.pino.route.start(projectId).catch(failed)}>
          Route again
        </BandButton>
        <BandButton onClick={() => actions.keepStale(build!.lastGood!.hash!)}>Keep it</BandButton>
      </Band>
    )
  }
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
