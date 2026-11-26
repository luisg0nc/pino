// Claude's `look`, asked of the real app through pino's own MCP server: each tab gives a picture, whichever tab the
// person is on, and what they see does not move. With PINO_SHOTS set, the pictures are written there to be looked at.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, referenceProject } from './launch'
import { markScene, waitForBuild } from './helpers'

const shots = process.env.PINO_SHOTS

test('look draws each tab at the size asked for, and leaves the window where it was', async () => {
  const { app, page } = await launch({ project: referenceProject() })
  try {
    await waitForBuild(page, 1)
    await markScene(page)
    const projectId = await page.evaluate(() => window.__pinoTest!.state().project!.id)
    const { url, token } = await app.evaluate(
      (_modules, id) =>(globalThis as unknown as { __pinoMain: { mcpFor(id: string): { url: string; token: string } } }).__pinoMain.mcpFor(id),
      projectId
    )
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { 'X-Pino-Session': token } } }))
    const look = async (args: Record<string, unknown>) => {
      const answer = (await client.callTool({ name: 'look', arguments: args })) as { isError?: boolean; content: Array<{ type: string; data?: string; text?: string }> }
      expect(answer.isError ?? false, answer.content.map((c) => c.text).join(' ')).toBe(false)
      const png = Buffer.from(answer.content[0].data!, 'base64')
      // A PNG says its width and height at bytes 16 and 20.
      return { png, width: png.readUInt32BE(16), height: png.readUInt32BE(20), said: answer.content[1].text! }
    }
    // Without a tab named, the one the person is on.
    await page.getByRole('tab', { name: 'Board', exact: true }).click()
    const before = await page.evaluate(() => window.__pinoTest!.state().tab)
    for (const [name, args, said] of [
      ['look-board', {}, /^Board tab, h1, top copper over bottom, the whole board, 5 marks drawn$/],
      ['look-window', { tab: 'board', window: { x0: -8, y0: -6, x1: 6, y1: 5 }, size: 800 }, /window x -8 to 6, y -6 to 5 mm/],
      ['look-sheet', { tab: 'schematic' }, /^Schematic tab, h1, the whole sheet, /],
      ['look-3d', { tab: '3d', size: 1000 }, /^3D tab, h1, /]
    ] as const) {
      const picture = await look(args)
      expect(picture.said).toMatch(said)
      expect(Math.max(picture.width, picture.height)).toBe((args as { size?: number }).size ?? 1280)
      // Not one flat colour: a drawing compresses far worse than an empty sheet of paper.
      expect(picture.png.length).toBeGreaterThan(15_000)
      if (shots) writeFileSync(join(shots, `${name}.png`), picture.png)
    }
    expect(await page.evaluate(() => window.__pinoTest!.state().tab)).toBe(before)
    const refused = (await client.callTool({ name: 'look', arguments: { layers: ['In9.Cu'] } })) as { isError?: boolean; content: Array<{ text?: string }> }
    expect(refused.content[0].text).toBe('No picture: This board has no copper layer In9.Cu. It has F.Cu, B.Cu.')
    await client.close()
  } finally {
    await app.close()
  }
})
