// Routing as Claude asks for it.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { refused } from './reply'
import { DESCRIPTIONS, keepInput, nudgeInput, routeInput, routeNetInput } from './schemas'
import { ALWAYS, type OnProject, type ToolDeps } from './tools'

export function registerRouteTools(server: McpServer, _deps: ToolDeps, onProject: OnProject): void {
  const notYet = () => onProject(() => refused('Not yet.'))
  server.registerTool('route', { description: DESCRIPTIONS.route, inputSchema: routeInput, _meta: ALWAYS }, notYet)
  server.registerTool('route_net', { description: DESCRIPTIONS.route_net, inputSchema: routeNetInput }, notYet)
  server.registerTool('nudge', { description: DESCRIPTIONS.nudge, inputSchema: nudgeInput }, notYet)
  server.registerTool('keep', { description: DESCRIPTIONS.keep, inputSchema: keepInput }, notYet)
}
