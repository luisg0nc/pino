// The findings as pins on the board and the sheet: numbered, and gathered where they would cover one another.

import type { Finding, Severity } from '../../shared/build'
import type { Pt } from '../../shared/board/geom'

export interface Pinned {
  /** The pin's number: its place among the findings that have a position here, from 1. */
  n: number
  /** Its place in the result's findings. */
  index: number
  finding: Finding
  /** As the finding gives it: board millimetres (y up) or sheet millimetres (y down). */
  x: number
  y: number
}

export function positioned(findings: readonly Finding[], space: 'board' | 'sheet'): Pinned[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding.at?.space === space && typeof finding.at.x === 'number' && typeof finding.at.y === 'number')
    .map(({ finding, index }, i) => ({ n: i + 1, index, finding, x: finding.at!.x!, y: finding.at!.y! }))
}

export interface Cluster {
  /** Where the pin stands on screen: its first member's place. */
  at: Pt
  members: Pinned[]
  severity: Severity
}

const WORSE: Record<Severity, number> = { error: 2, warning: 1, info: 0 }

export function clusterPins(pins: readonly Pinned[], place: (p: Pinned) => Pt, within: number): Cluster[] {
  const clusters: Cluster[] = []
  for (const pin of pins) {
    const at = place(pin)
    const held = clusters.find((c) => Math.hypot(c.at.x - at.x, c.at.y - at.y) < within)
    if (!held) clusters.push({ at, members: [pin], severity: pin.finding.severity })
    else {
      held.members.push(pin)
      if (WORSE[pin.finding.severity] > WORSE[held.severity]) held.severity = pin.finding.severity
    }
  }
  return clusters
}
