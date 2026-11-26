// What Claude sees: the picture of what the person sees, the checks, numbers from the board file, the nets, and what a
// build changed. Everything is in pino's board frame, and everything is capped (schemas.ts).

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Board } from '../../shared/board/board'
import { at, mm, toKicad } from '../../shared/board/coords'
import { measure, type Measure } from '../../shared/board/measure'
import { copperGroups, naturalCompare } from '../../shared/board/nets'
import { centreOf, netMembers, type Target } from '../../shared/board/refs'
import { verdictWords, type BuildResult, type Finding } from '../../shared/build'
import { checkRows, releaseFindings, withRouteFindings } from '../../shared/checks'
import type { Circuit } from '../../shared/circuit'
import type { LookRequest } from '../../shared/view'
import type { BuildModel } from '../model'
import { refused, text, type Reply } from './reply'
import { checkInput, DESCRIPTIONS, diffInput, lookInput, MAX_SIZE, measureInput, MIN_SIZE, MOST_LINES, netsInput, noInput, traceInput } from './schemas'
import { ALWAYS, type OnProject, type ToolDeps } from './tools'

const NOTHING_BUILT = 'Nothing has been built yet. pino builds board.py when it is saved.'
const NEAR_MM = 3

/** The board a tool reads: the routed one while its route is current. */
export const boardOf = (model: BuildModel): Board => (model.result.routing?.state === 'current' && model.routeBoard ? model.routeBoard : model.board)

/** How many letters two names are apart. */
function apart(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}

/** The names most like the one asked for: those that begin with its letters first. */
function nearest(asked: string, names: readonly string[]): string {
  const letters = /^[A-Za-z]*/.exec(asked)![0].toUpperCase()
  const score = (n: string) => (/^[A-Za-z]*/.exec(n)![0].toUpperCase() === letters ? 0 : 100) + apart(asked.toUpperCase(), n.toUpperCase())
  return [...names].sort((a, b) => score(a) - score(b) || naturalCompare(a, b)).slice(0, 3).join(', ')
}

const noNet = (board: Board, name: string) => ({ error: `No net ${name}. Nearest: ${nearest(name, board.nets)}` })

/** A thing by the name a person or Claude writes for it, or why there is none, with the nearest names. */
export function targetOfName(board: Board, circuit: Circuit | null, name: string): Target | { error: string } {
  const asked = name.trim()
  const parts = board.footprints.map((f) => f.ref)
  const netNames = [...new Set([...board.nets, ...(circuit?.nets.map((n) => n.name) ?? [])])]
  const kind = /^(net|track|via):(.+)$/.exec(asked)
  if (kind?.[1] === 'net') return netNames.includes(kind[2]) ? { kind: 'net', name: kind[2] } : { error: `No net ${kind[2]}. Nearest: ${nearest(kind[2], netNames)}` }
  if (kind) {
    const what = kind[1] as 'track' | 'via'
    const there = (what === 'track' ? board.tracks : board.vias).some((x) => x.uuid === kind[2])
    return there ? { kind: what, uuid: kind[2] } : { error: `No ${what} ${kind[2]} on this board.` }
  }
  if (parts.includes(asked)) return { kind: 'part', ref: asked }
  if (netNames.includes(asked)) return { kind: 'net', name: asked }
  const pad = /^([^.]+)\.(.+)$/.exec(asked)
  if (pad && parts.includes(pad[1])) {
    const numbers = [...new Set(board.footprints.find((f) => f.ref === pad[1])!.pads.map((p) => p.number).filter(Boolean))].sort(naturalCompare)
    return numbers.includes(pad[2]) ? { kind: 'pad', ref: pad[1], number: pad[2] } : { error: `${pad[1]} has no pad ${pad[2]}. Its pads: ${numbers.slice(0, 40).join(', ')}` }
  }
  return { error: `No part ${pad?.[1] ?? asked}. Nearest: ${nearest(pad?.[1] ?? asked, parts)}` }
}

/** At most MOST_LINES of a list, and the rest counted. */
function capped(lines: string[], more: (left: number) => string): string[] {
  return lines.length <= MOST_LINES ? lines : [...lines.slice(0, MOST_LINES), more(lines.length - MOST_LINES)]
}

