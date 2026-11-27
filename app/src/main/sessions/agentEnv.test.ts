import { describe, expect, it } from 'vitest'
import { SIBLING_PREFIXES } from '../../shared/app'
import { agentEnv, withoutSession } from './agentEnv'

// What a session of an outer pino gave it, when pino was started from inside one.
const OUTER = { PINO_SESSION: 'outer-token', PINO_PROJECT_ID: 'outer-project', PINO_SESSION_ID: 'outer-session' }
/** The same of a sibling app's session. */
const SIBLING = Object.fromEntries(SIBLING_PREFIXES.flatMap((prefix) => ['SESSION', 'OBJECT', 'SESSION_ID'].map((name) => [`${prefix}${name}`, 'sibling'])))

describe('withoutSession', () => {
  it("takes out what an outer pino's session gave it, and keeps pino's switches and the rest", () => {
    expect(withoutSession({ ...OUTER, ...SIBLING, PINO_TEST: '1', PATH: '/bin', GONE: undefined })).toEqual({ PINO_TEST: '1', PATH: '/bin' })
  })
})

describe('in an AppImage', () => {
  const APPDIR = '/tmp/.mount_pinoAb'
  // What the AppImage's runtime and AppRun set. With nothing set before, AppRun leaves an empty entry behind.
  const MOUNTED = {
    APPDIR,
    APPIMAGE: '/home/a/pino.AppImage',
    ARGV0: './pino.AppImage',
    OWD: '/home/a',
    PATH: `${APPDIR}:${APPDIR}/usr/sbin:/usr/bin:/bin`,
    LD_LIBRARY_PATH: `${APPDIR}/usr/lib:`,
    XDG_DATA_DIRS: `${APPDIR}/usr/share:/usr/share/gnome:/usr/share/`,
    GSETTINGS_SCHEMA_DIR: `${APPDIR}/usr/share/glib-2.0/schemas:`
  }

  it("gives nothing pino starts the mount's folders or the runtime's variables", () => {
    const said = { PATH: '/usr/bin:/bin', XDG_DATA_DIRS: '/usr/share/gnome:/usr/share/' }
    expect(withoutSession(MOUNTED)).toEqual(said)
    expect(agentEnv(MOUNTED)).toEqual(said)
  })

  it("keeps the person's own entries, and a folder that only begins with the mount's name", () => {
    expect(withoutSession({ APPDIR, LD_LIBRARY_PATH: `${APPDIR}/usr/lib:/opt/lib:${APPDIR}-other` })).toEqual({ LD_LIBRARY_PATH: `/opt/lib:${APPDIR}-other` })
  })

  it('changes nothing outside an AppImage', () => {
    for (const appdir of [undefined, '', '/']) {
      const env = { PATH: '/usr/bin:', LD_LIBRARY_PATH: '/opt/lib:', ARGV0: 'zsh', OWD: '/o', ...(appdir === undefined ? {} : { APPDIR: appdir }) }
      expect(withoutSession(env)).toEqual(env)
    }
  })
})

describe('agentEnv', () => {
  it("takes out an outer pino's session, pino's own switches and the marks of a Claude Code session", () => {
    const own = { PINO_TEST: '1', PINO_AGENT_CMD: 'node x', PINO_CONFIG: '/c', PINO_PROJECT: '/p', PINO_DEBUG: '1' }
    expect(agentEnv({ ...OUTER, ...own, CLAUDECODE: '1', CLAUDE_CODE_OAUTH_TOKEN: 'kept', PATH: '/bin' })).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'kept', PATH: '/bin' })
  })

  it('gives the agent no session token of a sibling app that started pino', () => {
    const [sibling] = SIBLING_PREFIXES
    expect(agentEnv({ [`${sibling}SESSION`]: 'x', PINO_SESSION: 'y', PATH: '/bin' })).toEqual({ PATH: '/bin' })
  })
})
