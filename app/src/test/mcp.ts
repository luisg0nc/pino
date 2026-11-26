// An in-memory MCP client over pino's tools, for the tests of what they answer.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SERVER_INSTRUCTIONS } from '../main/mcp/schemas'
import { registerTools, type ToolDeps } from '../main/mcp/tools'

export async function toolsOver(deps: Partial<ToolDeps>, projectId = 'p1') {
  const server = new McpServer({ name: 'pino', version: '0' }, { instructions: SERVER_INSTRUCTIONS })
  registerTools(server, deps as ToolDeps, projectId)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  const result = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean }
  /** A tool's text. */
  const call = async (name: string, args: Record<string, unknown> = {}) => (await result(name, args)).content.map((c) => c.text ?? `<${c.type}>`).join('\n')
  return { client, call, result, list: async () => (await client.listTools()).tools }
}
