import { request } from 'node:http'
import { expect, test } from '@playwright/test'
import { launch, tempProject } from './launch'

function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, (res) => {
      let text = ''
      res.on('data', (chunk) => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }))
    })
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}

test('the MCP address answers 404 without the token, 403 to a request from a web page, and lists project with it', async () => {
  const { app, page } = await launch({ project: tempProject() })
  try {
    await expect.poll(() => page.evaluate(() => window.__pinoTest!.state().project?.id ?? '')).not.toBe('')
    const id = await page.evaluate(() => window.__pinoTest!.state().project!.id)
    const { url, token } = await app.evaluate((_main, projectId) => (globalThis as unknown as { __pinoMain: { mcpFor(i: string): { url: string; token: string } } }).__pinoMain.mcpFor(projectId), id)
    expect(url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/mcp/${id}$`))
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
    expect((await post(url, {}, list)).status).toBe(404)
    expect((await post(url, { 'X-Pino-Session': 'not-the-token' }, list)).status).toBe(404)
    expect((await post(url, { 'X-Pino-Session': token, origin: 'https://example.com' }, list)).status).toBe(403)
    const listed = await post(url, { 'X-Pino-Session': token }, list)
    expect(listed.status).toBe(200)
    expect(listed.body).toContain('"name":"project"')
  } finally {
    await app.close()
  }
})
