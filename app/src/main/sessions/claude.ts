import { join } from 'node:path'
import { APP, envName, TOOL_PREFIX, toolName } from '../../shared/app'
import { SESSION_HEADER } from '../http'
import type { AgentAdapter } from './adapter'
import { ClaudeStream } from './stream'
import { HOOK_EVENTS } from './status'

export { HOOK_EVENTS }

const HOOK_TIMEOUT_S = 5
/** The Stop hook may wait for a build that is nearly done before it answers (`main/domain.ts`, STOP_WAIT_MS). */
const STOP_HOOK_TIMEOUT_S = 25
/**
 * The variable of the agent's environment that holds the session's token. Claude Code reads names that look like a
 * credential (`*_API_KEY`, `NPM_TOKEN`, ...) as empty toward a remote server: this one does not look like one.
 */
const TOKEN_VARIABLE = envName('SESSION')
/**
 * What makes Claude Code speak JSON lines on its pipes instead of drawing a terminal: a prompt is a line of
 * stdin, everything it does a line of stdout, and what it would ask the person (a permission, a question) a
 * request on stdout that is answered on stdin.
 */
const HEADLESS = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio']

/**
 * The versions of Claude Code the plumbing was checked against, inclusive: those of the recordings in `test/fixtures/`
 * (`claude_code_version` of their `init`). One older than its minimum, or of a newer major or minor than its maximum, is
 * said once in a chat (a patch of the tested minor is quiet), and nothing more is done about it. The range moves when a
 * new stream is recorded (`test/fixtures/RECORDING.md`).
 */
export const TESTED_CLAUDE = { min: '2.1.300', max: '2.1.301' } as const

/**
 * Claude Code. Everything pino adds is passed on the command line, in the
 * environment or in a file of pino's own, so the person's own settings and
 * MCP servers are neither read nor changed (no --strict-mcp-config: their
 * servers keep working beside pino's).
 *
 * The session's token is in the environment alone (`PINO_SESSION`), never in
 * an argument: Claude Code puts it in the `X-Pino-Session` header itself. Each
 * hook names it in `allowedEnvVars` (an http hook expands only those), and the
 * MCP server is given in a file (`--mcp-config <path>`, as a `.mcp.json` is,
 * whose `headers` expand `${VAR}`) that holds the placeholder, not the token.
 *
 * `agentCmd` replaces the command `claude`: PINO_AGENT_CMD, split on spaces,
 * so a path with a space in it cannot be named this way.
 */
export function claudeAdapter(agentCmd?: string): AgentAdapter {
  const [command = 'claude', ...before] = (agentCmd ?? '').split(' ').filter(Boolean)
  return {
    command: 'claude',
    probe: { command, args: before },
    skills: false,
    tested: TESTED_CLAUDE,
    toolName,
    launch(ctx) {
      const hook = (event: string) => [
        {
          hooks: [
            {
              type: 'http',
              url: ctx.hookUrl(event),
              timeout: event === 'Stop' ? STOP_HOOK_TIMEOUT_S : HOOK_TIMEOUT_S,
              headers: { [SESSION_HEADER]: `$${TOKEN_VARIABLE}` },
              allowedEnvVars: [TOKEN_VARIABLE]
            }
          ]
        }
      ]
      const settings = { hooks: Object.fromEntries(HOOK_EVENTS.map((event) => [event, hook(event)])) }
      const mcp = { mcpServers: { [APP.name]: { type: 'http', url: ctx.mcpUrl, headers: { [SESSION_HEADER]: `\${${TOKEN_VARIABLE}}` } } } }
      const mcpFile = join(ctx.configDir, `${ctx.sessionId}.mcp.json`)
      const args = [
        ...before,
        ...(ctx.view === 'chat' ? HEADLESS : []),
        ctx.resume ? '--resume' : '--session-id',
        ctx.conversationId,
        '--mcp-config',
        mcpFile,
        '--allowedTools',
        `${TOOL_PREFIX}*`,
        '--settings',
        JSON.stringify(settings)
      ]
      if (ctx.systemPrompt) args.push('--append-system-prompt', ctx.systemPrompt)
      // `--flag=value`: one argument, so that what follows can never be read as a flag of its own.
      if (ctx.model) args.push(`--model=${ctx.model}`)
      if (ctx.effort) args.push(`--effort=${ctx.effort}`)
      return { command, args, env: { [TOKEN_VARIABLE]: ctx.token }, files: [{ path: mcpFile, text: `${JSON.stringify(mcp, null, 2)}\n` }] }
    },
    // Its headless mode on pipes (`HEADLESS` above).
    chat: (run) => new ClaudeStream(run)
  }
}
