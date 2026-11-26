// A build as main reads it: its board, circuit, placement and sheet, and the board of its route. Read once for a build
// and a route, and kept for the last few, for the marks and for Claude's tools.

import { readBoard, type Board } from '../shared/board/board'
import type { ArtifactName, BuildResult } from '../shared/build'
import { circuitOf, placementOf, type Circuit, type Placement } from '../shared/circuit'
import type { ProjectInfo } from '../shared/project'
import { sheetOf, type Sheet } from '../shared/sheet'
import { readArtifact, readRouteFile } from './artifacts'

export interface BuildModel {
  result: BuildResult
  /** The build's board, its zones filled when kicad-cli filled them. */
  board: Board
  /** The board of the route that is current or stale for this build, when there is one. */
  routeBoard: Board | null
  circuit: Circuit | null
  placement: Placement | null
  sheet: Sheet | null
}

const KEPT = 3

type Read = Omit<BuildModel, 'result'>

async function read(p: ProjectInfo, r: BuildResult): Promise<Read> {
  const hash = r.hash!
  const text = (name: ArtifactName) => readArtifact(p, hash, name, r).then(String)
  const json = async <T>(name: ArtifactName, of: (v: unknown) => T | null): Promise<T | null> => (r.artifacts[name] ? text(name).then((t) => of(JSON.parse(t))).catch(() => null) : null)
  const [board, circuit, placement, sheet] = await Promise.all([
    text(r.artifacts.filled ? 'filled' : 'board').then(readBoard),
    json('circuit', circuitOf),
    json('placement', placementOf),
    json('sheet', sheetOf)
  ])
  const key = r.routing?.route_key
  const routeBoard = key ? await readRouteFile(p, key, 'filled').then(readBoard, () => null) : null
  return { board, routeBoard, circuit, placement, sheet }
}

export class Models {
  private readonly cache = new Map<string, Promise<Read>>()

  /** The build as read from its folder, or null when it drew nothing or can no longer be read. */
  async get(p: ProjectInfo, r: BuildResult): Promise<BuildModel | null> {
    if (!r.hash) return null
    const key = `${p.id}|${r.hash}|${r.routing?.state ?? ''}|${r.routing?.route_key ?? ''}`
    let held = this.cache.get(key)
    if (!held) {
      held = read(p, r)
      this.cache.set(key, held)
      held.catch(() => this.cache.delete(key))
      while (this.cache.size > KEPT) this.cache.delete(this.cache.keys().next().value!)
    }
    try {
      return { ...(await held), result: r }
    } catch {
      return null
    }
  }
}
