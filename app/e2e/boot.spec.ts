import { basename, dirname } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, tempProject, type Launched } from './launch'

let run: Launched

test.beforeAll(async () => {
  run = await launch()
})
test.afterAll(async () => {
  await run?.app.close()
})

test('starts with its window hidden', async () => {
  expect(await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()))).toEqual([false])
})

test("the window's icon is a picture Electron can read", async () => {
  const size = await run.app.evaluate(({ app, nativeImage }) => nativeImage.createFromPath(`${app.getAppPath()}/../scripts/pino.png`).getSize())
  expect(size).toEqual({ width: 512, height: 512 })
})

test('keeps its profile in a temp folder, not under the person\'s config', async () => {
  expect(await run.app.evaluate(({ app }) => app.getPath('userData'))).toMatch(/\/pino-test-\d+-/)
})

test.describe('with a project', () => {
  let open: Launched
  let dir: string
  test.beforeAll(async () => {
    dir = tempProject('blinky')
    open = await launch({ project: dir })
    await open.page.waitForSelector('[data-region="left"]')
  })
  test.afterAll(async () => {
    await open?.app.close()
  })

  test('the window is the grid: title, route card, the Brief and the three views, the dock and the status line', async () => {
    const { page } = open
    for (const r of ['title', 'left', 'viewport', 'session', 'status']) await expect(page.locator(`[data-region="${r}"]`)).toBeVisible()
    await expect(page.locator('[data-region="left"] h2')).toHaveText('blinky')
    await expect(page.locator('[data-region="left"]').getByRole('button', { name: 'Open the Brief' })).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Views' }).getByRole('tab')).toHaveText(['Brief', 'Schematic', 'Board', '3D'])
    await page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: 'Schematic' }).click()
    await expect(page.getByRole('tabpanel')).toContainText('Nothing to draw yet.')
    await expect(page.getByRole('tabpanel')).toContainText('Claude writes board.py. pino draws the schematic, the board and the 3D view here on every save.')
    await expect(page.locator('[data-region="status"]')).toContainText('blinky')
    await expect(page.locator('[data-region="status"]')).toContainText('No build yet')
    await expect(page.locator('[data-region="status"]')).toContainText('No session')
    // The regions are where the grid puts them, each with room.
    const boxes = await page.evaluate(() => Object.fromEntries(['title', 'left', 'viewport', 'session', 'status'].map((r) => [r, document.querySelector(`[data-region="${r}"]`)!.getBoundingClientRect().toJSON()])))
    expect(boxes.title).toMatchObject({ x: 0, y: 0, height: 40 })
    expect(boxes.left.right).toBeLessThanOrEqual(boxes.viewport.left + 1)
    expect(boxes.viewport.right).toBeLessThanOrEqual(boxes.session.left + 1)
    expect(boxes.viewport.width).toBeGreaterThan(400)
    expect(boxes.status.y).toBeGreaterThanOrEqual(boxes.viewport.bottom - 1)
    expect(boxes.status.height).toBe(28)
  })

  test('a view is chosen with a click and with the arrow keys, and only its panel is shown', async () => {
    const { page } = open
    const tab = (name: string) => page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name })
    const shown = async (name: string): Promise<void> => {
      for (const other of ['Brief', 'Schematic', 'Board', '3D']) await expect(tab(other)).toHaveAttribute('aria-selected', String(other === name))
      await expect(page.getByRole('tabpanel')).toHaveCount(1)
      await expect(page.getByRole('tabpanel', { name })).toBeVisible()
    }
    await tab('Schematic').click()
    await shown('Schematic')
    await tab('Board').click()
    await shown('Board')
    await page.keyboard.press('ArrowRight')
    await shown('3D')
    await expect(tab('3D')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(tab('Brief')).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await shown('3D')
    // One tab stop: the chosen view's tab.
    expect(await page.getByRole('tab').evaluateAll((tabs) => tabs.map((t) => (t as HTMLElement).tabIndex))).toEqual([-1, -1, -1, 0])
  })

  test('All projects ends the project and shows the page', async () => {
    const { page } = open
    await page.getByRole('button', { name: 'Project blinky' }).click()
    const menu = page.getByRole('menu', { name: 'Projects' })
    await expect(menu.getByRole('menuitem')).toContainText(['New project…', 'All projects', 'blinky'])
    await menu.getByRole('menuitem', { name: 'All projects' }).click()
    const all = page.getByRole('main', { name: 'All projects' })
    await expect(all.getByRole('button', { name: 'blinky' })).toBeVisible()
    await expect(page.getByRole('button', { name: `Workspace ${basename(dirname(dir))}` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Project blinky' })).toHaveCount(0)
    expect(await page.evaluate(() => window.pino.workspace.current())).toMatchObject({ workspace: { root: dirname(dir) }, project: null })
  })
})
