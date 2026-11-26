// Routing as Claude asks for it: the route in the background, and three trials that change nothing and answer with the
// lines for Claude to write into board.py.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isRecord, type BuildResult, type Finding, type RouteProgress } from '../../shared/build'
import type { ProjectInfo } from '../../shared/project'
import { findingLine } from './readTools'
import { refused, text, type Reply } from './reply'
import { DESCRIPTIONS, keepInput, MOST_LINES, nudgeInput, routeInput, routeNetInput } from './schemas'
import { ALWAYS, type OnProject, type ToolDeps } from './tools'

const NOTHING_BUILT = 'Nothing has been built yet. pino builds board.py when it is saved.'

function progressWords(p: RouteProgress, now: number): string {
  const how = p.of ? `net ${p.index} of ${p.of}${p.net ? ` (${p.net})` : ''}, step ${p.step}` : `step ${p.step}`
  return `Routing in the background: ${how}, ${Math.round((now - p.startedAt) / 1000)} s so far.`
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function stateWords(latest: BuildResult, open: string[], last: string | null): string {
  const routing = latest.routing!
  if (routing.state === 'stale') return `The copper of r${routing.number} no longer fits h${latest.number}: ${routing.stale_because.join(', ')}. Call route with start.`
  if (routing.state === 'running') return `A route of h${latest.number} is running.`
  if (routing.state === 'none') return `h${latest.number} is not routed. ${last ? `The last route: ${last.replace(/\.$/, '')}. ` : ''}Call route with start.`
  const left = routing.unrouted ? `${count(routing.unrouted, 'net')} left open` : 'every connection made'
  const share = routing.router_share !== null ? `, the router did ${Math.round(routing.router_share * 100)} %${routing.router_seconds !== null ? ` in ${routing.router_seconds} s` : ''}` : ''
  const said = `h${latest.number} is routed (route r${routing.number}): ${left}, ${count(routing.drc_errors ?? 0, 'DRC error')}${share}.`
  return open.length ? `${said} Open: ${open.join(', ')}.` : said
}

const valueWords = (v: unknown): string => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : typeof v === 'object' ? JSON.stringify(v) : String(v))
const facts = (of: unknown): string => (isRecord(of) ? Object.entries(of).map(([k, v]) => `${k} ${valueWords(v)}`).join(', ') : '')

/** A pino.trial/1 as Claude reads it: what it would do, what was found, and the lines to write. */
function trialAnswer(trial: unknown): Reply {
  if (!isRecord(trial) || typeof trial.headline !== 'string') return refused('The engine answered with something that is not a trial.')
  const findings = (Array.isArray(trial.findings) ? trial.findings : []) as Finding[]
  const left = Math.max(0, findings.length - MOST_LINES) + (typeof trial.truncated === 'number' ? trial.truncated : 0)
  const snippet = typeof trial.snippet === 'string' ? trial.snippet : ''
  const lines = [
    trial.headline,
    facts(trial.before) && `before: ${facts(trial.before)}`,
    facts(trial.after) && `after: ${facts(trial.after)}`,
    ...findings.slice(0, MOST_LINES).map(findingLine),
    left ? `and ${left} more findings` : '',
    // The lines come last and are never cut off by what came before them.
    snippet && `Write this into board.py:\n${snippet}`,
    snippet && typeof trial.replaces_line === 'number' ? `It replaces line ${trial.replaces_line}.` : ''
  ]
  return text(lines.filter(Boolean).join('\n'))
}

export function registerRouteTools(server: McpServer, deps: ToolDeps, onProject: OnProject): void {
  /** Runs a tool where there is a board to route and an engine that routes; else says which is missing. */
  const onRouting = (run: (project: ProjectInfo) => Promise<Reply>) =>
    onProject((project) => {
      const why = deps.routing.refusal(project.id)
      return why ? refused(why) : run(project)
    })

  server.registerTool('route', { description: DESCRIPTIONS.route, inputSchema: routeInput, _meta: ALWAYS }, (input) =>
    onRouting(async (project) => {
      if (input.action === 'cancel') return text((await deps.routing.cancel(project)) ? 'The route is cancelled.' : 'No route is running.')
      if (input.action === 'start') {
        const started = await deps.routing.start(project)
        if (!started.already) return text(`Routing h${started.build} started. It takes minutes; the view shows its progress. Call route with status to follow it.`)
        const progress = deps.routing.progress(project.id)
        return text(`A route is already running. ${progress ? progressWords(progress, Date.now()) : ''}`.trim())
      }
      const progress = deps.routing.progress(project.id)
      if (progress) return text(progressWords(progress, Date.now()))
      const latest = deps.state(project.id)?.latest
      if (!latest?.routing) return refused(latest ? `h${latest.number} has no board to route.` : NOTHING_BUILT)
      const found = latest.routing.state === 'current' ? ((await deps.model(project))?.routeFindings ?? []) : []
      const open = [...new Set(found.filter((f) => f.code === 'net_unrouted').flatMap((f) => f.nets ?? []))]
      return text(stateWords(latest, open, deps.routing.lastWords(project.id)))
    })
  )

  const trial = (op: 'route_net' | 'nudge' | 'keep') => (input: Record<string, unknown>) => onRouting(async (project) => trialAnswer(await deps.routing.trial(project, op, input)))
  server.registerTool('route_net', { description: DESCRIPTIONS.route_net, inputSchema: routeNetInput }, trial('route_net'))
  server.registerTool('nudge', { description: DESCRIPTIONS.nudge, inputSchema: nudgeInput }, trial('nudge'))
  server.registerTool('keep', { description: DESCRIPTIONS.keep, inputSchema: keepInput }, trial('keep'))
}
