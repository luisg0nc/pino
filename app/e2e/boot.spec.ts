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

  test('the window is the grid: title, route card with an empty Brief, three views, the dock and the status line', async () => {
    const { page } = open
    for (const r of ['title', 'left', 'viewport', 'session', 'status']) await expect(page.locator(`[data-region="${r}"]`)).toBeVisible()
    await expect(page.locator('[data-region="left"] h2')).toHaveText('blinky')
    await expect(page.locator('[data-region="left"]')).toContainText('No brief yet.')
    await expect(page.locator('[data-region="left"]')).toContainText('Tell Claude what the board is for. It keeps the brief in brief.md.')
    await expect(page.getByRole('tablist', { name: 'Views' }).getByRole('tab')).toHaveText(['Schematic', 'Board', '3D'])
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
      for (const other of ['Schematic', 'Board', '3D']) await expect(tab(other)).toHaveAttribute('aria-selected', String(other === name))
      await expect(page.getByRole('tabpanel')).toHaveCount(1)
      await expect(page.getByRole('tabpanel', { name })).toBeVisible()
    }
    await shown('Schematic')
    await tab('Board').click()
    await shown('Board')
    await page.keyboard.press('ArrowRight')
    await shown('3D')
    await expect(tab('3D')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await shown('Schematic')
    await page.keyboard.press('ArrowLeft')
    await shown('3D')
    // One tab stop: the chosen view's tab.
    expect(await page.getByRole('tab').evaluateAll((tabs) => tabs.map((t) => (t as HTMLElement).tabIndex))).toEqual([-1, -1, 0])
  })

  test('Close project goes back to the first screen', async () => {
    const { page } = open
    await page.getByRole('button', { name: 'Project blinky' }).click()
    const menu = page.getByRole('menu', { name: 'Projects' })
    await expect(menu.getByRole('menuitem')).toContainText(['Open folder…', 'Close project'])
    await expect(menu.locator('.folder-row[data-open]')).toContainText('current')
    await menu.getByRole('menuitem', { name: 'Close project' }).click()
    await expect(page.locator('.plate')).toContainText('pino')
    await expect(page.getByRole('navigation', { name: 'Recent folders' })).toContainText(dir)
    expect(await page.evaluate(() => window.pino.project.current())).toBeNull()
  })
})
