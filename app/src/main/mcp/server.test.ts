// pino's MCP server, through the real HTTP server and the SDK's own client.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProjectInfo } from '../../shared/project'
import { type HttpRouter, SESSION_HEADER, startHttp } from '../http'
import { mountMcp } from './server'
import type { ToolDeps } from './tools'

let http: HttpRouter
let root: string
let project: ProjectInfo
let token: string

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pino-mcp-')))
  const dir = join(root, 'blinky board')
  mkdirSync(dir)
  project = { id: 'p0123456789ab', dir, name: 'blinky board' }
  http = await startHttp()
  mountMcp(http, { project: (id: string) => (id === project.id ? project : undefined), state: () => undefined } as unknown as ToolDeps)
  token = http.grant([`/mcp/${project.id}`, '/mcp/pffffffffffff'])
})

afterAll(async () => {
  await http.close()
  rmSync(root, { recursive: true, force: true })
})

function raw(method: string, path: string, headers: Record<string, string>, body = '{}'): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: http.port, path, method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let text = ''
      res.on('data', (chunk) => (text += chunk))
      res.on('end', () => done({ status: res.statusCode ?? 0, body: text }))
    })
    req.on('error', fail)
    req.end(method === 'POST' ? body : undefined)
  })
}

async function connect(id = project.id): Promise<Client> {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(http.url(`/mcp/${id}`)), { requestInit: { headers: { [SESSION_HEADER]: token } } }))
  return client
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>): string => (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join('')

describe("pino's MCP server", () => {
  it("answers 404 without the project's token, and with a token of another project", async () => {
    const other = http.grant(['/mcp/pother0000000'])
    const without: Record<string, string>[] = [{}, { [SESSION_HEADER]: other }]
    for (const headers of without) {
      expect((await raw('POST', `/mcp/${project.id}`, headers)).status).toBe(404)
    }
  })

  it('answers 405 to GET, and 404 to a path that is not one project id', async () => {
    const mine = { [SESSION_HEADER]: token }
    expect((await raw('GET', `/mcp/${project.id}`, mine)).status).toBe(405)
    const below = await raw('POST', `/mcp/${project.id}/more`, mine)
    expect(below.status).toBe(404)
    expect(below.body).toContain('the id of a project')
  })

  it('answers 413 to a body over 4 MiB', async () => {
    const reply = await raw('POST', `/mcp/${project.id}`, { [SESSION_HEADER]: token }, JSON.stringify({ pad: 'x'.repeat(4 * 1024 * 1024) }))
    expect(reply.status).toBe(413)
  })

  it('lists its sixteen tools, project first, loaded up front', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(16)
    expect(tools[0].name).toBe('project')
    expect(tools[0]._meta?.['anthropic/alwaysLoad']).toBe(true)
    expect(client.getServerVersion()?.name).toBe('pino')
    await client.close()
  })

  it("calls project and gets the project's name and folder", async () => {
    const client = await connect()
    const bare = textOf(await client.callTool({ name: 'project', arguments: {} }))
    expect(bare).toBe(`Project blinky board in ${project.dir}. board.py: absent. brief.md: absent. Nothing has been built yet.`)
    writeFileSync(join(project.dir, 'board.py'), '')
    writeFileSync(join(project.dir, 'brief.md'), '')
    expect(textOf(await client.callTool({ name: 'project', arguments: {} }))).toContain('board.py: present. brief.md: present.')
    await client.close()
  })

  it('refuses an argument the tool does not have', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'project', arguments: { id: 'x' } }).catch((e: Error) => ({ isError: true, content: [{ type: 'text', text: e.message }] }))
    expect(result.isError).toBe(true)
    await client.close()
  })

  it('answers an id with no open project in words, as an error result', async () => {
    const client = await connect('pffffffffffff')
    const result = await client.callTool({ name: 'project', arguments: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('No project pffffffffffff is open in pino.')
    await client.close()
  })

  it('is served at the version of app/package.json', async () => {
    const { version } = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8')) as { version: string }
    const client = await connect()
    expect(client.getServerVersion()?.version).toBe(version)
    await client.close()
  })
})
