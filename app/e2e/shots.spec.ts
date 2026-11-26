// The screenshots the design review compares with the picked mockups. It runs only when PINO_SHOTS names a folder
// outside the repository: `PINO_SHOTS=/some/folder pnpm -C app exec playwright test e2e/shots.spec.ts`.
//
// Each picture is a launch of its own: a hidden window's `capturePage()` gives one picture, and the next call never
// returns (torno found the same).

import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { capture, clickTarget, resize, settled, waitForBuild } from './helpers'
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
  env?: Record<string, string>
  /** Drives the window to what the picture is of. */
  at?(run: Launched): Promise<void>
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

const SHOTS: Record<string, Shot> = {
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
    const run = await launch({ project: referenceProject(), env: shot.env })
    try {
      const scheme = shot.dark ? ('dark' as const) : ('light' as const)
      await run.app.evaluate(({ nativeTheme }, source) => void (nativeTheme.themeSource = source), scheme)
      // Playwright emulates a scheme of its own: it is told the same one.
      await run.page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme })
      await resize(run.app, run.page, shot.width ?? 1440, shot.height ?? 900)
      await waitForBuild(run.page, 1)
      await shot.at?.(run)
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
