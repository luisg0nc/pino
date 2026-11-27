// The one way a spec starts pino (.claude/rules/e2e-hidden-window.md): hidden, with a profile, a config file and a
// home of its own in the temporary folder, and never with the real claude.
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export { agentsIn, cwdOf } from './terminal'

const appDir = resolve(__dirname, '..')
const FAKE_AGENT = join(appDir, 'test', 'fake-agent.mjs')
const FAKE_KERNEL = join(appDir, 'test', 'fake-kernel.mjs')
const REFERENCE = resolve(appDir, '..', 'kernel', 'tests', 'fixtures', 'reference')
/** What a run with no stand-in asked for is given: a command that is not there, so that nothing can reach `claude`. */
export const NO_AGENT = '/nonexistent/claude'

/** The temporary folders of this run of the specs, removed when it ends. */
const made: string[] = []
process.on('exit', () => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A folder of this run in the temporary folder, by its real path, which is how a process sees its cwd. */
export function tempFolder(label: string): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), `pino-e2e-${label}-`))
  made.push(dir)
  return dir
}

/**
 * A new project folder with this name, in a workspace of its own. It holds a brief and no board: that makes it a
 * project by the launcher's rule, so `PINO_PROJECT` opens it, not its page of projects.
 */
export function tempProject(name = 'blinky'): string {
  const dir = join(tempFolder('project'), name)
  mkdirSync(dir)
  writeFileSync(join(dir, 'brief.md'), `# ${name}\n`)
  return dir
}

/** A project holding the reference board (its board.py and outline.json), for what is built and drawn. */
export function referenceProject(name = 'reference'): string {
  const dir = tempProject(name)
  cpSync(REFERENCE, dir, { recursive: true })
  return dir
}

export interface Launched {
  app: ElectronApplication
  page: Page
  /** The config file this run reads and writes: give it to the next launch to start where this one left off. */
  config: string
}

/**
 * `kernel`: the engine's stand-in (the default), or the real engine through `uv`, which only `real-kernel.spec.ts`
 * asks for. `packaged`: the executable of a packaged app, started in the place of the build in `out/`
 * (`packaged.spec.ts`).
 */
export async function launch(opts: { project?: string; agent?: boolean; env?: Record<string, string>; kernel?: 'fake' | 'real'; args?: string[]; packaged?: string } = {}): Promise<Launched> {
  const home = tempFolder('home')
  const config = opts.env?.PINO_CONFIG ?? join(tempFolder('config'), 'config.json')
  // What the shell the specs run from may have set of pino's own switches means nothing to a run.
  const outer = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith('PINO_')))
  const env: Record<string, string> = {
    ...outer,
    // The display still answers a run whose home is elsewhere.
    XAUTHORITY: process.env.XAUTHORITY ?? join(homedir(), '.Xauthority'),
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    PINO_TEST: '1',
    // The real engine, when a spec asks for it, looks no part up: tests never use the network.
    PINO_PARTS_OFFLINE: '1',
    PINO_CONFIG: config,
    PINO_AGENT_CMD: opts.agent ? `node ${FAKE_AGENT}` : NO_AGENT,
    ...(opts.kernel === 'real' ? {} : { PINO_KERNEL_CMD: `node ${FAKE_KERNEL}` }),
    ...(opts.project ? { PINO_PROJECT: opts.project } : {}),
    ...opts.env
  }
  // A CI runner has no GPU: the 3D view and Claude's picture of it are drawn in software there.
  const software = process.env.CI ? ['--enable-unsafe-swiftshader'] : []
  const args = [...software, ...(opts.args ?? [])]
  const app = await electron.launch(opts.packaged ? { executablePath: opts.packaged, args, env } : { args: ['.', ...args], cwd: appDir, env })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-region]')
  return { app, page, config }
}
