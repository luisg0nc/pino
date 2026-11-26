import type { Finding } from '../../shared/build'
import type { Pt } from '../../shared/board/geom'
import { actions, useStore } from '../state/store'
import { numbered } from '../ui/numbered'
import { Tag } from '../ui/view/Tag'
import { clusterPins, positioned, type Pinned } from './pins'

/** Pins nearer than this on screen are gathered into one, in px. */
const GATHER = 18
const MOST_SAID = 3
const WORD = { error: 'fail', warning: 'warn', info: 'note' } as const

/**
 * The findings that have a place, as numbered pins: a round one for a finding, a square one with a count where several
 * would cover one another. The one in hand is filled with the accent and tied to its words by a leader.
 * `place` puts a finding's own coordinates on the view, in its pixels.
 */
export function FindingPins({ findings, space, place }: { findings: readonly Finding[]; space: 'board' | 'sheet'; place: (p: Pinned) => Pt }) {
  const hot = useStore((s) => s.hotFinding)
  const clusters = clusterPins(positioned(findings, space), place, GATHER)
  const held = clusters.find((c) => c.members.some((m) => m.index === hot))
  const first = held?.members.find((m) => m.index === hot)
  const said = held && first ? [first, ...held.members.filter((m) => m !== first)] : []
  return (
    <>
      {clusters.map((cluster) => {
        const [one] = cluster.members
        const many = cluster.members.length > 1
        return (
          <button
            key={one.index}
            type="button"
            className="pin"
            data-severity={cluster.severity}
            data-many={many || undefined}
            data-hot={held === cluster || undefined}
            style={{ transform: `translate(${Math.round(cluster.at.x)}px, ${Math.round(cluster.at.y)}px)` }}
            aria-label={many ? `${cluster.members.length} findings here, from ${one.finding.message}` : `Finding ${one.n}: ${one.finding.message}`}
            onPointerEnter={() => actions.hoverFinding(one.index)}
            onPointerLeave={() => actions.hoverFinding(null)}
            onFocus={() => actions.hoverFinding(one.index)}
            onBlur={() => actions.hoverFinding(null)}
          >
            {many ? cluster.members.length : one.n}
          </button>
        )
      })}
      {held && first && (
        <Tag id="finding" subject={held.at} prefer="right">
          {said.slice(0, MOST_SAID).map((pin) => (
            <p key={pin.index} className="tag-finding">
              <span className="tag-words">{numbered(pin.finding.message)}</span>
              <span className="tag-severity" data-severity={pin.finding.severity}>
                {WORD[pin.finding.severity]}
              </span>
            </p>
          ))}
          <p className="tag-more">
            {said.length > MOST_SAID && `and ${said.length - MOST_SAID} more · `}
            {first.finding.refs?.join(', ')}
            {first.finding.refs?.length ? ' · ' : ''}({first.x.toFixed(2)}, {first.y.toFixed(2)}) mm
          </p>
        </Tag>
      )}
    </>
  )
}
