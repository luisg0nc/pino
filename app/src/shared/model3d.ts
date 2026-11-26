// Which model the 3D view and Claude's picture of it load, so that 3D shows the copper the Board view shows. A build's
// model has no routed tracks: whenever the board's copper is a route's, fresh or stale, it is the route's own model.

import type { BBox } from './board/geom'
import type { RoutingState } from './build'

/** `box`: the outline of the board the model was exported from, which places points of the board file on it. */
export type ModelFile = { from: 'build'; box: BBox } | { from: 'route'; key: string; box: BBox }

/** `route`: the route whose copper is on the Board view, and whether its route.json lists a model. */
export function modelFile(build: BBox, route: { key: string; box: BBox; glb: boolean } | null): ModelFile {
  return route?.glb ? { from: 'route', key: route.key, box: route.box } : { from: 'build', box: build }
}

/**
 * What the 3D view has to say of its model beyond the route card and the band, which are over every view and say whose
 * copper it is: only where 3D is not the board the Board view draws. `boardRoute`: the route whose copper that is.
 */
export function modelNote(file: ModelFile, boardRoute: string | null, routing: RoutingState | null | undefined): string | null {
  if (!boardRoute) return null
  if (file.from === 'build') return 'This route has no 3D model, so 3D lacks its tracks. Ask Claude to route again.'
  // A stale route is shown faded over the newer build's parts, which a model exported with the route cannot do.
  return routing?.state === 'current' ? null : `3D is the board as route r${routing?.number} had it: its parts may stand elsewhere on the Board view.`
}
