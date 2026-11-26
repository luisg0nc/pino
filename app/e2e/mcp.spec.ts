import { existsSync, readdirSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
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

// A new project: Claude asks for the fab's limits and looks parts up before it writes board.py, so no build has started
// an engine. There is nothing to route yet, and it is told so.
test('in a project with no board, project gives the default fab limits, parts answers and route says what is missing', async () => {
  const dir = tempProject()
  const { app, page } = await launch({ project: dir, env: { FAKE_KERNEL_SERVE: '3' } })
  try {
    await expect.poll(() => page.evaluate(() => window.__pinoTest!.state().project?.id ?? '')).not.toBe('')
    const id = await page.evaluate(() => window.__pinoTest!.state().project!.id)
    const { url, token } = await app.evaluate((_main, projectId) => (globalThis as unknown as { __pinoMain: { mcpFor(i: string): { url: string; token: string } } }).__pinoMain.mcpFor(projectId), id)
    const call = (name: string, args: Record<string, unknown>) => post(url, { 'X-Pino-Session': token }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
    expect((await call('route', { action: 'start' })).body).toContain('No built board yet: routing works on a built board.')
    const limits = await call('project', {})
    expect(limits.body).toContain("these are the default fab's limits")
    expect(limits.body).toContain('Fab: JLC standard 2-layer.')
    const said = await call('parts', { lcsc: 'C25804' })
    expect(said.body).toContain('C25804 · basic')
    expect(said.body).not.toContain('"isError":true')
    // No call wrote anything: what may be there is the Brief on screen keeping what was seen of it.
    const there = existsSync(join(dir, '.pino')) ? readdirSync(join(dir, '.pino')) : []
    expect(there.filter((name) => name !== 'brief' && name !== '.gitignore')).toEqual([])
    expect(existsSync(join(dir, '.pino', 'brief', 'cards.json'))).toBe(false)
  } finally {
    await app.close()
  }
})
