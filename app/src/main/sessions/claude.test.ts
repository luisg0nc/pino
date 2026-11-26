import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeAdapter, HOOK_EVENTS, TESTED_CLAUDE } from './claude'

const ctx = {
  sessionId: 's1',
  conversationId: '0b1e5a52-6d0c-4f6e-9a55-2f4a3c1d9e10',
  resume: false,
  view: 'terminal' as const,
  cwd: '/boards/bracket',
  mcpUrl: 'http://127.0.0.1:4100/mcp/bracket',
  hookUrl: (event: string) => `http://127.0.0.1:4100/hooks/s1/${event}`,
  token: 'kQ2v7xT0pZ_session-token-of-forty-three-ch',
  configDir: '/srv/p/.config/pino/agent',
  systemPrompt: 'You are in pino.'
}

/** The http hook of an event, as pino registers it: the token comes from the environment, named in `allowedEnvVars`. */
const hookOf = (url: string) => ({
  type: 'http',
  url,
  timeout: 5,
  headers: { 'X-Pino-Session': '$PINO_SESSION' },
  allowedEnvVars: ['PINO_SESSION']
})

/** The value that follows a flag in an argument list. */
function after(args: string[], flag: string): string {
  const at = args.indexOf(flag)
  expect(at, flag).toBeGreaterThanOrEqual(0)
  return args[at + 1]
}

