// A build's findings as the route card's rows, and the few numbers the card says of a build. The check tool tells
// Claude the same rows, so the person and Claude read one account.

import type { Board } from './board/board'
import { mm } from './board/coords'
import { naturalCompare, trackLength } from './board/nets'
import type { BuildResult, Finding, RoutingState } from './build'
import type { Circuit, Placement } from './circuit'

export interface CheckRow {
  label: string
  /** Indexes into the result's findings. */
  findings: number[]
  errors: number
  warnings: number
  infos: number
  word: 'pass' | 'warn' | 'fail' | 'note' | 'skipped'
}

interface RowRule {
  label: string
  sources: string[]
  /** Which of the sources' findings are this row's, by code. */
  codes?: RegExp
  /** Not shown while it has nothing to say. */
  quiet?: boolean
  /** kicad-cli's step that this check is, when it is one. */
  step?: string
}

const PARITY = /^parity_/

export const CHECK_ROWS: ReadonlyArray<RowRule> = [
  { label: 'Electrical rules', sources: ['erc'], step: 'erc' },
  { label: 'Connections, by part and pin', sources: ['netlist', 'expect', 'pads'] },
  { label: 'Board matches the schematic', sources: ['drc'], codes: PARITY, step: 'drc' },
  { label: 'Design rules', sources: ['drc'], codes: /^(?!parity_)/, step: 'drc' },
  { label: 'Courtyards, fit in outline', sources: ['courtyard', 'fit'] },
  { label: 'Placement', sources: ['placement'] },
  { label: 'Reads left to right', sources: ['lint'] },
  { label: 'Copper', sources: ['copper'] },
  { label: 'Routing', sources: ['route', 'router'] },
  { label: '3D models', sources: ['model3d'], quiet: true },
  { label: 'Engine', sources: ['kernel', 'board.py'], quiet: true }
]

const ENGINE = CHECK_ROWS.length - 1

/** The row a finding is in: one from a source no row names is the engine's, so that none is left out. */
function rowOf(f: Finding): number {
  const at = CHECK_ROWS.findIndex((r) => r.sources.includes(f.source) && (!r.codes || r.codes.test(f.code)))
  return at < 0 ? ENGINE : at
}

/** Whether the build left a check out: it failed, kicad-cli was missing or failed at its step, or nothing is routed. */
function skipped(r: BuildResult, rule: RowRule): boolean {
  if (r.verdict === 'failed') return true
  if (rule.label === 'Copper' || rule.label === 'Routing') return !r.routing || r.routing.state === 'none'
  if (!rule.step) return false
  return r.findings.some((f) => f.source === 'kernel' && (f.code === 'kicad_cli_missing' || (f.code === 'kicad_cli_failed' && f.message.includes(`kicad-cli ${rule.step} failed`))))
}

export function checkRows(r: BuildResult): CheckRow[] {
  const held: number[][] = CHECK_ROWS.map(() => [])
  r.findings.forEach((f, i) => held[rowOf(f)].push(i))
  return CHECK_ROWS.flatMap((rule, at) => {
    const findings = held[at]
    if (rule.quiet && !findings.length) return []
    const count = (severity: Finding['severity']) => findings.filter((i) => r.findings[i].severity === severity).length
    const [errors, warnings, infos] = [count('error'), count('warning'), count('info')]
    const word: CheckRow['word'] = skipped(r, rule) && !errors ? 'skipped' : errors ? 'fail' : warnings ? 'warn' : infos ? 'note' : 'pass'
    return [{ label: rule.label, findings, errors, warnings, infos, word }]
  })
}

/** `9, 1 fail, 2 warn`: the checks that ran, and those with a word against them. */
export function checksSummary(rows: readonly CheckRow[]): string {
  const ran = rows.filter((r) => r.word !== 'skipped')
  const count = (word: CheckRow['word']) => ran.filter((r) => r.word === word).length
  return [String(ran.length), count('fail') && `${count('fail')} fail`, count('warn') && `${count('warn')} warn`].filter(Boolean).join(', ')
}

const sorted = (names: Iterable<string>): string[] => [...new Set(names)].sort(naturalCompare)

/** The nets with open connections: those a current route left, else every net the ratsnest still draws. */
export function openNets(r: BuildResult, placement: Placement | null, routeFindings: Finding[] | null): string[] {
  if (r.routing?.state === 'current' && routeFindings) return sorted(routeFindings.filter((f) => f.code === 'net_unrouted').flatMap((f) => f.nets ?? []))
  return sorted((placement?.edges ?? []).map(([net]) => net))
}

export interface Gauge {
  /** The nets there are to route: those with two pins or more. */
  total: number
  done: number
  state: 'open' | 'routed' | 'stale'
}

export function netGauge(circuit: Circuit | null, open: readonly string[], routing: RoutingState | null): Gauge {
  const total = (circuit?.nets ?? []).filter((n) => n.pins.length > 1).length
  if (routing?.state === 'stale') return { total, done: Math.max(0, total - (routing.unrouted ?? 0)), state: 'stale' }
  if (routing?.state !== 'current') return { total, done: 0, state: 'open' }
  return { total, done: Math.max(0, total - open.length), state: 'routed' }
}

export interface BoardFacts {
  size: string
  layers: number
  parts: number
  nets: number
  /** `312 mm, 42`: the copper's length and the vias, once there is copper. */
  copper: string | null
}

export function boardFacts(board: Board, r: BuildResult): BoardFacts {
  const { x0, y0, x1, y1 } = board.box
  const side = (v: number) => mm(v).replace(/0$/, '')
  const length = board.tracks.reduce((sum, t) => sum + trackLength(t), 0)
  return {
    size: `${side(x1 - x0)} × ${side(y1 - y0)} mm`,
    layers: board.copper.length,
    parts: r.counts.parts,
    nets: r.counts.nets,
    copper: board.tracks.length ? `${Math.round(length)} mm, ${board.vias.length}` : null
  }
}

/** The seconds this build's own steps took: what came from the cache is not counted again. */
export function buildSeconds(r: BuildResult): number {
  return Math.round(r.timings.filter((t) => !t.cached).reduce((sum, t) => sum + t.seconds, 0) * 10) / 10
}

/** Whether the checks by part and pin found this net as the board file says it. */
export function netVerdict(r: BuildResult, net: string): 'pass' | 'fail' | 'skipped' {
  if (r.verdict === 'failed') return 'skipped'
  const wrong = r.findings.some((f) => (f.source === 'netlist' || f.source === 'expect') && f.severity === 'error' && f.nets?.includes(net))
  return wrong ? 'fail' : 'pass'
}

/** What the engine says waits, as a sentence for the card's head. */
export function waitingWords(waiting: readonly string[]): string {
  return waiting.map((w) => (w === 'routing: not started' ? 'Not routed yet.' : `${w.charAt(0).toUpperCase()}${w.slice(1)}.`)).join(' ')
}
