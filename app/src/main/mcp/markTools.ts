// Claude's side of the marks.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { refused } from './reply'
import { DESCRIPTIONS, marksInput, pointInput, resolveInput } from './schemas'
import { ALWAYS, type OnProject, type ToolDeps } from './tools'

export function registerMarkTools(server: McpServer, _deps: ToolDeps, onProject: OnProject): void {
  const notYet = () => onProject(() => refused('Not yet.'))
  server.registerTool('point', { description: DESCRIPTIONS.point, inputSchema: pointInput, _meta: ALWAYS }, notYet)
  server.registerTool('marks', { description: DESCRIPTIONS.marks, inputSchema: marksInput, _meta: ALWAYS }, notYet)
  server.registerTool('resolve_mark', { description: DESCRIPTIONS.resolve_mark, inputSchema: resolveInput, _meta: ALWAYS }, notYet)
}