describe('the Claude Code adapter', () => {
  it("names pino's server and tools, and keeps the token out of every argument and file", () => {
    const run = claudeAdapter().launch(ctx)
    expect(run.env).toEqual({ PINO_SESSION: ctx.token })
    expect(run.args.join(' ')).not.toContain(ctx.token)
    expect(run.files[0].text).toContain('"X-Pino-Session": "${PINO_SESSION}"')
    expect(run.args).toContain('mcp__pino__*')
    expect(run.args).not.toContain('--agents')
  })

  it('starts on the model and effort chosen for the session, each as one argument with its value, and on the person\'s defaults without', () => {
    const chosen = claudeAdapter().launch({ ...ctx, model: 'opus', effort: 'xhigh' })
    expect(chosen.args).toContain('--model=opus')
    expect(chosen.args).toContain('--effort=xhigh')
    const plain = claudeAdapter().launch(ctx)
    expect(plain.args.some((a) => a.startsWith('--model') || a.startsWith('--effort'))).toBe(false)
  })

  it('launches a new conversation by its id', () => {
    const launch = claudeAdapter().launch(ctx)
    expect(launch.command).toBe('claude')
    expect(after(launch.args, '--session-id')).toBe(ctx.conversationId)
    expect(launch.args).not.toContain('--resume')
    expect(after(launch.args, '--allowedTools')).toBe('mcp__pino__*')
    expect(after(launch.args, '--append-system-prompt')).toBe('You are in pino.')
    expect(launch.args).not.toContain('--strict-mcp-config')
  })

  it('resumes a conversation by its id', () => {
    const launch = claudeAdapter().launch({ ...ctx, resume: true })
    expect(after(launch.args, '--resume')).toBe(ctx.conversationId)
    expect(launch.args).not.toContain('--session-id')
    expect(launch.args).not.toContain('--strict-mcp-config')
  })

  it("names pino's MCP server in a file of pino's own, by its URL, with the placeholder of the token and not the token", () => {
    const launch = claudeAdapter().launch(ctx)
    const path = after(launch.args, '--mcp-config')
    expect(path).toBe('/srv/p/.config/pino/agent/s1.mcp.json')
    expect(launch.files.map((file) => file.path)).toEqual([path])
    const text = launch.files[0].text
    expect(JSON.parse(text)).toEqual({ mcpServers: { pino: { type: 'http', url: ctx.mcpUrl, headers: { 'X-Pino-Session': '${PINO_SESSION}' } } } })
    expect(text).not.toContain(ctx.token)
  })

  // Whatever is on a command line every user of the machine can read (`/proc/<pid>/cmdline`, `ps`).
  it("never puts the session's token on its command line: it is in its environment alone, as PINO_SESSION", () => {
    for (const view of ['terminal', 'chat'] as const) {
      for (const resume of [false, true]) {
        const launch = claudeAdapter('node /abs/fake-agent.mjs').launch({ ...ctx, view, resume })
        for (const arg of [launch.command, ...launch.args]) expect(arg).not.toContain(ctx.token)
        for (const file of launch.files) expect(file.text).not.toContain(ctx.token)
        expect(launch.env).toEqual({ PINO_SESSION: ctx.token })
      }
    }
  })

  it('registers an http hook for each event it follows, and no other', () => {
    const settings = JSON.parse(after(claudeAdapter().launch(ctx).args, '--settings'))
    expect(HOOK_EVENTS).toEqual(['UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'PermissionRequest', 'PreToolUse', 'PostToolUse', 'PostCompact', 'SessionEnd'])
    expect(Object.keys(settings)).toEqual(['hooks'])
    expect(Object.keys(settings.hooks)).toEqual(HOOK_EVENTS)
    for (const event of HOOK_EVENTS) {
      expect(settings.hooks[event]).toEqual([{ hooks: [hookOf(`http://127.0.0.1:4100/hooks/s1/${event}`)] }])
    }
  })

  it('leaves the system prompt out when there is none', () => {
    expect(claudeAdapter().launch({ ...ctx, systemPrompt: '' }).args).not.toContain('--append-system-prompt')
  })

  it('runs another command when one is named, split on spaces, with the same arguments', () => {
    const usual = claudeAdapter().launch(ctx)
    const launch = claudeAdapter('node  /abs/fake-agent.mjs ').launch(ctx)
    expect(launch.command).toBe('node')
    expect(launch.args).toEqual(['/abs/fake-agent.mjs', ...usual.args])
    expect(claudeAdapter('   ').launch(ctx).command).toBe('claude')
  })

  it('passes its arguments as a list, each one string, to the letter as before there was another agent', () => {
    const spaced = { ...ctx, cwd: '/boards/my parts/lid 2', mcpUrl: 'http://127.0.0.1:4100/mcp/lid%202', systemPrompt: 'You are in pino. Mind the "quotes" and $HOME.' }
    const launch = claudeAdapter().launch(spaced)
    expect(launch.args).toEqual([
      '--session-id',
      ctx.conversationId,
      '--mcp-config',
      // A file of pino's: what it holds is above.
      '/srv/p/.config/pino/agent/s1.mcp.json',
      '--allowedTools',
      'mcp__pino__*',
      '--settings',
      JSON.stringify({ hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, [{ hooks: [hookOf(`http://127.0.0.1:4100/hooks/s1/${event}`)] }]])) }),
      '--append-system-prompt',
      'You are in pino. Mind the "quotes" and $HOME.'
    ])
    // It adds the token to the environment, and nothing else.
    expect(launch.env).toEqual({ PINO_SESSION: ctx.token })
  })

  it('is the terminal one plus the flags of the headless mode in chat, `-p` first after what the command brings', () => {
    const terminal = claudeAdapter().launch(ctx).args
    const chat = claudeAdapter().launch({ ...ctx, view: 'chat' }).args
    const flags = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio']
    expect(chat).toEqual([...flags, ...terminal])
    expect(chat.indexOf('-p')).toBe(0)
    // The same with a command that brings arguments of its own: they stay in front.
    const fake = claudeAdapter('node /abs/fake-agent.mjs').launch({ ...ctx, view: 'chat' }).args
    expect(fake.slice(0, 3)).toEqual(['/abs/fake-agent.mjs', '-p', '--input-format'])
    // Resumed, it is the same conversation by the same flag.
    expect(after(claudeAdapter().launch({ ...ctx, view: 'chat', resume: true }).args, '--resume')).toBe(ctx.conversationId)
  })

  it('says the command it is looked for by, and how it names a tool', () => {
    const adapter = claudeAdapter('node /abs/fake-agent.mjs')
    expect([adapter.command, adapter.toolName('project')]).toEqual(['claude', 'mcp__pino__project'])
  })

  it('passes no skills and no plugin: pino has none yet', () => {
    const adapter = claudeAdapter()
    expect(adapter.skills).toBe(false)
    expect(adapter.plugin).toBeUndefined()
    for (const view of ['terminal', 'chat'] as const) expect(adapter.launch({ ...ctx, view }).args).not.toContain('--plugin-dir')
  })

  it('names the versions it was checked with, and its recordings are of those', () => {
    for (const file of ['claude-stream.jsonl', 'claude-stream-asks.jsonl']) {
      const versions = readFileSync(join(__dirname, '../../../test/fixtures', file), 'utf8')
        .split('\n')
        .filter((line) => line.includes('claude_code_version'))
        .map((line) => JSON.parse(line).claude_code_version as string)
      for (const v of versions) expect(v >= TESTED_CLAUDE.min && v <= TESTED_CLAUDE.max, v).toBe(true)
    }
    expect(claudeAdapter().tested).toEqual(TESTED_CLAUDE)
  })
})
