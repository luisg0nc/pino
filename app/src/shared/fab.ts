// Parts, the fab's limits and releases, as the engine reports them (pino.parts/1, pino.release/1 and a profile's
// to_json), and the plain words the window and Claude say about them. Field names are the engine's.

import type { Finding } from './build'

export interface FabAssembly {
  kind: string
  sides: number
  min_board: [number, number]
  max_board: [number, number]
  thickness: [number, number]
  smallest: string
  min_pitch: number
}

export interface FabProfile {
  name: string
  title: string
  layers: number
  min_track: number
  min_clearance: number
  min_via_drill: number
  min_via_diameter: number
  min_annular: number
  min_pth_annular: number
  min_hole: number
  min_npth: number
  hole_to_hole: number
  pad_hole_to_hole: number
  via_hole_to_track: number
  pth_to_track: number
  pad_to_pad: number
  copper_to_edge: number
  silk_min_width: number
  silk_min_text_height: number
  silk_to_pad: number
  board_thickness: number
  thicknesses: number[]
  copper_oz: number
  copper_options: number[]
  inner_copper_oz: number | null
  heavy_track: number
  assembly: FabAssembly
  source: string
  read_on: string
}

export interface PartInfo {
  lcsc: string
  mfr: string
  package: string
  description: string
  stock: number | null
  price: number | null
  class: 'basic' | 'preferred' | 'extended'
  checked_at: string | null
  fetched_at: string
}

export interface PartsResult {
  schema: 'pino.parts/1'
  kind: 'search' | 'get' | 'fetch' | 'refresh'
  query: Record<string, unknown>
  parts: PartInfo[]
  resolved: Array<{ lcsc: string; how: string | null; symbol: string | null; footprint: string | null; notes: string[] }>
  findings: Finding[]
  source: { url: string; fresh: boolean; fetched_at: string | null }
  headline: string
}

export interface PartsQuery {
  lcsc?: string
  search?: string
  package?: string
  basic?: boolean
  limit?: number
}

export interface Readiness {
  ready: boolean
  build: { number: number; hash: string } | null
  route: { number: number | null; key: string } | null
  blockers: Finding[]
  warnings: Finding[]
  next_version: string | null
  bump: string | null
  why: string[]
}

export type ReleaseState = 'released' | 'unchanged' | 'refused' | 'failed' | 'cancelled' | 'busy'

export interface ReleaseResult {
  schema: 'pino.release/1'
  kernel_version: string
  state: ReleaseState
  version: string | null
  previous: string | null
  bump: string | null
  why: string[]
  build: { number: number; hash: string } | null
  route: { number: number | null; key: string } | null
  folder: string | null
  files: Array<{ path: string; bytes: number; sha256: string }>
  counts: Record<string, number>
  findings: Finding[]
  truncated: number
  headline: string
  timings: Array<{ step: string; seconds: number; cached?: boolean }>
}

/** The release of the open project, as main tells the window. */
export interface FabState {
  projectId: string
  running: boolean
  step: string | null
  result: ReleaseResult | null
  readiness: Readiness | null
  error: string | null
}

// Why parts or fab files are refused, in words that say what is missing: Claude reads them and acts on them.
export const engineTooOld = (serve: number): string => `The engine is too old for parts and fab files: it speaks protocol ${serve}, and they need 3. Update pino's engine (its kernel/ folder).`
export const engineDidNotStart = (reason: string): string => `The engine did not start: ${reason}`
export const ENGINE_STARTING = 'The engine is starting. Try again in a moment.'
export const NO_BUILT_BOARD = 'No built board yet: fab files are made from a build. Save board.py and wait for it to build.'

/**
 * Said before the default fab's limits, which are given while there is no board.py to name one: which layers they are
 * for, and what a board of each other number the engine has a profile for gets (its first of those, as the engine
 * picks it).
 */
export function defaultFabNote(profile: FabProfile, profiles: readonly FabProfile[]): string {
  const others = profiles.filter((p, i) => p.layers !== profile.layers && profiles.findIndex((q) => q.layers === p.layers) === i)
  const gets = others.map((p) => `with layers=${p.layers} it gets ${p.title}`).join(', ')
  return `No board.py yet, so these are the default fab's limits: what a board that names no fab gets. That is for ${profile.layers} layers${gets ? `; ${gets}` : ''}.`
}
export const FAB_STILL_FETCHING = "The fab's limits are still being fetched, as the engine is slow to answer: call project again in a moment, before you offer any choice about layers, copper, holes or tracks."
export const fabUnknown = (why: string): string => `The fab's limits are not known: ${why}`

/** Two decimals at least, as the capability page writes small widths: 0.1 is 0.10, 0.125 stays. */
const fine = (v: number): string => (Math.abs(v * 100 - Math.round(v * 100)) < 1e-9 ? v.toFixed(2) : String(v))
/** At least one decimal: 1 mm is 1.0 mm. */
const one = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v))

