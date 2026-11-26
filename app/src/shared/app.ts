// Every name that is the app's own comes from here, so the modules pino shares with torno can become one package.
// A file that cannot import this one (scripts/pino, test/fake-agent.mjs) holds the name in one variable, and a test
// holds that variable equal to APP.name.

export const APP = {
  name: 'pino',
  envPrefix: 'PINO_',
  header: 'X-Pino-Session',
  folder: '.pino',
  configDir: 'pino',
  bridge: 'pino',
  testHook: '__pinoTest',
  mainHook: '__pinoMain'
} as const

/** The name of one of the app's environment variables. */
export const envName = (name: string): string => `${APP.envPrefix}${name}`

/** What Claude Code puts before the name of a tool of the app's MCP server. */
export const TOOL_PREFIX = `mcp__${APP.name}__`

export const toolName = (tool: string): string => `${TOOL_PREFIX}${tool}`

/**
 * The env prefixes of sibling apps whose session variables an agent must not inherit, when one of their sessions is
 * what started pino. The one place another app's name is code.
 */
export const SIBLING_PREFIXES: readonly string[] = ['TORNO_']
