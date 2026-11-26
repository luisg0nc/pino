import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { SERVER_INSTRUCTIONS } from './mcp/schemas'
import { registerTools, type ToolDeps } from './mcp/tools'
import { toolName } from '../shared/app'
import { systemPrompt } from './prompt'

// What a turn costs, held so that it only grows on purpose. Measured from the code, never with the real agent.

async function listed() {
  const server = new McpServer({ name: 'pino', version: '0' }, { instructions: SERVER_INSTRUCTIONS })
  registerTools(server, {} as ToolDeps, 'x')
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(a), client.connect(b)])
  return (await client.listTools()).tools
}

describe('what a turn costs', () => {
  it('the tools loaded up front are [project], in at most 33,000 characters of name, description and schema', async () => {
    const tools = await listed()
    const loaded = tools.filter((t) => (t._meta as Record<string, unknown> | undefined)?.['anthropic/alwaysLoad'] === true)
    expect(loaded.map((t) => t.name).sort()).toEqual(['project'])
    const chars = loaded.reduce((sum, t) => sum + JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length, 0)
    expect(chars).toBeLessThan(33_000)
    expect(tools).toHaveLength(1)
  })

  it("the text pino adds to the system prompt, with its server's instructions, is under 12,000 characters", () => {
    const sent = systemPrompt(toolName)
    expect(sent).toContain('mcp__pino__project')
    expect(sent.length + SERVER_INSTRUCTIONS.length).toBeLessThan(12_000)
  })
})