const sides = (a: FabAssembly): string => (a.sides === 1 ? 'one side' : 'both sides')

const assemblyWords = (a: FabAssembly): string =>
  `${a.kind}, ${sides(a)}, ${a.smallest} and up, pitch ${a.min_pitch} mm and up, board ${a.min_board[0]} x ${a.min_board[1]} to ${a.max_board[0]} x ${a.max_board[1]} mm`

const tracks = (p: FabProfile): string => `${fine(Math.max(p.min_track, p.min_clearance))} mm or more (2 oz copper: ${fine(p.heavy_track)} mm)`

/** The fab's limits as the Brief lists them, each in plain words. */
export function fabRows(p: FabProfile): Array<{ label: string; value: string }> {
  const [thin, thick] = [Math.min(...p.thicknesses), Math.max(...p.thicknesses)]
  const most = Math.max(...p.copper_options)
  const a = p.assembly
  return [
    { label: 'Copper layers', value: String(p.layers) },
    { label: 'Board thickness', value: `${one(p.board_thickness)} mm (${one(thin)} to ${one(thick)} mm)` },
    {
      label: 'Copper weight',
      value: p.inner_copper_oz === null ? `${p.copper_oz} oz (up to ${most} oz)` : `${p.copper_oz} oz outside (up to ${most} oz), ${p.inner_copper_oz} oz inside`
    },
    { label: 'Tracks and gaps', value: tracks(p) },
    { label: 'Vias (a plated hole between layers)', value: `${p.min_via_drill} mm hole in ${p.min_via_diameter} mm` },
    { label: 'Annular ring (copper round a hole)', value: `vias ${p.min_annular} mm, plated pads ${p.min_pth_annular} mm or more` },
    { label: 'Holes', value: `plated ${p.min_hole} mm, unplated ${p.min_npth} mm or more` },
    { label: 'Copper to the board edge', value: `${p.copper_to_edge} mm or more` },
    { label: 'Silkscreen text', value: `${one(p.silk_min_text_height)} mm high, ${p.silk_min_width} mm lines` },
    { label: 'Assembly', value: `${a.kind}: ${assemblyWords(a).slice(a.kind.length + 2)}` }
  ]
}

/** The same limits in one line, for Claude's `project` answer. */
export function fabLine(p: FabProfile): string {
  const [thin, thick] = [Math.min(...p.thicknesses), Math.max(...p.thicknesses)]
  const most = Math.max(...p.copper_options)
  return (
    `Fab: ${p.title}. Tracks and gaps ${tracks(p)}; vias ${p.min_via_drill} mm hole in ${p.min_via_diameter} mm; holes ${p.min_hole} mm or more; ` +
    `copper ${p.copper_to_edge} mm from the edge; silkscreen text ${one(p.silk_min_text_height)} mm high. Board ${one(p.board_thickness)} mm (${one(thin)} to ${one(thick)}), ` +
    `${p.copper_oz} oz copper (up to ${most}). Assembly: ${assemblyWords(p.assembly)}.`
  )
}

/** The gates that say what to do, in the window's words; an unlisted gate says its own message. */
const GATES: Record<string, (message: string) => string> = {
  release_no_build: () => 'Build the board first: save board.py',
  release_build_failed: () => 'The last build failed: fix board.py first',
  release_build_stale: () => 'board.py changed since the last build: wait for the new build',
  release_build_unchecked: () => 'The last build ran without KiCad: build again with KiCad',
  release_not_routed: () => 'Route the board first',
  release_routing: () => 'A route is running: wait for it',
  release_stale: (m) => {
    const why = /\(([^)]*)\)/.exec(m)?.[1]
    return why ? `Copper is stale: ${why}. Route again` : 'Copper is stale. Route again'
  }
}

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
/** A part's finding, short: up to its colon, without the board.py line. */
const short = (m: string): string => m.replace(/ \(board\.py:\d+\)$/, '').split(': ')[0]

const SAID_AS_IS = new Set(['release_incomplete', 'release_drc', 'assembly_board_size'])

/** What stands in the way of a release, a short line each; the errors board.py must fix are counted together. */
export function readinessWords(r: Readiness): string[] {
  if (r.ready) return []
  const gates: string[] = []
  const rest: Finding[] = []
  for (const b of r.blockers) {
    if (GATES[b.code]) gates.push(GATES[b.code](b.message))
    else if (SAID_AS_IS.has(b.code)) gates.push(sentence(b.message))
    else rest.push(b)
  }
  if (!rest.length) return gates
  const shown = rest.slice(0, 3).map((f) => short(f.message))
  const count = `${rest.length} error${rest.length === 1 ? '' : 's'} to fix`
  return [...gates, `${count}: ${shown.join('; ')}${rest.length > 3 ? '; and more' : ''}`]
}
