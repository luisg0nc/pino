import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launch, tempFolder, tempProject } from './launch'

// A menu of the title bar, opened while a sheet is up (the Brief's picture opened large, the ink pad): it is drawn over
// the sheet, and an Escape with the focus in it is the menu's; the next one is the sheet's. The window is hidden:
// everything is read from the DOM.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const workspaceButton = (page: Page): Locator => page.locator('.title-row').getByRole('button', { name: /^Workspace / })
const projectButton = (page: Page): Locator => page.locator('.title-row').getByRole('button', { name: /^Project / })

/** Whether a menu is the topmost thing over the whole of its box: sampled in a grid, just inside its rounded edge. */
const seenWhole = (menu: Locator): Promise<boolean> =>
  menu.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const along = (from: number, to: number): number[] => [0, 0.25, 0.5, 0.75, 1].map((t) => from + 4 + t * (to - from - 8))
    return along(box.left, box.right).every((x) => along(box.top, box.bottom).every((y) => el.contains(document.elementFromPoint(x, y))))
  })

/** Opens a menu of the title bar over a sheet: it is seen whole, an Escape closes it and leaves the sheet, the next one is the sheet's. */
async function menuFirst(page: Page, button: Locator, name: 'Workspaces' | 'Projects', sheet: Locator, after: () => Promise<void>): Promise<void> {
  await button.click()
  const menu = page.getByRole('menu', { name })
  await expect(menu.getByRole('menuitem').first()).toBeVisible()
  expect(await seenWhole(menu)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(button).toBeFocused()
  await expect(sheet).toBeVisible()
  // With the menu gone, the next Escape is the sheet's, wherever the focus is.
  await page.keyboard.press('Escape')
  await after()
}

test('over a Brief picture opened large, a title bar menu is seen whole and Escape closes it first, then the picture', async () => {
  const dir = tempProject('blinky')
  writeFileSync(join(dir, 'brief.md'), '# blinky\n\n## References\n\n- reference/photo-1.png: the old board\n')
  mkdirSync(join(dir, 'reference'))
  writeFileSync(join(dir, 'reference', 'photo-1.png'), PNG)
  const { app, page } = await launch({ project: dir })
  try {
    for (const [button, name] of [[workspaceButton(page), 'Workspaces'], [projectButton(page), 'Projects']] as const) {
      await page.getByRole('img', { name: 'the old board' }).click()
      const picture = page.getByRole('dialog', { name: 'the old board' })
      await expect(picture).toBeVisible()
      await menuFirst(page, button, name, picture, () => expect(picture).toHaveCount(0))
    }
  } finally {
    await app.close()
  }
})

test('over the doodle board of a new project, the workspace menu is seen whole and Escape closes it first, then the board', async () => {
  const root = tempFolder('workspace')
  const config = join(tempFolder('config'), 'config.json')
  writeFileSync(config, JSON.stringify({ workspace: root, workspaces: [root, dirname(tempProject('elsewhere'))] }))
  // An empty workspace opens on the New project page.
  const { app, page } = await launch({ env: { PINO_CONFIG: config } })
  try {
    await page.getByRole('button', { name: /^Sketch it/ }).click()
    const board = page.getByRole('dialog', { name: 'Doodle board' })
    await expect(board).toBeVisible()
    await menuFirst(page, workspaceButton(page), 'Workspaces', board, () => expect(board).toHaveCount(0))
  } finally {
    await app.close()
  }
})
