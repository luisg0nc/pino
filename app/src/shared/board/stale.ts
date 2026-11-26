// A route that no longer fits the board it was made on: its tracks, vias and pours laid over the newer build and named,
// so that the view draws them faded while pads and parts stay as the build has them.

import type { Board } from './board'

export function withStaleCopper(build: Board, route: Board): { board: Board; stale: Set<string> } {
  const fresh = new Set([...build.tracks, ...build.vias, ...build.zones].map((x) => x.uuid))
  const only = <T extends { uuid: string }>(items: T[]) => items.filter((x) => !fresh.has(x.uuid))
  const tracks = only(route.tracks)
  const vias = only(route.vias)
  // A pour the build already has (by net and layers) is drawn from the build: the route's copy would hatch it twice.
  const poured = new Set(build.zones.map((z) => `${z.net}|${z.layers.join()}`))
  const zones = only(route.zones).filter((z) => !poured.has(`${z.net}|${z.layers.join()}`))
  return {
    board: { ...build, tracks: [...build.tracks, ...tracks], vias: [...build.vias, ...vias], zones: [...build.zones, ...zones] },
    stale: new Set([...tracks, ...vias, ...zones].map((x) => x.uuid))
  }
}
