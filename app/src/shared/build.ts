// The build as the engine reports it (pino.build/1, kernel/schema/build-result-1.schema.json), and the state of the
// build loop that main tells the window. Field names are the engine's, in its spelling.

export type Verdict = 'ok' | 'errors' | 'failed'
export type Severity = 'error' | 'warning' | 'info'

/** A place: board millimetres (outline centre, y up), sheet millimetres (top left, y down) or a file and line. */
export interface FindingAt {
  space: 'board' | 'sheet' | 'source'
  x?: number
  y?: number
  layer?: string
  file?: string
  line?: number
}

export interface Finding {
  source: string
  code: string
  severity: Severity
  message: string
  at?: FindingAt
  refs?: string[]
  pins?: string[]
  nets?: string[]
}

/** The state of the routed copper against the latest build (the engine's routing stage; serve 2). */
export interface RoutingState {
  state: 'none' | 'running' | 'current' | 'stale'
  key: string
  /** The folder of the route whose copper there is to draw, from the project folder. */
  route: string | null
  route_key: string | null
  number: number | null
  stale_because: string[]
  complete: boolean | null
  unrouted: number | null
  router_share: number | null
  router_seconds: number | null
  drc_errors: number | null
  copper_errors: number | null
  verdict: string | null
}

export const ARTIFACTS = ['board', 'filled', 'schematic_svg', 'sheet', 'circuit', 'placement', 'glb', 'drc'] as const
export type ArtifactName = (typeof ARTIFACTS)[number]

export interface BuildCounts {
  errors: number
  warnings: number
  infos: number
  parts: number
  nets: number
  unrouted: number
  crossings: number
}

export interface BuildResult {
  schema: 'pino.build/1'
  kernel_version: string
  kicad_cli: string | null
  number: number
  hash: string | null
  verdict: Verdict
  headline: string
  counts: BuildCounts
  findings: Finding[]
  truncated: number
  artifacts: Partial<Record<ArtifactName, string>> & Record<string, unknown>
  timings: Array<{ step: string; seconds: number; cached?: boolean }>
  changes: { circuit: string[]; layout: string[] }
  placement: { score: number; crossings: number; length_mm: number } | null
  waiting: string[]
  cached: boolean
  routing?: RoutingState | null
}

/** The fields the engine's schema requires, in its order. */
export const REQUIRED_FIELDS = [
  'schema', 'kernel_version', 'kicad_cli', 'number', 'hash', 'verdict', 'headline', 'counts', 'findings', 'truncated',
  'artifacts', 'timings', 'changes', 'placement', 'waiting', 'cached'
] as const

type Rec = Record<string, unknown>
export const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString)
const orNull = (v: unknown, test: (v: unknown) => boolean) => v === null || test(v)

const isFinding = (v: unknown): v is Finding =>
  isRecord(v) && isString(v.source) && isString(v.code) && isString(v.message) && ['error', 'warning', 'info'].includes(v.severity as string)

const COUNTS = ['errors', 'warnings', 'infos', 'parts', 'nets', 'unrouted', 'crossings']

/** The value as a build result, or null when it is not a pino.build/1 one. Fields a later engine adds are kept. */
export function buildResultOf(value: unknown): BuildResult | null {
  if (!isRecord(value) || value.schema !== 'pino.build/1') return null
  const v = value
  const ok =
    isString(v.kernel_version) &&
    orNull(v.kicad_cli, isString) &&
    isNumber(v.number) &&
    orNull(v.hash, isString) &&
    ['ok', 'errors', 'failed'].includes(v.verdict as string) &&
    isString(v.headline) &&
    isRecord(v.counts) && COUNTS.every((k) => isNumber((v.counts as Rec)[k])) &&
    Array.isArray(v.findings) && v.findings.every(isFinding) &&
    isNumber(v.truncated) &&
    isRecord(v.artifacts) &&
    Array.isArray(v.timings) && v.timings.every((t) => isRecord(t) && isString(t.step) && isNumber(t.seconds)) &&
    isRecord(v.changes) && isStrings(v.changes.circuit) && isStrings(v.changes.layout) &&
    orNull(v.placement, isRecord) &&
    isStrings(v.waiting) &&
    typeof v.cached === 'boolean'
  return ok ? (value as unknown as BuildResult) : null
}

/** The headline as the route card's head says it: `On h4`, and what follows its colon. */
export function verdictWords(r: Pick<BuildResult, 'number' | 'headline'>): { on: string; rest: string } {
  const at = r.headline.indexOf(': ')
  return { on: `On h${r.number}`, rest: at < 0 ? r.headline : r.headline.slice(at + 2) }
}

export type EngineState = { state: 'starting' } | { state: 'ready'; kernel: string; serve: number } | { state: 'failed'; reason: string }

/** One build of the project, as the strip lists them. */
export interface BuildEntry {
  number: number
  hash: string | null
  verdict: Verdict | 'running'
  at: string
  /** Its folder is still there: the engine keeps the newest twenty. */
  kept: boolean
}

/** A route job at work. */
export interface RouteProgress {
  job: number
  step: string
  index: number
  of: number
  net?: string
  routed?: number
  startedAt: number
}

/** The build loop of the open project, as main tells it. */
export interface BuildState {
  projectId: string
  engine: EngineState
  building: boolean
  /** The newest result, failed ones included. */
  latest: BuildResult | null
  /** The newest result that drew something: what the views show. */
  lastGood: BuildResult | null
  history: BuildEntry[]
  route: RouteProgress | null
  /** The number of the build the newest build's copper is from, current or stale: the first one seen with it current. */
  copperFrom: number | null
  /** In plain words, why the views are not of the newest save. */
  problem: string | null
}
