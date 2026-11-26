import { describe, expect, it } from 'vitest'
import { toolName } from '../shared/app'
import { toolsOver } from '../test/mcp'
import { CONTEXT_LIMIT, VERDICT_LIMIT } from './domain'
import { DEFAULT_SIZE, MAX_SIZE, MIN_SIZE, MOST_LINES, SERVER_INSTRUCTIONS, TOOL_TEXT_LIMIT } from './mcp/schemas'
import { systemPrompt } from './prompt'

// What a turn costs, held so that it only grows on purpose. Measured from the code, never with the real agent.

/** What a picture costs: one token for each 28 px square of it, counted by rows and columns. */
const pictureTokens = (width: number, height: number): number => Math.ceil(width / 28) * Math.ceil(height / 28)

const UP_FRONT = ['check', 'look', 'marks', 'measure', 'nets', 'point', 'project', 'resolve_mark', 'route']
const DEFERRED = ['trace', 'ratsnest', 'diff', 'route_net', 'nudge', 'keep']
const listed = async () => (await toolsOver({})).list()

describe('what a turn costs', () => {
  it('a picture costs by its area: the default look about 1,600 tokens at 4:3, the largest 3,900', () => {
    expect(pictureTokens(DEFAULT_SIZE, (DEFAULT_SIZE * 3) / 4)).toBe(1610)
    expect(pictureTokens(MAX_SIZE, (MAX_SIZE * 3) / 4)).toBe(3888)
    expect([MIN_SIZE, DEFAULT_SIZE, MAX_SIZE]).toEqual([400, 1280, 2000])
  })

  it('look returns one picture, so six looks are the most an answer carries under 10,000 tokens', () => {
    expect(6 * pictureTokens(DEFAULT_SIZE, (DEFAULT_SIZE * 3) / 4)).toBeLessThan(10_000)
  })

  it('the tools loaded up front are the nine the prompt relies on, in at most 33,000 characters', async () => {
    const tools = await listed()
    const loaded = tools.filter((t) => (t._meta as Record<string, unknown> | undefined)?.['anthropic/alwaysLoad'] === true)
    expect(loaded.map((t) => t.name).sort()).toEqual(UP_FRONT)
    const chars = loaded.reduce((sum, t) => sum + JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }).length, 0)
    expect(chars).toBeLessThan(33_000)
    expect(tools.map((t) => t.name).sort()).toEqual([...UP_FRONT, ...DEFERRED].sort())
    expect(tools).toHaveLength(15)
  })

  it('each tool says what it does in plain words, in under 700 characters', async () => {
    for (const tool of await listed()) {
      expect([tool.name, (tool.description ?? '').length > 20, (tool.description ?? '').length < 700]).toEqual([tool.name, true, true])
      expect([tool.name, tool.inputSchema.additionalProperties]).toEqual([tool.name, false])
    }
  })

  it('the system prompt with the server instructions is under 12,000 characters, and they name every tool', () => {
    expect(systemPrompt(toolName).length + SERVER_INSTRUCTIONS.length).toBeLessThan(12_000)
    for (const t of [...UP_FRONT, ...DEFERRED]) expect([t, SERVER_INSTRUCTIONS.includes(t)]).toEqual([t, true])
    for (const t of UP_FRONT) expect([t, systemPrompt(toolName).includes(toolName(t))]).toEqual([t, true])
  })

  it("a prompt's context, a verdict and a tool's text are capped", () => {
    expect([CONTEXT_LIMIT, VERDICT_LIMIT, TOOL_TEXT_LIMIT, MOST_LINES]).toEqual([6000, 1200, 8000, 40])
  })
})
