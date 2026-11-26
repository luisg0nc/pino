// The screenshots the design review compares with the picked mockups. It runs only when PINO_SHOTS names a folder
// outside the repository: `PINO_SHOTS=/some/folder pnpm -C app exec playwright test e2e/shots.spec.ts`.
//
// Each picture is a launch of its own: a hidden window's `capturePage()` gives one picture, and the next call never
// returns (torno found the same).

import { appendFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { capture, clickTarget, markScene, markTrack, resize, screenOf, settled, startRoute, waitForBuild, zoomOn } from './helpers'
import { launch, referenceProject, type Launched } from './launch'

const folder = process.env.PINO_SHOTS ? resolve(process.env.PINO_SHOTS) : null
const inRepo = folder !== null && `${folder}/`.startsWith(`${resolve(__dirname, '../..')}/`)

test.skip(folder === null || inRepo, 'set PINO_SHOTS to a folder outside the repository')
test.setTimeout(90_000)

const tab = (run: Launched, name: string) => run.page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name })

interface Shot {
  width?: number
  height?: number
  dark?: boolean
  /** The first screen: no project is opened. */
  first?: true
  env?: Record<string, string>
  /** Drives the window to what the picture is of; `project` is the folder it has open. */
  at?(run: Launched, project: string): Promise<void>
}

const onBoard = async (run: Launched): Promise<void> => {
  await tab(run, 'Board').click()
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().board?.hash ?? null)).not.toBeNull()
}
const press = (key: string) => async (run: Launched) => {
  await onBoard(run)
  await run.page.keyboard.press(key)
}

const onSheet = async (run: Launched): Promise<void> => {
  await tab(run, 'Schematic').click()
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().sheet?.symbols ?? 0)).toBeGreaterThan(0)
  await clickTarget(run.page, { kind: 'part', ref: 'J1' })
  // The tag stands where the pointer has left it, not under the pointer's hover.
  await run.page.mouse.move(5, 5)
}

const in3d = async (run: Launched): Promise<void> => {
  await onSheet(run)
  await tab(run, '3D').click()
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().three?.loaded ?? false), { timeout: 20_000 }).toBe(true)
}

/** The marks of the mock's scene, made on the reference board round its regulator, and seen close. */
const onMarks = async (run: Launched): Promise<void> => {
  await onBoard(run)
  await markScene(run.page)
  await zoomOn(run.page, { kind: 'part', ref: 'U2' }, 900)
  await run.page.locator('[data-mark-row="M3"]').click()
  await run.page.mouse.move(5, 5)
}

/** An engine that routes, over a stand-in whose copper is a straight track for each open line. */
const ROUTES = { FAKE_KERNEL_SERVE: '2' }

/** The routed board, drawn: the route is started as the band's button does it. */
const routed = async (run: Launched): Promise<void> => {
  await onBoard(run)
  await startRoute(run.page)
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.state().build?.lastGood?.routing?.state ?? null), { timeout: 20_000 }).toBe('current')
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().board?.route ?? null)).not.toBeNull()
}

const SHOTS: Record<string, Shot> = {
  'first-light': { first: true },
  'first-dark': { first: true, dark: true },
  'board-routing': {
    env: { ...ROUTES, FAKE_KERNEL_ROUTE_MS: '700' },
    at: async (run) => {
      await onBoard(run)
      await startRoute(run.page)
      await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.state().build?.route?.index ?? 0), { timeout: 20_000 }).toBeGreaterThanOrEqual(6)
    }
  },
  'board-routed': { env: ROUTES, at: routed },
  'board-stale': {
    env: { ...ROUTES, FAKE_KERNEL_MOVE: 'U2:2.5,0' },
    at: async (run, project) => {
      await routed(run)
      appendFileSync(join(project, 'board.py'), '\n# moved\n')
      await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().board?.stale ?? 0), { timeout: 20_000 }).toBeGreaterThan(0)
    }
  },
  'marks-routed': {
    env: ROUTES,
    at: async (run) => {
      await routed(run)
      await markScene(run.page)
      await markTrack(run.page)
      await zoomOn(run.page, { kind: 'part', ref: 'U2' }, 900)
      await run.page.mouse.move(5, 5)
    }
  },
  marks: { at: onMarks },
  'marks-dark': { dark: true, at: onMarks },
  'marks-drawing': {
    at: async (run) => {
      await onBoard(run)
      await zoomOn(run.page, { kind: 'part', ref: 'U2' }, 900)
      await run.page.keyboard.press('d')
      const from = await screenOf(run.page, { kind: 'pad', ref: 'U2', number: '1' })
      await run.page.mouse.move(from.x, from.y)
      await run.page.mouse.down()
      for (const [dx, dy] of [[-30, 20], [-55, 55], [-50, 100], [-20, 130], [30, 140], [75, 125]]) await run.page.mouse.move(from.x + dx, from.y + dy, { steps: 6 })
      // held there: the picture is of a stroke being drawn
    }
  },
  '3d': { at: in3d },
  '3d-dark': { dark: true, at: in3d },
  sheet: { at: onSheet },
  'sheet-dark': { dark: true, at: onSheet },
  board: { at: onBoard },
  'board-1920': { width: 1920, height: 1080, at: onBoard },
  'board-dark': { dark: true, at: onBoard },
  'board-nets': { at: press('n') },
  'board-bottom': { at: press('2') }
}

test.beforeAll(() => {
  mkdirSync(folder!, { recursive: true })
})

for (const [name, shot] of Object.entries(SHOTS)) {
  test(name, async () => {
    const project = referenceProject()
    // The first screen with the stand-in found, as on a machine that is ready.
    const run = await launch({ ...(shot.first ? { agent: true } : { project }), env: shot.env })
    try {
      const scheme = shot.dark ? ('dark' as const) : ('light' as const)
      await run.app.evaluate(({ nativeTheme }, source) => void (nativeTheme.themeSource = source), scheme)
      // Playwright emulates a scheme of its own: it is told the same one.
      await run.page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme })
      await resize(run.app, run.page, shot.width ?? 1440, shot.height ?? 900)
      if (shot.first) await expect(run.page.locator('.welcome-ready li[data-ok]')).toHaveCount(3)
      else await waitForBuild(run.page, 1)
      await shot.at?.(run, project)
      await run.page.evaluate(() => document.fonts.ready.then(() => undefined))
      await settled(run.page)
      // The canvas of a hidden window reaches the compositor a frame or two after it is drawn.
      await run.page.waitForTimeout(300)
      await capture(run.app, join(folder!, `${name}.png`))
    } finally {
      await run.app.close()
    }
  })
}
