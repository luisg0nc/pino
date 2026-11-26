import type { AgentView } from '../../shared/bridge'
import type { Effort } from '../../shared/chat'
import type { AgentTransport } from './transport'

/** What to run for a session: the command, its arguments, variables to add to its environment, and files of pino's it is given by path. */
export interface AgentLaunch {
  command: string
  /** One string each, as the process gets them: never a line for a shell to split. Never the token. */
  args: string[]
  env: Record<string, string>
  /** Written before the agent starts and removed when it ends, each under `LaunchContext.configDir`. None holds a secret. */
  files: Array<{ path: string; text: string }>
}

export interface LaunchContext {
  sessionId: string
  /** The agent's own id of the conversation: started with it, or resumed by it. */
  conversationId: string
  resume: boolean
  /** `chat`: run headless, its conversation as JSON lines on pipes; `terminal`: as the person would run it. */
  view: AgentView
  cwd: string
  /** pino's MCP server, for this project alone. */
  mcpUrl: string
  hookUrl: (event: string) => string
  /**
   * The session's token, which every request to `mcpUrl` and `hookUrl` carries in the header `X-Pino-Session`. Only
   * ever in the agent's environment: a command line is readable by every user of the machine.
   */
  token: string
  /** A folder of pino's own, never in a project, for the files the agent is given by path (`AgentLaunch.files`). */
  configDir: string
  /** What to add to the agent's system prompt; '' or absent for nothing. */
  systemPrompt?: string
  /** False: leave out the skills the adapter would give (a session started on the full prompt, since they did not load). Absent: as the adapter is. */
  skills?: boolean
  /** The model and effort chosen for this session alone (`MODEL_NAME`, `EFFORTS`, checked by main); absent: the person's own default. */
  model?: string
  effort?: Effort
}

/**
 * How the agent CLI is started so that it knows pino: where pino's MCP
 * server is, where to post its hooks, and what it is told of pino.
 * Everything goes on its command line, in its environment, or in a config file
 * of pino's that holds no secret; the session's token is in the environment
 * alone. Nothing of the person's configuration of that agent is changed, and
 * none of its settings is read. Claude Code (./claude.ts) is the one there is.
 */
export interface AgentAdapter {
  /** The command looked for on PATH. */
  command: string
  /**
   * The command a session runs and the arguments it is given before all others, for asking the CLI about itself before
   * any session (`--version`, `auth status`, outside tests only; nothing asks yet). With `PINO_AGENT_CMD`, the stand-in's.
   */
  probe: { command: string; args: string[] }
  /** It is given pino's skills (Claude Code's `--plugin-dir`): its system prompt leaves to them what they say. */
  skills: boolean
  /** The plugin of skills it passes (when `skills`): the CLI's `init` is read for whether it loaded. */
  plugin?: { name: string; skills: readonly string[] }
  /** The versions of the agent pino was checked against, inclusive (`2.1.300`): one older, or of a newer major or minor, is said once. */
  tested?: { min: string; max: string }
  /** How this agent's client names a tool of pino's to the model: `mcp__pino__project`. */
  toolName(tool: string): string
  launch(ctx: LaunchContext): AgentLaunch
  /** What a chat session (`view` `chat`) speaks to the agent through, once launched: the agent started as `launch` said, in the project's folder. */
  chat(run: { command: string; args: string[]; cwd: string; env: Record<string, string> }): AgentTransport
}
