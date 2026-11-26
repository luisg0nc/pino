// What is new or moved from one board to the next, for the one highlight after a build.

import type { Board } from './board'
import { dist } from './geom'

export interface ChangedSet {
  parts: string[]
  tracks: string[]
  vias: string[]
  zones: string[]
}

const MOVED = 0.01 // mm

export function changedItems(prev: Board | null, next: Board): ChangedSet {
  if (!prev) return { parts: [], tracks: [], vias: [], zones: [] }
  const before = new Map(prev.footprints.map((f) => [f.ref, f]))
  const added = <T extends { uuid: string }>(was: T[], now: T[]) => {
    const ids = new Set(was.map((x) => x.uuid))
    return now.filter((x) => !ids.has(x.uuid)).map((x) => x.uuid)
  }
  return {
    parts: next.footprints
      .filter((f) => {
        const old = before.get(f.ref)
        return !old || dist(old.pos, f.pos) > MOVED || Math.abs(((f.angle - old.angle + 540) % 360) - 180) > 0.01 || old.side !== f.side
      })
      .map((f) => f.ref),
    tracks: added(prev.tracks, next.tracks),
    vias: added(prev.vias, next.vias),
    zones: added(prev.zones, next.zones)
  }
}
