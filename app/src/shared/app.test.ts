import { describe, expect, it } from 'vitest'
import { APP, envName, SIBLING_PREFIXES, TOOL_PREFIX, toolName } from './app'

describe('the app prefix', () => {
  it('is pino, said once', () => {
    expect(APP).toEqual({ name: 'pino', envPrefix: 'PINO_', header: 'X-Pino-Session', folder: '.pino', configDir: 'pino', bridge: 'pino', testHook: '__pinoTest', mainHook: '__pinoMain' })
    expect([envName('TEST'), TOOL_PREFIX, toolName('project')]).toEqual(['PINO_TEST', 'mcp__pino__', 'mcp__pino__project'])
  })

  it('knows the env prefix of the sibling app, which is not its own', () => {
    expect(SIBLING_PREFIXES).toHaveLength(1)
    expect(SIBLING_PREFIXES).not.toContain(APP.envPrefix)
  })
})
