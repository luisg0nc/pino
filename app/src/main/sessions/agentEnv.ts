import { envName, SIBLING_PREFIXES } from '../../shared/app'

/**
 * What a session gives its agent (`Sessions.start`). pino started from inside one of its own sessions has an outer
 * pino's: its token would reach whatever pino starts, and a model that prints its environment would have it logged
 * where the inner pino's `redact` does not know it. The same goes for a sibling app's session that started pino.
 */
const SESSION_VARIABLES = new Set([
  ...['SESSION', 'PROJECT_ID', 'SESSION_ID'].map(envName),
  ...SIBLING_PREFIXES.flatMap((prefix) => ['SESSION', 'OBJECT', 'SESSION_ID'].map((name) => `${prefix}${name}`))
])

/** pino's own switches (src/main/index.ts, e2e/): they mean nothing to the agent, or mislead what it starts. */
const OWN_VARIABLES = new Set([...['TEST', 'TEST_SIZE', 'AGENT_CMD', 'CONFIG', 'PROJECT', 'DEBUG'].map(envName), ...SESSION_VARIABLES])

/**
 * What a Claude Code session exports to the processes it starts. Only these:
 * other CLAUDE_CODE_* variables (CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_OAUTH_TOKEN, ...)
 * are settings a person makes on purpose, and the agent must get them.
 */
const PARENT_SESSION_VARIABLES = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_EFFORT',
  'CLAUDE_PID'
])

/** What an AppImage's runtime sets for the app it starts. */
const APPIMAGE_VARIABLES = ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']
/** The lists its `AppRun` puts the mount's folders into. */
const APPIMAGE_LISTS = ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR']

/**
 * What pino's own AppImage added is for pino's window alone: claude, kicad-cli, uv and what they start are the
 * person's, and would load the mount's old libraries. An empty entry goes too: AppRun leaves one where the list was
 * empty, and the loader reads it as the current folder.
 */
function withoutAppImage(env: Record<string, string>): Record<string, string> {
  const mount = env.APPDIR
  if (!mount || mount === '/') return env
  const out = { ...env }
  for (const name of APPIMAGE_VARIABLES) delete out[name]
  for (const name of APPIMAGE_LISTS) {
    if (out[name] === undefined) continue
    const kept = out[name].split(':').filter((dir) => dir !== '' && dir !== mount && !dir.startsWith(`${mount}/`))
    if (kept.length) out[name] = kept.join(':')
    else delete out[name]
  }
  return out
}

/**
 * The environment every process pino starts inherits (through `agentEnv`, the agent): pino's, without what a session
 * of an outer pino gave it, or its AppImage. pino's switches stay for all but the agent.
 */
export function withoutSession(env: Record<string, string | undefined>): Record<string, string> {
  return withoutAppImage(Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !SESSION_VARIABLES.has(entry[0]))))
}

/**
 * The environment an agent inherits: pino's, without pino's own switches and
 * without the marks of a Claude Code session. pino may have been started from
 * inside one, and the agent would then take itself for a child of that session.
 */
export function agentEnv(env: Record<string, string | undefined>): Record<string, string> {
  const kept = (name: string): boolean => !OWN_VARIABLES.has(name) && !PARENT_SESSION_VARIABLES.has(name)
  return Object.fromEntries(Object.entries(withoutSession(env)).filter(([name]) => kept(name)))
}
