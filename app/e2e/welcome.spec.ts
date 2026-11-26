import { rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launch, tempFolder, tempProject } from './launch'

const state = (page: Page) => page.evaluate(() => window.__pinoTest!.state())
const pickWill = (app: Awaited<ReturnType<typeof launch>>['app'], dir: string | null) =>
  app.evaluate((_main, folder) => {
    ;(globalThis as unknown as { __pinoMain: { pickFolder: string | null } }).__pinoMain.pickFolder = folder
  }, dir)
const picks = (app: Awaited<ReturnType<typeof launch>>['app']) => app.evaluate(() => (globalThis as unknown as { __pinoMain: { picks: number } }).__pinoMain.picks)

test('with no workspace, the window is the first screen on the green dye, with the name and the two ways in', async () => {
  const { app, page } = await launch()
  try {
    const plate = page.locator('[data-region="viewport"] .plate')
    await expect(plate).toBeVisible()
    await expect(page.locator('.plate-headline')).toHaveText('pino')
    await expect(page.locator('.pin-drawing')).toBeVisible()
    // What pino needs, as the stand-in engine says it; no agent was asked for, so Claude Code is not found.
    await expect(page.getByRole('list', { name: 'What pino needs' }).getByRole('listitem')).toHaveText([
      /^Claude Code was not found/,
      'KiCad 10.0.6 found, with its libraries',
      "pino's Python environment is ready"
    ])
    await expect(page.locator('.welcome-ways').getByRole('button')).toHaveText(['Use ~/boards', 'Choose folder…'])
    await expect(page.getByRole('heading', { name: 'Choose a folder for your boards' })).toBeVisible()
    await expect(page.locator('.welcome-side')).toContainText('Each board is a folder in it. Nothing is written there until you start a board.')
    await expect(page.locator('.welcome-foot')).toHaveText("pino writes into each board's .pino folder, and into its fab/ folder when you make fab files. It makes a board's folder when you start one, and ~/boards when you press Use ~/boards.")
    // The plate is the dye itself.
    expect(await plate.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/^rgb\((23, 102, 58|18, 61, 37)\)$/)
    expect((await state(page)).page).toBe('first')
    // The window has no frame: it draws its own three controls.
    await expect(page.getByRole('button', { name: 'Minimize' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  } finally {
    await app.close()
  }
})

test("Choose folder asks the dialog's stand-in and opens the workspace it answers", async () => {
  const workspace = dirname(tempProject('blinky'))
  const { app, page } = await launch()
  try {
    await pickWill(app, workspace)
    await page.getByRole('button', { name: 'Choose folder…' }).click()
    await expect.poll(async () => (await state(page)).page).toBe('projects')
    expect(await picks(app)).toBe(1)
    expect((await state(page)).workspace).toMatchObject({ root: workspace, name: basename(workspace) })
    await expect(page.getByRole('main', { name: 'All projects' }).getByRole('button', { name: 'blinky' })).toBeVisible()
    await expect(page.getByRole('button', { name: `Workspace ${basename(workspace)}` })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('a folder dialog that is put away changes nothing', async () => {
  const { app, page } = await launch()
  try {
    await pickWill(app, null)
    await page.getByRole('button', { name: 'Choose folder…' }).click()
    await expect.poll(() => picks(app)).toBe(1)
    await expect(page.getByRole('button', { name: 'Choose folder…' })).toBeEnabled()
    expect((await state(page)).page).toBe('first')
    await expect(page.locator('.welcome-problem')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('a workspace opened is listed next time, and a missing one is shown as missing', async () => {
  const kept = tempProject('kept')
  const gone = tempProject('gone')
  const first = await launch({ project: kept })
  await expect.poll(async () => (await state(first.page)).page).toBe('project')
  await first.app.close()
  const env = { PINO_CONFIG: first.config }
  const second = await launch({ project: gone, env })
  await expect.poll(async () => (await state(second.page)).page).toBe('project')
  await second.app.close()
  rmSync(dirname(gone), { recursive: true, force: true })

  const { app, page } = await launch({ env })
  try {
    const rows = page.getByRole('navigation', { name: 'Recent workspaces' }).locator('li')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText(dirname(gone))
    await expect(rows.nth(0)).toContainText('Not found')
    await expect(rows.nth(0).getByRole('button')).toBeDisabled()
    await rows.nth(1).getByRole('button').click()
    await expect.poll(async () => (await state(page)).workspace?.root).toBe(dirname(kept))
    expect((await state(page)).page).toBe('projects')
  } finally {
    await app.close()
  }
})

test('a folder that cannot be opened is said under the ways in, and the first screen stays', async () => {
  const { app, page } = await launch()
  try {
    await pickWill(app, join(tempFolder('nothing'), 'not-there'))
    await page.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(page.getByRole('alert')).toHaveText('not-there is not a folder pino can open: it is not there')
    await expect(page.locator('.plate')).toBeVisible()
    expect((await state(page)).page).toBe('first')
  } finally {
    await app.close()
  }
})

test('a folder named at start that cannot be opened is said on the first screen', async () => {
  const { app, page } = await launch({ project: join(tempFolder('nothing'), 'typo') })
  try {
    await expect(page.getByRole('alert')).toHaveText('typo is not a folder pino can open: it is not there')
    expect((await state(page)).page).toBe('first')
  } finally {
    await app.close()
  }
})
