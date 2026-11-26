// The build on show, read and parsed once: the board (with a route's copper, fresh or stale), the circuit and the
// placement. Every view draws from it, and keeps the last one while the next is being read.

import { useEffect, useMemo, useState } from 'react'
import { readBoard, type Board } from '../../shared/board/board'
import { withStaleCopper } from '../../shared/board/stale'
import type { BuildResult, Finding } from '../../shared/build'
import { withRouteFindings } from '../../shared/checks'
import { circuitOf, placementOf, type Circuit, type Placement } from '../../shared/circuit'
import { modelFile, type ModelFile } from '../../shared/model3d'
import { useStore } from './store'

export interface ViewModel {
  /** One build and one state of its routing: a new key is a new drawing. */
  key: string
  projectId: string
  result: BuildResult
  hash: string
  board: Board
  /** Uuids of a route's copper that no longer fits this board. */
  stale: Set<string>
  /** The key of the route whose copper is on the board, fresh or stale. */
  route: string | null
  /** Over a current route, the nets it left open; null while the placement's ratsnest is the whole of it. */
  open: Set<string> | null
  /** The build the route on the board was made of, by its hash. */
  routedBuild: string | null
  /** What the router and its checks said of the route on the board; `result` holds them too while it is current. */
  routeFindings: Finding[] | null
  /** The model 3D loads: the route's while its copper is on the board, else the build's. */
  model3d: ModelFile
  circuit: Circuit | null
  placement: Placement | null
}

// The route's number too: the same key routed again may bring a file that was not there, its model.
const keyOf = (projectId: string, r: BuildResult): string => `${projectId}|${r.hash}|${r.routing?.state ?? 'none'}|${r.routing?.route_key ?? ''}|${r.routing?.number ?? ''}`

const cache = new Map<string, Promise<ViewModel>>()
const KEPT = 4

async function json(text: Promise<string | Uint8Array>): Promise<unknown> {
  return JSON.parse(String(await text))
}

async function read(projectId: string, result: BuildResult, key: string): Promise<ViewModel> {
  const hash = result.hash!
  const file = (name: 'filled' | 'board' | 'circuit' | 'placement') => window.pino.build.file(projectId, hash, name)
  const [text, circuit, placement] = await Promise.all([
    file(result.artifacts.filled ? 'filled' : 'board'),
    result.artifacts.circuit ? json(file('circuit')).then(circuitOf, () => null) : null,
    result.artifacts.placement ? json(file('placement')).then(placementOf, () => null) : null
  ])
  const built = readBoard(String(text))
  const routing = result.routing
  let board = built
  let stale = new Set<string>()
  let open: Set<string> | null = null
  let route: string | null = null
  let routedBuild: string | null = null
  let routeFindings: Finding[] | null = null
  let model3d = modelFile(built.box, null)
  if (routing?.route_key && (routing.state === 'current' || routing.state === 'stale' || routing.state === 'running')) {
    const routed = await window.pino.build.routeFile(projectId, routing.route_key, 'filled').then((t) => readBoard(String(t)), () => null)
    if (routed) {
      route = routing.route_key
      const said = await window.pino.build.routeFile(projectId, routing.route_key, 'route').then(
        (t) => JSON.parse(String(t)) as { build?: string; findings?: Finding[]; artifacts?: { glb?: unknown } },
        () => null
      )
      routedBuild = said?.build ?? null
      routeFindings = said?.findings ?? null
      model3d = modelFile(built.box, { key: route, box: routed.box, glb: typeof said?.artifacts?.glb === 'string' })
      if (routing.state === 'current') {
        board = routed
        open = new Set((said?.findings ?? []).filter((f) => f.code === 'net_unrouted').flatMap((f) => f.nets ?? []))
      } else ({ board, stale } = withStaleCopper(built, routed))
    }
  }
  return { key, projectId, result: withRouteFindings(result, routeFindings), hash, board, stale, route, open, routedBuild, routeFindings, model3d, circuit, placement }
}

export function loadViewModel(projectId: string, result: BuildResult): Promise<ViewModel> {
  const key = keyOf(projectId, result)
  let held = cache.get(key)
  if (!held) {
    held = read(projectId, result, key)
    cache.set(key, held)
    held.catch(() => cache.delete(key))
    while (cache.size > KEPT) cache.delete(cache.keys().next().value!)
  }
  return held
}

export interface Shown {
  /** The build to draw, or null while there is none. */
  model: ViewModel | null
  /** Why the build to draw could not be read. */
  problem: string | null
}

/** The build the views show: the one chosen in the strip, else the newest that drew something. */
export function useViewModel(): Shown {
  const projectId = useStore((s) => s.project?.id ?? null)
  const shownNumber = useStore((s) => s.shown)
  const lastGood = useStore((s) => s.build?.lastGood ?? null)
  const olderHash = useStore((s) => (s.shown === null ? null : (s.build?.history.find((e) => e.number === s.shown)?.hash ?? null)))
  const [older, setOlder] = useState<BuildResult | null>(null)
  const [state, setState] = useState<Shown>({ model: null, problem: null })

  const wantsOlder = shownNumber !== null && shownNumber !== lastGood?.number
  useEffect(() => {
    setOlder(null)
    if (!wantsOlder || !projectId || !olderHash) return
    let here = true
    void window.pino.build.result(projectId, olderHash).then(
      (r) => here && setOlder({ ...r, number: shownNumber! }),
      (e: Error) => here && setState({ model: null, problem: e.message })
    )
    return () => {
      here = false
    }
  }, [projectId, olderHash, wantsOlder, shownNumber])

  const target = wantsOlder ? older : lastGood
  const key = projectId && target?.hash ? keyOf(projectId, target) : null
  useEffect(() => {
    if (!key || !projectId || !target) {
      if (!lastGood) setState({ model: null, problem: null })
      return
    }
    let here = true
    void loadViewModel(projectId, target).then(
      (model) => here && setState({ model, problem: null }),
      (e: Error) => here && setState((s) => ({ ...s, problem: e.message }))
    )
    return () => {
      here = false
    }
    // The key says which build and which routing: a result that is the same drawing is not read again.
  }, [key])

  // Of the project on show only: what was read for another is not this one's.
  const mine = state.model?.projectId === projectId ? state.model : null
  // The counts and findings are those of the result as it stands now (a cached build comes back with a new number).
  const model = useMemo(() => (mine && target && mine.key === key ? { ...mine, result: withRouteFindings(target, mine.routeFindings) } : mine), [mine, target, key])
  return { model, problem: state.problem }
}
