// The session manager against the real HTTP server, the real MCP mount and the stand-in agent. Never the real CLI.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toolName } from '../../shared/app'
import type { ChatItem } from '../../shared/chat'
import type { ProjectInfo } from '../../shared/project'
import { type HttpRouter, SESSION_HEADER, startHttp } from '../http'
import { mountMcp } from '../mcp/server'
import type { ToolDeps } from '../mcp/tools'
import { onNotOwn } from '../own'
import { systemPrompt } from '../prompt'
import { Trust } from '../trust'
import { claudeAdapter } from './claude'
import { NO_DOMAIN, type SessionDomain } from './domain'
import { Sessions, type StartResult } from './manager'
import { KnownModels } from './models'

const FAKE = resolve(__dirname, '../../../test/fake-agent.mjs')
const NOT_FOUND = 'Claude Code was not found on PATH. Install it, or start pino from a terminal where claude runs.'

let root: string
let home: string
let project: ProjectInfo
let configDir: string
let http: HttpRouter
let trust: Trust
/** The pids of the agents started, and the tokens made for them. */
let pids: number[]
let tokens: string[]
/** Processes a test had an agent start: ended by pid should the test leave one behind. */
const strays: number[] = []
const made: Sessions[] = []

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pino-sessions-')))
  home = join(root, 'home')
  configDir = join(root, 'config', 'agent')
  const dir = join(home, 'boards', 'blinky board')
  mkdirSync(dir, { recursive: true })
  project = { id: 'p0123456789ab', dir, name: 'blinky board' }
  http = await startHttp()
  const fab = { defaultFab: () => Promise.reject(new Error('there is no engine in this test')) }
  mountMcp(http, { project: (id: string) => (id === project.id ? project : undefined), state: () => undefined, fab } as unknown as ToolDeps)
  const grant = http.grant.bind(http)
  tokens = []
  http.grant = (paths) => {
    const token = grant(paths)
    tokens.push(token)
    return token
  }
  trust = new Trust(null, home)
  pids = []
})

afterEach(async () => {
  await Promise.all(made.splice(0).map((s) => s.stopAll()))
  for (const pid of strays.splice(0)) if (alive(pid)) process.kill(pid, 'SIGKILL')
  onNotOwn(null)
  await http.close()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

function manager(opts: { agent?: string; domain?: SessionDomain; env?: Record<string, string> } = {}): Sessions {
  const adapter = claudeAdapter(opts.agent ?? `node ${FAKE}`)
  const chat = adapter.chat
  adapter.chat = (run) => {
    const transport = chat(run)
    pids.push((transport as unknown as { pid: number }).pid)
    return transport
  }
  const sessions = new Sessions({ http, adapter, configDir, env: { ...process.env, ...opts.env }, domain: opts.domain ?? NO_DOMAIN, trust, models: new KnownModels(null), systemPrompt: systemPrompt(toolName) })
  made.push(sessions)
  return sessions
}

async function started(sessions: Sessions, opts: { resume?: boolean } = {}): Promise<string> {
  const result: StartResult = await sessions.start(project, opts)
  if ('refused' in result) throw new Error(`refused: ${result.refused}`)
  return result.sessionId
}

const items = (sessions: Sessions, id: string): ChatItem[] => sessions.history(id)?.items ?? []
const of = <K extends ChatItem['kind']>(sessions: Sessions, id: string, kind: K): Array<Extract<ChatItem, { kind: K }>> =>
  items(sessions, id).filter((i): i is Extract<ChatItem, { kind: K }> => i.kind === kind)
const until = <T>(check: () => T, timeout = 8000): Promise<T> => vi.waitFor(check, { timeout, interval: 20 })
/** A prompt sent, and the end of the turn it makes. */
async function turn(sessions: Sessions, id: string, text: string): Promise<void> {
  const before = of(sessions, id, 'turn').length
  await sessions.send(id, { text })
  await until(() => expect(of(sessions, id, 'turn').length).toBe(before + 1))
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    // A process that has ended and waits to be reaped is not running.
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return false
  }
}

/** Every file and folder under the project, with when it was last written. */
const tree = (dir: string): Map<string, number> => new Map(readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((path) => [path, statSync(join(dir, path)).mtimeMs]))

async function mcpStatus(token: string): Promise<number> {
  const reply = await fetch(http.url(`/mcp/${project.id}`), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', [SESSION_HEADER]: token }, body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', params: {}, id: 1 }) })
  await reply.text()
  return reply.status
}

