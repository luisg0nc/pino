import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { ProjectInfo } from '../../shared/project'
import { PROJECT_DESCRIPTION } from './schemas'

/** What the tools need of pino. */
export interface ToolDeps {
  /** The project with this id, if it is the one open. */
  project(id: string): ProjectInfo | undefined
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** The tools of the MCP server an agent working on this project is given. */
export function registerTools(server: McpServer, deps: ToolDeps, projectId: string): void {
  server.registerTool(
    'project',
    { description: PROJECT_DESCRIPTION, inputSchema: z.strictObject({}), _meta: { 'anthropic/alwaysLoad': true } },
    () => {
      const project = deps.project(projectId)
      if (!project) return { content: [{ type: 'text', text: `No project ${projectId} is open in pino.` }], isError: true }
      const there = (name: string): string => `${name}: ${isFile(join(project.dir, name)) ? 'present' : 'absent'}`
      return {
        content: [{ type: 'text', text: `Project ${project.name} in ${project.dir}. ${there('board.py')}. ${there('brief.md')}. pino has no engine yet: nothing is built or drawn.` }]
      }
    }
  )
}
