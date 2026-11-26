import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launch, tempFolder, tempProject } from './launch'

const state = (page: Page) => page.evaluate(() => window.__pinoTest!.state())
const pickWill = (app: Awaited<ReturnType<typeof launch>>['app'], dir: string | null) =>
  app.evaluate((_main, folder) => {
    ;(globalThis as unknown as { __pinoMain: { pickFolder: string | null } }).__pinoMain.pickFolder = folder
  }, dir)
const picks = (app: Awaited<ReturnType<typeof launch>>['app']) => app.evaluate(() => (globalThis as unknown as { __pinoMain: { picks: number } }).__pinoMain.picks)

test('with no project, the window is the first screen on the green dye, with the name and Open folder', async () => {
  const { app, page } = await launch()
  try {
    const plate = page.locator('[data-region="viewport"] .plate')
    await expect(plate).toBeVisible()
    await expect(page.locator('.logo-word')).toHaveText('pino')
    await expect(page.locator('.welcome-ways').getByRole('button')).toHaveText(['Open folder'])
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

test("Open folder asks the dialog's stand-in and opens the project it answers", async () => {
  const dir = tempProject('blinky')
  const { app, page } = await launch()
  try {
    await pickWill(app, dir)
    await page.getByRole('button', { name: 'Open folder' }).click()
    await expect.poll(async () => (await state(page)).page).toBe('project')
    expect(await picks(app)).toBe(1)
    expect((await state(page)).project).toMatchObject({ dir, name: 'blinky' })
    await expect(page.locator('[data-region="title"]')).toContainText('blinky')
  } finally {
    await app.close()
  }
})

test('a folder dialog that is put away changes nothing', async () => {
  const { app, page } = await launch()
  try {
    await pickWill(app, null)
    await page.getByRole('button', { name: 'Open folder' }).click()
    await expect.poll(() => picks(app)).toBe(1)
    await expect(page.getByRole('button', { name: 'Open folder' })).toBeEnabled()
    expect((await state(page)).page).toBe('first')
    await expect(page.locator('.welcome-problem')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('a project opened is listed next time, and a missing one is shown as missing', async () => {
  const kept = tempProject('kept')
  const gone = tempProject('gone')
  const first = await launch({ project: kept })
  await expect.poll(async () => (await state(first.page)).page).toBe('project')
  await first.app.close()
  const env = { PINO_CONFIG: first.config }
  const second = await launch({ project: gone, env })
  await expect.poll(async () => (await state(second.page)).page).toBe('project')
  await second.app.close()
  rmSync(gone, { recursive: true, force: true })

  const { app, page } = await launch({ env })
  try {
    const rows = page.getByRole('navigation', { name: 'Recent folders' }).locator('li')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('gone')
    await expect(rows.nth(0)).toContainText('Not found')
    await expect(rows.nth(0).getByRole('button')).toBeDisabled()
    await rows.nth(1).getByRole('button').click()
    await expect.poll(async () => (await state(page)).project?.dir).toBe(kept)
  } finally {
    await app.close()
  }
})

test('a folder that cannot be opened is said under the ways in, and the first screen stays', async () => {
  const { app, page } = await launch()
  try {
    await pickWill(app, join(tempFolder('nothing'), 'not-there'))
    await page.getByRole('button', { name: 'Open folder' }).click()
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
