// A mark found again on a newer build, by the stable ids it is anchored to: refs, pins, nets and uuids. What moved is
// marked moved and its line redone; what is gone stays where it was, marked stale. A resolved mark is history.

import { toBoard } from '../../shared/board/coords'
import { gapSpan } from '../../shared/board/measure'
import { centreOf, hasTarget } from '../../shared/board/refs'
import type { Pt } from '../../shared/board/geom'
import { markLabel, markPayload, withCrossings, type Mark } from '../../shared/marks'
import type { BuildModel } from '../model'

const MOVED = 0.01 // mm

const far = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) > MOVED

export function reanchor(mark: Mark, model: BuildModel): Mark {
  // A build that drew nothing says nothing about where anything is.
  if (mark.status === 'resolved' || !model.result.hash) return mark
  // Copper is looked for on the routed board while its route is current: stale copper is gone from the build.
  const board = model.result.routing?.state === 'current' && model.routeBoard ? model.routeBoard : model.board
  const checkedBuild = model.result.number
  const found = (next: Mark): Mark => {
    const { was: _was, ...rest } = next
    const fresh = { ...rest, checkedBuild } as Mark
    return { ...fresh, payload: markPayload(fresh, board, model.circuit) }
  }
  const stale = (where: Pt): Mark => {
    if (mark.anchor === 'stale') return { ...mark, checkedBuild }
    const lost = { ...mark, anchor: 'stale', checkedBuild, was: { at: where, text: mark.payload } } as Mark
    return { ...lost, payload: markPayload(lost, board, model.circuit) }
  }

  if (mark.kind === 'point') {
    if (!hasTarget(board, mark.target)) return stale(mark.was?.at ?? mark.at)
    // A point on the sheet keeps its place on the sheet: its target is what is followed.
    const centre = mark.space === 'sheet' ? mark.at : centreOf(board, mark.target)!
    const moved = far(centre, mark.at)
    return found({ ...mark, anchor: moved ? 'moved' : 'ok', at: moved ? centre : mark.at })
  }
  if (mark.kind === 'arrow' && mark.from && mark.toward) {
    // A gap Claude pointed at: measured again, so that its ends and the number on its chip are the board's as it is now.
    if (!hasTarget(board, mark.from) || !hasTarget(board, mark.toward)) return stale(mark.was?.at ?? mark.fromAt)
    const span = gapSpan(board, mark.from, mark.toward)
    const [fromAt, to] = [toBoard(span.from), toBoard(span.to)]
    const moved = far(fromAt, mark.fromAt) || far(to, mark.to)
    const next = moved ? { ...mark, anchor: 'moved' as const, fromAt, to } : { ...mark, anchor: 'ok' as const }
    return found({ ...next, label: markLabel(next) })
  }
  if (mark.kind === 'arrow') {
    if (mark.from && !hasTarget(board, mark.from)) return stale(mark.was?.at ?? mark.fromAt)
    // An arrow starts at its item: the person's follows it, and where it points stays.
    const centre = mark.from && mark.author === 'user' ? centreOf(board, mark.from)! : mark.fromAt
    const moved = far(centre, mark.fromAt)
    return found({ ...mark, anchor: moved ? 'moved' : 'ok', fromAt: moved ? centre : mark.fromAt })
  }
  return found({ ...withCrossings(mark, board), anchor: 'ok' })
}
