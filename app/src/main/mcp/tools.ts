// The tools of the MCP server an agent working on a project is given: the one list of them, and what they need of
// pino. Those that read are in readTools.ts, the marks' in markTools.ts, routing's in routeTools.ts, JLC's parts in
// partsTools.ts, the Brief's cards in cardTools.ts.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { verdictWords, type BuildResult, type BuildState } from '../../shared/build'
import type { CardTurn } from '../../shared/cards'
import type { PromptRow } from '../../shared/chat'
import type { CardStore } from '../cards/store'
import { defaultFabNote, FAB_STILL_FETCHING, fabLine, fabUnknown, type FabProfile } from '../../shared/fab'
import type { ProjectInfo } from '../../shared/project'
import type { LookRequest, LookResult } from '../../shared/view'
import type { Fab } from '../fab'
import type { MarkStore } from '../marks/store'
import type { BuildModel } from '../model'
import type { Routing } from '../routing'
import { registerCardTools } from './cardTools'
import { registerMarkTools } from './markTools'
import { registerPartsTools } from './partsTools'
import { registerReadTools } from './readTools'
import { refused, text, type Reply } from './reply'
import { registerRouteTools } from './routeTools'
import { noInput, PROJECT_DESCRIPTION } from './schemas'

/** What the tools need of pino. */
export interface ToolDeps {
  /** The project with this id, if it is the one open. */
  project(id: string): ProjectInfo | undefined
  /** The build loop of the project. */
  state(projectId: string): BuildState | undefined
  /** The newest build that drew something, read. */
  model(project: ProjectInfo): Promise<BuildModel | null>
  /** The result of the build with this hash. */
  buildResult(project: ProjectInfo, hash: string): Promise<BuildResult>
  /** The engine's account of what changed between two builds it still keeps. */
  diff(project: ProjectInfo, from: string, to: string): Promise<{ circuit: string[]; layout: string[] }>
  /** A picture from the window. */
  look(project: ProjectInfo, request: LookRequest): Promise<LookResult>
  /** The project's marks: Claude reads them, adds its own and resolves what it has done. */
  marks: Pick<MarkStore, 'list' | 'add' | 'resolve'>
  /** The router in the background, and its trials. */
  routing: Pick<Routing, 'refusal' | 'start' | 'cancel' | 'progress' | 'lastWords' | 'trial'>
  /** Claude has looked at the build, or at its checks. */
  looked(projectId: string): void
  /** Parts at JLC, and the release's state. */
  fab: Pick<Fab, 'parts' | 'lookup' | 'state' | 'defaultFab'>
  /** The cards of the project's Brief: Claude reads them all and changes its own. */
  cards: Pick<CardStore, 'read' | 'agent'>
  /** The prompt the project's session is answering, which a card of Claude's is stamped with. */
  turnNow(projectId: string): CardTurn | undefined
  /** The project's prompts, numbered, as its chat logs hold them. */
  prompts(project: ProjectInfo): Promise<PromptRow[]>
  /** The limits of the fab the newest drawn board is built for. */
  fabProfile(project: ProjectInfo): Promise<FabProfile | null>
  /** How long `project` waits for the default fab's limits; `FAB_WAIT_MS` where none is said. */
  fabWaitMs?: number
}

/** `project` is called first, and an engine's first start under uv may take minutes: it is not waited for longer. */
const FAB_WAIT_MS = 5_000

/** Runs a tool on the open project, or says there is none. */
export type OnProject = (run: (project: ProjectInfo) => Reply | Promise<Reply>) => Promise<Reply>

export const ALWAYS = { 'anthropic/alwaysLoad': true } as const

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * The limits of the fab, for Claude: the one the drawn board is built for. With no board.py there is none yet, and the
 * choices are being made: the default's are given, said to be the default's, or why they are not known.
 */
async function fabWords(deps: ToolDeps, project: ProjectInfo): Promise<string | null> {
  const built = (await deps.fabProfile?.(project).catch(() => null)) ?? null
  if (built) return fabLine(built)
  if (isFile(join(project.dir, 'board.py'))) return null
  const asked = deps.fab.defaultFab().then(
    ({ profile, profiles }) => `${defaultFabNote(profile, profiles)}\n${fabLine(profile)}`,
    (e: Error) => fabUnknown(e.message)
  )
  // What is asked goes on when it is not waited for: the next call joins it.
  let timer: NodeJS.Timeout | undefined
  const slow = new Promise<string>((done) => (timer = setTimeout(() => done(FAB_STILL_FETCHING), deps.fabWaitMs ?? FAB_WAIT_MS)))
  return Promise.race([asked, slow]).finally(() => clearTimeout(timer))
}

export function registerTools(server: McpServer, deps: ToolDeps, projectId: string): void {
  const onProject: OnProject = async (run) => {
    const project = deps.project(projectId)
    if (!project) return refused(`No project ${projectId} is open in pino.`)
    try {
      return await run(project)
    } catch (e) {
      return refused((e as Error).message)
    }
  }

  server.registerTool('project', { description: PROJECT_DESCRIPTION, inputSchema: noInput, _meta: ALWAYS }, () =>
    onProject(async (project) => {
      const there = (name: string): string => `${name}: ${isFile(join(project.dir, name)) ? 'present' : 'absent'}`
      const latest = deps.state(project.id)?.latest
      const build = latest ? `The newest build: ${verdictWords(latest).on}: ${verdictWords(latest).rest}.` : 'Nothing has been built yet.'
      // The limits come before any choice: Claude offers nothing the fab cannot build.
      const limits = await fabWords(deps, project)
      return text([`Project ${project.name} in ${project.dir}. ${there('board.py')}. ${there('brief.md')}. ${build}`, limits].filter(Boolean).join('\n'))
    })
  )

  registerReadTools(server, deps, onProject)
  registerMarkTools(server, deps, onProject)
  registerRouteTools(server, deps, onProject)
  registerPartsTools(server, deps, onProject)
  registerCardTools(server, deps, onProject)
}