describe('Sessions', () => {
  it('starts Claude Code in the project folder, the token in its environment only', async () => {
    const sessions = manager()
    const id = await started(sessions)
    const mcpFile = join(configDir, `${id}.mcp.json`)
    expect(readFileSync(mcpFile, 'utf8')).not.toContain(tokens[0])
    expect(statSync(mcpFile).mode & 0o777).toBe(0o600)
    expect(readFileSync(`/proc/${pids[0]}/cmdline`, 'utf8')).not.toContain(tokens[0])
    expect(realpathSync(`/proc/${pids[0]}/cwd`)).toBe(project.dir)
    await turn(sessions, id, 'argv')
    const argv = of(sessions, id, 'text')[0].text
    expect(argv).toContain('--mcp-config')
    expect(argv).not.toContain(tokens[0])
    expect(await mcpStatus(tokens[0])).toBe(200)
    await sessions.stop(id)
    expect(existsSync(mcpFile)).toBe(false)
  })

  it('gives one session to a project, however often it is asked while one starts or runs', async () => {
    const sessions = manager()
    const [a, b] = await Promise.all([sessions.start(project), sessions.start(project)])
    expect(b).toEqual(a)
    expect(await sessions.start(project)).toMatchObject({ sessionId: (a as { sessionId: string }).sessionId })
    expect(pids).toHaveLength(1)
    expect(sessions.current(project.id)).toMatchObject({ sessionId: (a as { sessionId: string }).sessionId })
    expect(sessions.current('pother')).toBeNull()
  })

  it('a prompt is answered, and the status goes working then idle', async () => {
    const sessions = manager()
    const seen: string[] = []
    sessions.on('status', (m) => seen.push(m.status))
    const id = await started(sessions)
    await turn(sessions, id, 'say hello')
    expect(of(sessions, id, 'text')[0].text).toBe('hello')
    await until(() => expect(sessions.current(project.id)?.status).toBe('idle'))
    expect(seen.slice(seen.indexOf('working'))).toEqual(['working', 'idle'])
    expect(of(sessions, id, 'note').filter((n) => n.tone === 'warn')).toEqual([])
  })

  it('tells the window of items, the meta and what the CLI can do, and stops telling one that unsubscribed', async () => {
    const sessions = manager()
    const told: string[] = []
    const off = sessions.on('item', (m) => told.push(m.item.kind))
    const capabilities: string[][] = []
    sessions.on('capabilities', (m) => capabilities.push(m.models.map((x) => x.value)))
    const id = await started(sessions)
    await turn(sessions, id, 'say hello')
    expect(told).toContain('text')
    expect(capabilities).toEqual([['default', 'haiku']])
    expect(sessions.history(id)?.commands.map((c) => c.name)).toEqual(['compact', 'clear'])
    expect(sessions.history(id)?.meta.appConnected).toBe(true)
    off()
    told.length = 0
    await turn(sessions, id, 'say again')
    expect(told).toEqual([])
  })

  it("calls pino's one tool through the real MCP server", async () => {
    const sessions = manager()
    const id = await started(sessions)
    await turn(sessions, id, 'tool mcp__pino__project {}')
    const [tool] = of(sessions, id, 'tool')
    expect(tool).toMatchObject({ own: true, state: 'done' })
    expect(tool.result).toContain(`Project ${project.name} in ${project.dir}.`)
  })

  it("adds the domain's context to a prompt and takes its Stop answer", async () => {
    const prompts: string[] = []
    let stops = 0
    const answering: string[][] = []
    const domain: SessionDomain = {
      promptContext: async (of_, prompt) => {
        prompts.push(`${of_.id} ${prompt}`)
        return { text: 'CTX', sentMarkIds: [] }
      },
      stopAnswer: async (_project, turn) => {
        answering.push([...turn])
        return ++stops === 1 ? { decision: 'block', reason: 'KEEP GOING' } : null
      }
    }
    const sessions = manager({ domain })
    const id = await started(sessions)
    await turn(sessions, id, 'say hello')
    expect(prompts).toEqual([`${project.id} say hello`])
    expect(of(sessions, id, 'context')).toMatchObject([{ text: 'CTX', marks: [] }])
    expect(stops).toBe(2)
    // The Stop is answered for the prompts of the turn that ends, which is how a build of Claude's is told as its.
    const [asked] = of(sessions, id, 'user')
    expect(answering).toEqual([[asked.id], [asked.id]])
  })

  it("puts the marks the domain sent on the prompt's context item, and calls delivered once the hook is answered", async () => {
    const delivered: string[] = []
    const domain: SessionDomain = {
      promptContext: async () => ({ text: 'M1 pad U2.1', sentMarkIds: ['M1'], delivered: async () => void delivered.push('M1') }),
      stopAnswer: async () => null
    }
    const sessions = manager({ domain })
    const id = await started(sessions)
    await turn(sessions, id, 'say hello')
    expect(of(sessions, id, 'context')).toMatchObject([{ text: 'M1 pad U2.1', marks: ['M1'] }])
    await expect.poll(() => delivered).toEqual(['M1'])
  })

  it('turnNow names the prompt the session is answering, and none between turns', async () => {
    const sessions = manager()
    const id = await started(sessions)
    expect(sessions.turnNow(project.id)).toBeUndefined()
    await sessions.send(id, { text: 'ask Bash {"command":"ls"}' })
    const ask = await until(() => {
      const [open] = of(sessions, id, 'ask')
      expect(open?.state).toBe('open')
      return open
    })
    // Waiting for the person is still the turn of that prompt.
    expect(sessions.turnNow(project.id)).toEqual({ prompt: of(sessions, id, 'user')[0].id, conversation: expect.any(String) })
    expect(sessions.turnNow('p-other')).toBeUndefined()
    sessions.answer(id, ask.requestId, { allow: true })
    await until(() => expect(sessions.current(project.id)?.status).toBe('idle'))
    expect(sessions.turnNow(project.id)).toBeUndefined()
  })

  describe("which saves of a turn are Claude's", () => {
    const file = (name = 'board.py') => join(project.dir, name)
    /** The prompt `n` of the chat as a save names it. */
    const promptOf = (sessions: Sessions, id: string, n = 0) => ({ turn: { prompt: of(sessions, id, 'user')[n].id, conversation: expect.any(String) } })
    const open = (sessions: Sessions, id: string) =>
      until(() => {
        const ask = of(sessions, id, 'ask').find((a) => a.state === 'open')
        expect(ask).toBeDefined()
        return ask!
      })
    const over = (sessions: Sessions, turns: number, id: string) => until(() => expect(of(sessions, id, 'turn')).toHaveLength(turns))

    it("is not one the person makes while the turn works, with a command that only reads under way", async () => {
      const sessions = manager()
      const id = await started(sessions)
      await sessions.send(id, { text: 'work 2' })
      await until(() => expect(of(sessions, id, 'tool')).toHaveLength(1))
      writeFileSync(file(), 'mine')
      expect(sessions.turnNow(project.id)).toBeDefined()
      expect(sessions.wroteBy(project.id, file())).toBeUndefined()
      await over(sessions, 1, id)
      expect(sessions.wroteBy(project.id, file())).toBeUndefined()
    })

    it('is one its Write or Edit made, with the prompt, until the person saves over it', async () => {
      const sessions = manager()
      const id = await started(sessions)
      await turn(sessions, id, 'write board.py claude\nwrite extra.py x\nedit extra.py x y')
      expect(sessions.wroteBy(project.id, file())).toEqual(promptOf(sessions, id))
      expect(sessions.wroteBy(project.id, file('extra.py'))).toEqual(promptOf(sessions, id))
      await new Promise((r) => setTimeout(r, 30))
      writeFileSync(file(), 'mine, after')
      expect(sessions.wroteBy(project.id, file())).toBeUndefined()
    })

    it('is one a command of its that may write made, and not one made while that command waited to be allowed', async () => {
      const sessions = manager()
      const id = await started(sessions)
      await sessions.send(id, { text: 'ask Bash {"command":"python gen.py"}' })
      const ask = await open(sessions, id)
      writeFileSync(file(), 'mine, while the card waits')
      expect(sessions.wroteBy(project.id, file())).toBeUndefined()
      // Further from the answer than the slack an mtime is given.
      await new Promise((r) => setTimeout(r, 50))
      sessions.answer(id, ask.requestId, { allow: true })
      await over(sessions, 1, id)
      expect(sessions.wroteBy(project.id, file())).toBeUndefined()
      await turn(sessions, id, 'bash printf generated > gen.py')
      await over(sessions, 2, id)
      expect(sessions.wroteBy(project.id, file('gen.py'))).toEqual(promptOf(sessions, id, 1))
    })

    it("is not one made after a command of its that failed ended, which only its result says", async () => {
      const sessions = manager()
      const id = await started(sessions)
      await sessions.send(id, { text: 'bash exit 1\nwork 2' })
      await until(() => expect(of(sessions, id, 'tool')).toHaveLength(2))
      await new Promise((r) => setTimeout(r, 50))
      writeFileSync(file(), 'mine')
      expect(sessions.wroteBy(project.id, file())).toBeUndefined()
    })

    it('is not one made after a request the person refused', async () => {
      const sessions = manager()
      const id = await started(sessions)
      await sessions.send(id, { text: `ask Edit ${JSON.stringify({ file_path: file(), old_string: 'a', new_string: 'b' })}\nwork 2` })
      sessions.answer(id, (await open(sessions, id)).requestId, { allow: false, message: '' })
      await until(() => expect(of(sessions, id, 'tool')).toHaveLength(2))
      writeFileSync(file(), 'mine')
      expect(sessions.wroteBy(project.id, file())).toBeUndefined()
    })

    it('is not one made after a Write of its that pino refused', async () => {
      const sessions = manager()
      const id = await started(sessions)
      await turn(sessions, id, 'write brief.md claude')
      writeFileSync(file('brief.md'), 'mine')
      expect(sessions.wroteBy(project.id, file('brief.md'))).toBeUndefined()
    })
  })

  it('sendBlocks sends text and pictures as one prompt', async () => {
    const sessions = manager()
    const id = await started(sessions)
    // A PNG's header, which is all the stand-in reads of a picture: 4 wide, 4 high.
    const png = Buffer.alloc(24)
    png.writeUInt32BE(4, 16)
    png.writeUInt32BE(4, 20)
    await sessions.sendBlocks(id, [
      { type: 'text', text: 'images' },
      { type: 'text', text: 'reference/photo-1.png:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }
    ])
    await until(() => expect(of(sessions, id, 'turn')).toHaveLength(1))
    expect(of(sessions, id, 'user')).toMatchObject([{ text: 'images', images: [expect.anything()] }])
    // The stand-in reads each line of a prompt as its script, so the caption is said back after its answer.
    expect(of(sessions, id, 'text').map((t) => t.text)).toContain('images: 1 4x4')
  })

  it('lets a prompt and a turn go on when the domain throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const throws = async (): Promise<never> => {
      throw new Error('no engine')
    }
    const sessions = manager({ domain: { promptContext: throws, stopAnswer: throws } })
    const id = await started(sessions)
    await turn(sessions, id, 'say hello')
    expect(of(sessions, id, 'text')[0].text).toBe('hello')
    expect(of(sessions, id, 'context')).toEqual([])
  })

  it('asks the person for a permission, and the answer reaches the agent', async () => {
    const sessions = manager()
    const id = await started(sessions)
    await sessions.send(id, { text: 'ask Bash {"command":"ls"}' })
    const ask = await until(() => {
      const [open] = of(sessions, id, 'ask')
      expect(open?.state).toBe('open')
      return open
    })
    expect(sessions.current(project.id)?.status).toBe('needs_input')
    sessions.answer(id, ask.requestId, { allow: true, updatedInput: { command: 'rm -rf /' } })
    await until(() => expect(of(sessions, id, 'turn')).toHaveLength(1))
    // The window may not change what the tool runs with.
    expect(of(sessions, id, 'tool')[0].result).toBe('allowed: {"command":"ls"}')
    await sessions.send(id, { text: 'ask Bash {"command":"ls"}' })
    const second = await until(() => {
      const open = of(sessions, id, 'ask').find((a) => a.state === 'open')
      expect(open).toBeDefined()
      return open!
    })
    sessions.answer(id, second.requestId, { allow: false, message: '' })
    await until(() => expect(of(sessions, id, 'turn')).toHaveLength(2))
    expect(of(sessions, id, 'tool')[1].result).toBe('denied: The person denied this.')
  })

  it('refuses a Write outside the project folder, and nothing is written there', async () => {
    const sessions = manager()
    const id = await started(sessions)
    await turn(sessions, id, 'write ../outside.txt x')
    expect(existsSync(join(project.dir, '..', 'outside.txt'))).toBe(false)
    const [tool] = of(sessions, id, 'tool')
    expect(tool.state).toBe('error')
    expect(tool.result).toContain(`works on the project in ${project.dir}`)
    await turn(sessions, id, 'write .pino/session.json x')
    expect(of(sessions, id, 'tool')[1].result).toContain('may not write under .pino/')
    await turn(sessions, id, 'write board.py x')
    expect(readFileSync(join(project.dir, 'board.py'), 'utf8')).toBe('x')
  })

  it('asks before the first chat in a folder with Claude Code settings of its own', async () => {
    mkdirSync(join(project.dir, '.claude'))
    writeFileSync(join(project.dir, '.claude', 'settings.json'), '{}')
    const sessions = manager()
    expect(await sessions.start(project)).toEqual({ refused: 'This folder has Claude Code settings of its own', question: { kind: 'trust', files: ['.claude/settings.json'] } })
    expect([pids, tokens, existsSync(configDir), existsSync(join(project.dir, '.pino'))]).toEqual([[], [], false, false])
    expect(sessions.current(project.id)).toBeNull()
    await trust.accept(project.dir)
    await started(sessions)
    expect(pids).toHaveLength(1)
  })

  it('says in plain words that Claude Code was not found, and starts nothing', async () => {
    for (const sessions of [manager({ agent: '/nonexistent/claude' }), manager({ agent: 'claude', env: { PATH: join(root, 'empty') } })]) {
      expect(await sessions.start(project)).toEqual({ refused: NOT_FOUND })
      expect(sessions.current(project.id)).toBeNull()
    }
    expect([pids, tokens, existsSync(configDir)]).toEqual([[], [], false])
  })

  it('stop ends the agent mid-turn, revokes its token and writes nothing after', async () => {
    const sessions = manager()
    const id = await started(sessions)
    await sessions.send(id, { text: 'slow 30' })
    await until(() => expect(of(sessions, id, 'text')).toHaveLength(1))
    expect(await mcpStatus(tokens[0])).toBe(200)
    await sessions.stop(id)
    await until(() => expect(alive(pids[0])).toBe(false), 5000)
    expect(await mcpStatus(tokens[0])).toBe(404)
    expect(sessions.current(project.id)).toBeNull()
    expect(items(sessions, id).at(-1)).toMatchObject({ kind: 'note', text: 'The session ended' })
    const after = tree(project.dir)
    await new Promise((done) => setTimeout(done, 1000))
    expect(tree(project.dir)).toEqual(after)
    await expect(sessions.send(id, { text: 'say more' })).rejects.toThrow('This session has ended')
  })

  it('ends what the agent started along with it, even an agent that will not leave', async () => {
    const wrapper = join(root, 'wrapper.sh')
    const child = join(root, 'child.pid')
    // A process of the agent's group that ignores the hangup, as a tool the agent runs might.
    writeFileSync(wrapper, `#!/bin/sh\nsh -c 'trap "" HUP TERM; exec sleep 60' >/dev/null 2>&1 &\necho $! > '${child}'\nexec node '${FAKE}' "$@"\n`)
    chmodSync(wrapper, 0o755)
    const environments: Record<string, string>[] = [{}, { FAKE_AGENT_STUBBORN: '1' }]
    for (const env of environments) {
      const sessions = manager({ agent: wrapper, env })
      const id = await started(sessions)
      await turn(sessions, id, 'say hello')
      const grandchild = Number(readFileSync(child, 'utf8'))
      strays.push(grandchild)
      expect(alive(grandchild)).toBe(true)
      await sessions.stop(id)
      await until(() => expect([alive(pids.at(-1)!), alive(grandchild)]).toEqual([false, false]), 6000)
    }
  }, 20_000)

  it('ends a session that is still starting when everything is stopped', async () => {
    const sessions = manager()
    expect(sessions.busy).toBe(false)
    const starting = sessions.start(project)
    expect(sessions.busy).toBe(true)
    await sessions.stopAll()
    await starting
    expect(sessions.busy).toBe(false)
    expect(sessions.current(project.id)).toBeNull()
    for (const pid of pids) await until(() => expect(alive(pid)).toBe(false), 5000)
    expect(tokens.length).toBe(pids.length)
    for (const token of tokens) expect(await mcpStatus(token)).toBe(404)
  })

  it('writes only under .pino: the chat log, the session file and .pino/.gitignore', async () => {
    writeFileSync(join(project.dir, 'brief.md'), 'a brief')
    const before = tree(project.dir)
    const sessions = manager()
    const id = await started(sessions)
    await turn(sessions, id, 'say hello')
    await sessions.stop(id)
    const after = tree(project.dir)
    const added = [...after.keys()].filter((path) => !before.has(path))
    expect(added.filter((path) => path !== '.pino' && !path.startsWith('.pino/'))).toEqual([])
    expect(added.sort()).toEqual(expect.arrayContaining(['.pino/.gitignore', '.pino/chat', '.pino/session.json']))
    expect(after.get('brief.md')).toBe(before.get('brief.md'))
    expect(readFileSync(join(project.dir, '.pino', '.gitignore'), 'utf8').split('\n').filter(Boolean).sort()).toEqual(['chat/', 'session.json'])
  })

  it('writes nothing through a .pino that is a link, says so once, and the chat still runs', async () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(project.dir, '.pino'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const told: string[] = []
    onNotOwn((_dir, message) => told.push(message))
    const sessions = manager()
    const id = await started(sessions)
    await turn(sessions, id, 'say hello')
    await turn(sessions, id, 'say again')
    await sessions.stop(id)
    expect(of(sessions, id, 'text').map((t) => t.text)).toEqual(['hello', 'again'])
    expect(readdirSync(outside)).toEqual([])
    expect(told).toEqual([expect.stringContaining('is a link')])
  })

  it('never keeps the token in the log or the transcript, though the agent says it', async () => {
    const sessions = manager()
    const id = await started(sessions)
    await turn(sessions, id, `say my token is ${tokens[0]}`)
    await sessions.stop(id)
    expect(JSON.stringify(items(sessions, id))).not.toContain(tokens[0])
    const [log] = readdirSync(join(project.dir, '.pino', 'chat'))
    expect(readFileSync(join(project.dir, '.pino', 'chat', log), 'utf8')).not.toContain(tokens[0])
  })

  it('resumes the stored conversation with --resume', async () => {
    const sessions = manager()
    expect(sessions.resumable(project)).toBe(false)
    const first = await started(sessions)
    await turn(sessions, first, 'say remember me')
    await sessions.stop(first)
    expect(sessions.resumable(project)).toBe(true)
    const conversation = (JSON.parse(readFileSync(join(project.dir, '.pino', 'session.json'), 'utf8')) as { conversationId: string }).conversationId
    const second = await started(sessions, { resume: true })
    await turn(sessions, second, 'argv')
    expect(of(sessions, second, 'text')[0].text).toContain(`"--resume","${conversation}"`)
    expect(sessions.history(second)!.earlier.map((i) => i.kind)).toEqual(['user', 'text', 'turn', 'note', 'note'])
    // Only the newest session of a project keeps its transcript.
    expect(sessions.history(first)).toBeUndefined()
  })

  it('stops a turn when asked, and takes the next prompt', async () => {
    const sessions = manager()
    const id = await started(sessions)
    await sessions.send(id, { text: 'slow 20' })
    await until(() => expect(of(sessions, id, 'text')).toHaveLength(1))
    await sessions.interrupt(id)
    await until(() => expect(of(sessions, id, 'turn')).toMatchObject([{ stopped: true }]))
    await turn(sessions, id, 'say on we go')
    expect(of(sessions, id, 'text').at(-1)!.text).toBe('on we go')
  })

  it('takes a model, an effort and a mode for the session, and refuses what is none', async () => {
    const sessions = manager()
    const id = await started(sessions)
    await sessions.setModel(id, 'haiku')
    await sessions.setEffort(id, 'high')
    await sessions.setMode(id, 'plan')
    expect(sessions.history(id)!.meta).toMatchObject({ effort: 'high', permissionMode: 'plan' })
    await turn(sessions, id, 'say hello')
    expect(sessions.history(id)!.meta.model).toBe('haiku')
    await expect(sessions.setModel(id, '--bare')).rejects.toThrow('not a model')
    await expect(sessions.setEffort(id, 'most' as never)).rejects.toThrow('not an effort')
    await expect(sessions.setMode(id, 'bypassPermissions' as never)).rejects.toThrow('not a mode')
  })

  it('answers 404 to a hook without the token, and its own MCP client works while it runs', async () => {
    const sessions = manager()
    const id = await started(sessions)
    const hook = await fetch(http.url(`/hooks/${id}/Stop`), { method: 'POST', body: '{}' })
    expect(hook.status).toBe(404)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(http.url(`/mcp/${project.id}`)), { requestInit: { headers: { [SESSION_HEADER]: tokens[0] } } }))
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('project')
    await client.close()
  })

  it('says what the CLI wrote when it leaves by itself, and that it did not start', async () => {
    const sessions = manager({ env: { FAKE_AGENT_FAIL: 'error: unknown option --effort' } })
    const id = await started(sessions)
    await until(() => expect(sessions.current(project.id)).toBeNull())
    await until(() => expect(of(sessions, id, 'note').map((n) => n.text)).toContain('The session ended'))
    const notes = of(sessions, id, 'note').map((n) => n.text)
    expect(notes).toContain('Claude Code stopped (exit code 1): error: unknown option --effort')
    expect(notes).toContain('It did not start: is `claude` up to date and signed in? Run `claude` in a terminal to see why.')
  })
})
