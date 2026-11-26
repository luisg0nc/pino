import { describe, expect, it } from 'vitest'
import type { RoutingState } from './build'
import { modelFile, modelNote } from './model3d'

const BUILT = { x0: 85, y0: 87.5, x1: 115, y1: 112.5 }
const ROUTED = { x0: 90, y0: 90, x1: 110, y1: 110 }
const KEY = 'cccccccc00000001'
const routing = (state: RoutingState['state']) => ({ state, route_key: KEY, number: 2 }) as RoutingState

describe('which model the 3D view loads', () => {
  it("takes the route's whenever the board's copper is a route's, framed on the board it was exported from", () => {
    expect(modelFile(BUILT, { key: KEY, box: ROUTED, glb: true })).toEqual({ from: 'route', key: KEY, box: ROUTED })
  })

  it("takes the build's when the board has no route's copper", () => {
    expect(modelFile(BUILT, null)).toEqual({ from: 'build', box: BUILT })
  })

  it("takes the build's when the route has no model", () => {
    expect(modelFile(BUILT, { key: KEY, box: ROUTED, glb: false })).toEqual({ from: 'build', box: BUILT })
  })
})

describe('what the 3D view says of its model', () => {
  const route = modelFile(BUILT, { key: KEY, box: ROUTED, glb: true })
  const build = modelFile(BUILT, null)

  it('says nothing more while both views are of the same board: the route card and the band say whose copper it is', () => {
    expect(modelNote(route, KEY, routing('current'))).toBeNull()
    expect(modelNote(build, null, routing('none'))).toBeNull()
    expect(modelNote(build, null, null)).toBeNull()
  })

  it('says that a stale route is shown as it was routed, parts included', () => {
    const said = '3D is the board as route r2 had it: its parts may stand elsewhere on the Board view.'
    expect(modelNote(route, KEY, routing('stale'))).toBe(said)
    expect(modelNote(route, KEY, routing('running'))).toBe(said)
  })

  it('says why the routed tracks are missing when the route has no model, and what to do', () => {
    expect(modelNote(build, KEY, routing('current'))).toBe('This route has no 3D model, so 3D lacks its tracks. Ask Claude to route again.')
  })
})