export function findingLine(f: Finding): string {
  const place =
    f.at?.space === 'board' && f.at.x !== undefined
      ? `at ${at({ x: f.at.x, y: f.at.y! })} mm`
      : f.at?.space === 'sheet' && f.at.x !== undefined
        ? `sheet ${at({ x: f.at.x, y: f.at.y! })} mm`
        : f.at?.file
          ? `${f.at.file}${f.at.line ? ` line ${f.at.line}` : ''}`
          : null
  return [`[${f.severity}] ${f.source} ${f.code}`, f.message, place, f.refs?.length ? f.refs.join(', ') : null].filter(Boolean).join(' · ')
}

function isNear(f: Finding, board: Board, target: Target): boolean {
  if ((target.kind === 'part' || target.kind === 'pad') && f.refs?.includes(target.ref)) return true
  if (target.kind === 'net') return f.nets?.includes(target.name) ?? false
  const centre = centreOf(board, target)
  return !!centre && f.at?.space === 'board' && f.at.x !== undefined && Math.hypot(f.at.x - centre.x, f.at.y! - centre.y) <= NEAR_MM
}

const pinWords = (m: { ref: string; number: string; pin: string }) => `${m.ref}.${m.number}${m.pin ? ` ${m.pin}` : ''}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function netsAnswer(model: BuildModel, wanted: { net?: string; part?: string }): Reply {
  const board = boardOf(model)
  const circuit = model.circuit
  const kindOf = (name: string) => circuit?.nets.find((n) => n.name === name)?.kind ?? 'signal'
  if (wanted.net !== undefined) {
    const target = targetOfName(board, circuit, `net:${wanted.net}`)
    if ('error' in target) return refused(target.error)
    const members = netMembers(board, circuit, wanted.net)
    return text(`net ${wanted.net} (${kindOf(wanted.net)}), ${plural(members.length, 'pin')}: ${members.map(pinWords).join(', ')}`)
  }
  if (wanted.part !== undefined) {
    const part = circuit?.parts.find((p) => p.ref === wanted.part)
    if (!part) return refused(`No part ${wanted.part}. Nearest: ${nearest(wanted.part, circuit?.parts.map((p) => p.ref) ?? [])}`)
    const netOf = (number: string) => circuit!.nets.find((n) => n.pins.some(([r, p]) => r === part.ref && p === number))?.name ?? 'not connected'
    const lines = part.pins.map((p) => `${pinWords({ ref: part.ref, number: p.number, pin: p.name === '~' || p.name === p.number ? '' : p.name })}: ${netOf(p.number)}`)
    return text([`${part.ref} ${part.value}, ${plural(part.pins.length, 'pin')}:`, ...lines].join('\n'))
  }
  const all = (circuit?.nets.map((n) => n.name) ?? board.nets).slice().sort(naturalCompare)
  return text(all.map((name) => `${name} (${kindOf(name)}): ${plural(netMembers(board, circuit, name).length, 'pin')}`).join('\n'))
}

function traceAnswer(model: BuildModel, pin: string): Reply {
  const board = boardOf(model)
  const target = targetOfName(board, model.circuit, pin)
  if ('error' in target) return refused(target.error)
  if (target.kind !== 'pad') return refused('trace follows a pin: write it as U1.3.')
  const name = model.circuit?.nets.find((n) => n.pins.some(([r, p]) => r === target.ref && p === target.number))?.name ?? board.footprints.find((f) => f.ref === target.ref)?.pads.find((p) => p.number === target.number)?.net
  const label = (ref: string, number: string) => {
    const found = model.circuit?.parts.find((p) => p.ref === ref)?.pins.find((p) => p.number === number)?.name ?? ''
    return pinWords({ ref, number, pin: found === '~' || found === number ? '' : found })
  }
  if (!name) return text(`${label(target.ref, target.number)} is not connected to any net.`)
  const members = netMembers(board, model.circuit, name)
  const others = members.filter((m) => !(m.ref === target.ref && m.number === target.number))
  const groups = copperGroups(board, name).filter((g) => g.pads.length)
  const said = groups.map((g) => {
    if (g.pads.length === 1) return `${g.pads[0]} not joined yet`
    const by = g.tracks || g.vias ? [g.tracks && plural(g.tracks, 'track'), g.vias && plural(g.vias, 'via')].filter(Boolean).join(', ') : 'a pour'
    return `${g.pads.join(', ')} joined by ${by}`
  })
  return text(
    [
      `${label(target.ref, target.number)} is on net ${name} with ${plural(others.length, 'other pin')}: ${others.map(pinWords).join(', ') || 'none'}.`,
      `${plural(groups.length, 'group')}: ${said.join('; ')}.`
    ].join('\n')
  )
}

function ratsnestAnswer(model: BuildModel): Reply {
  const board = boardOf(model)
  const score = model.result.placement
  if (!score) return refused('This build has no placement score.')
  /** The pad of the net nearest a point of the ratsnest. */
  const padAt = (net: string, point: [number, number]) => {
    const where = toKicad({ x: point[0], y: point[1] })
    const pads = board.footprints.flatMap((f) => f.pads.filter((p) => p.net === net).map((p) => ({ name: `${f.ref}.${p.number}`, away: Math.hypot(p.center.x - where.x, p.center.y - where.y) })))
    return pads.sort((a, b) => a.away - b.away)[0]?.name ?? at({ x: point[0], y: point[1] })
  }
  const lines = [...(model.placement?.edges ?? [])]
    .sort((a, b) => naturalCompare(a[0], b[0]))
    .map(([net, a, b]) => `${net}: ${padAt(net, a)} to ${padAt(net, b)}, ${mm(Math.hypot(a[0] - b[0], a[1] - b[1]))} mm`)
  return text(
    [`Placement of h${model.result.number}: score ${score.score}, ${score.crossings} crossings, ${score.length_mm} mm of open connections.`, ...capped(lines, (left) => `and ${left} more open connections`)].join('\n')
  )
}

function measureOf(board: Board, circuit: Circuit | null, input: { what: Measure['what']; a?: string; b?: string; net?: string; layer?: string }): Measure | { error: string } {
  const named = (name: string) => targetOfName(board, circuit, name)
  const net = (name: string) => (board.nets.includes(name) || circuit?.nets.some((n) => n.name === name) ? name : noNet(board, name))
  const { what } = input
  const article = what === 'area' || what === 'edge' ? 'An' : 'A'
  if (what === 'gap' || what === 'distance') {
    if (!input.a || !input.b) return { error: `${article} ${what} is between two things: give a and b.` }
    const [a, b] = [named(input.a), named(input.b)]
    if ('error' in a) return a
    if ('error' in b) return b
    return { what, a, b }
  }
  if (what === 'edge') {
    if (!input.a) return { error: 'An edge distance is of one thing: give a.' }
    const a = named(input.a)
    return 'error' in a ? a : { what, a }
  }
  if (what === 'vias' && !input.net) return { what }
  if (!input.net) return { error: `${article} ${what} is of a net: give net.` }
  const found = net(input.net)
  if (typeof found !== 'string') return found
  return what === 'area' ? { what, net: found, ...(input.layer ? { layer: input.layer } : {}) } : { what, net: found }
}

export function registerReadTools(server: McpServer, deps: ToolDeps, onProject: OnProject): void {
  /** Runs a tool on the newest drawn build. */
  const onBuild = (run: (model: BuildModel) => Reply | Promise<Reply>) =>
    onProject(async (project) => {
      const model = await deps.model(project)
      return model ? run(model) : refused(NOTHING_BUILT)
    })

  server.registerTool('look', { description: DESCRIPTIONS.look, inputSchema: lookInput, _meta: ALWAYS }, (input) =>
    onProject(async (project) => {
      const size = input.size ?? undefined
      if (size !== undefined && (size < MIN_SIZE || size > MAX_SIZE)) return refused(`size is the long edge in pixels, from ${MIN_SIZE} to ${MAX_SIZE}.`)
      const request: LookRequest = { ...input, marks: input.marks ?? true, ...(size !== undefined ? { size } : {}) }
      try {
        const picture = await deps.look(project, request)
        deps.looked(project.id)
        return { content: [{ type: 'image', data: picture.png, mimeType: 'image/png' }, { type: 'text', text: picture.said }] }
      } catch (e) {
        return refused(`No picture: ${(e as Error).message}`)
      }
    })
  )

  server.registerTool('check', { description: DESCRIPTIONS.check, inputSchema: checkInput, _meta: ALWAYS }, (input) =>
    onProject(async (project) => {
      const latest: BuildResult | null = deps.state(project.id)?.latest ?? null
      if (!latest) return refused(NOTHING_BUILT)
      const model = await deps.model(project)
      const routed = withRouteFindings(latest, model?.routeFindings ?? null)
      const released = releaseFindings(deps.fab?.state(project.id) ?? null, latest)
      const result = released.length ? { ...routed, findings: [...routed.findings, ...released] } : routed
      let found = result.findings
      if (input.source) found = found.filter((f) => f.source === input.source)
      if (input.severity) found = found.filter((f) => f.severity === input.severity)
      if (input.near) {
        if (!model) return refused(NOTHING_BUILT)
        const target = targetOfName(boardOf(model), model.circuit, input.near)
        if ('error' in target) return refused(target.error)
        found = found.filter((f) => isNear(f, boardOf(model), target))
      }
      deps.looked(project.id)
      const rows = checkRows(result).map((row) => `${row.label}: ${row.word === 'skipped' ? 'not run' : row.word}`)
      const lines = capped(found.map(findingLine), (left) => `and ${left} more: narrow with source or near`)
      const truncated = latest.truncated ? `The engine left out ${latest.truncated} findings past its first 200.` : null
      return text([`${verdictWords(latest).on}: ${verdictWords(latest).rest}`, ...rows, ...(lines.length ? lines : ['No finding matches.']), truncated].filter(Boolean).join('\n'))
    })
  )

  server.registerTool('measure', { description: DESCRIPTIONS.measure, inputSchema: measureInput, _meta: ALWAYS }, (input) =>
    onBuild((model) => {
      const board = boardOf(model)
      const asked = measureOf(board, model.circuit, input)
      if ('error' in asked) return refused(asked.error)
      const route = board === model.routeBoard && model.result.routing ? ` (route r${model.result.routing.number})` : ''
      return text(`${measure(board, asked).said}. From the board file of h${model.result.number}${route}.`)
    })
  )

  server.registerTool('nets', { description: DESCRIPTIONS.nets, inputSchema: netsInput, _meta: ALWAYS }, (input) => onBuild((model) => netsAnswer(model, input)))
  server.registerTool('trace', { description: DESCRIPTIONS.trace, inputSchema: traceInput }, (input) => onBuild((model) => traceAnswer(model, input.pin)))
  server.registerTool('ratsnest', { description: DESCRIPTIONS.ratsnest, inputSchema: noInput }, () => onBuild(ratsnestAnswer))

  server.registerTool('diff', { description: DESCRIPTIONS.diff, inputSchema: diffInput }, (input) =>
    onProject(async (project) => {
      const drawn = (deps.state(project.id)?.history ?? []).filter((e) => e.hash !== null)
      if (!drawn.length) return refused(NOTHING_BUILT)
      const to = input.to === undefined ? drawn.at(-1)! : drawn.find((e) => e.number === input.to)
      if (!to) return refused(`There is no build h${input.to}.`)
      const before = drawn.filter((e) => e.number < to.number).at(-1)
      const from = input.from === undefined ? before : drawn.find((e) => e.number === input.from)
      if (!from) return refused(input.from === undefined ? `There is only h${to.number}: nothing to compare it with.` : `There is no build h${input.from}.`)
      let changes: { circuit: string[]; layout: string[] }
      if (from.hash === to.hash) {
        // One board built twice: what the later build says changed is since an older one (the engine's history).
        changes = { circuit: [], layout: [] }
      } else if (from.number === before?.number) {
        // A build keeps what changed since the one before it.
        const model = await deps.model(project)
        changes = model && model.result.hash === to.hash ? model.result.changes : (await deps.buildResult(project, to.hash!)).changes
      } else {
        const gone = [from, to].find((e) => !e.kept)
        if (gone) return refused(`h${gone.number} is no longer kept.`)
        changes = await deps.diff(project, from.hash!, to.hash!)
      }
      const lines = [...changes.circuit, ...changes.layout]
      return text([`From h${from.number} to h${to.number}:`, ...(lines.length ? capped(lines, (left) => `and ${left} more changes`) : ['nothing changed'])].join('\n'))
    })
  )
}
