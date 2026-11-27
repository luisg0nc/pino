// The menus that hang from a button (the folder menu of the title bar, the session dock's More, the view cube's "···"):
// each is a card over what is under it, its rows plain until pointed at, and no row's words lie over another's.

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { newSession, waitForBuild } from './helpers'
import { launch, referenceProject, tempFolder, tempProject } from './launch'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

/** How a menu and its first row are drawn. */
const drawn = (menu: Locator) =>
  menu.evaluate((el) => {
    const card = el.classList.contains('menu') ? el : el.closest('.popover')!
    const of = getComputedStyle(card)
    const item = getComputedStyle(el.querySelector('[role="menuitem"]:not(:disabled)')!)
    return { position: of.position, background: of.backgroundColor, shadow: of.boxShadow, itemBorder: item.borderTopStyle }
  })

/** The menu's own card, and rows that are no bare buttons of the system's. */
async function isACard(menu: Locator): Promise<void> {
  const how = await drawn(menu)
  expect(how.position).toMatch(/absolute|fixed/)
  expect(how.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(how.shadow).not.toBe('none')
  expect(how.itemBorder).toBe('none')
}

// torno's #330: the rows were held to a menu item's 26 px, so each folder's path lay over its name and the focus ring cut the row under it.
test('the workspace menu is a card, each recent workspace two lines of its own: nothing overlaps, and the focus ring keeps off the other rows', async () => {
  const open = tempProject('blinky')
  const workspace = dirname(open)
  const other = tempFolder('a-folder-with-a-long-name')
  const config = join(tempFolder('config'), 'config.json')
  writeFileSync(config, JSON.stringify({ workspace, project: open, workspaces: [workspace, other, join(other, 'gone')] }))
  const { app, page } = await launch({ env: { PINO_CONFIG: config } })
  try {
    await page.getByRole('button', { name: `Workspace ${basename(workspace)}` }).click()
    const menu = page.getByRole('menu', { name: 'Workspaces' })
    await expect(menu.locator('.folder-row')).toHaveCount(3)
    await isACard(menu)
    const laid = await menu.evaluate((el) => {
      const box = (e: Element) => {
        const r = e.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
      }
      return {
        menu: box(el),
        rows: [...el.querySelectorAll('.folder-row')].map((row) => ({
          row: box(row),
          item: box(row.querySelector('.folder-item')!),
          name: box(row.querySelector('.folder-name')!),
          path: box(row.querySelector('.folder-path')!),
          // Where the words themselves start and end, their element's padding aside.
          said: [...row.querySelectorAll('.folder-said')].map((word) => ({ left: box(word).left, right: box(word).right - parseFloat(getComputedStyle(word).paddingRight) })),
          lines: [...row.querySelectorAll('.folder-name, .folder-path')].map((line) => [line.clientHeight, parseFloat(getComputedStyle(line).fontSize)])
        })),
        // Every row of the menu in turn, the lines between them too: none starts before the one above ends.
        all: [...el.children].map(box)
      }
    })
    // Half a pixel of room for rounding.
    const slack = 0.5
    for (let i = 1; i < laid.all.length; i += 1) expect(laid.all[i - 1].bottom).toBeLessThanOrEqual(laid.all[i].top + slack)
    for (const { item, name, path, said, lines } of laid.rows) {
      // Each line is as tall as its text, the path under the name, both inside the row's button with air above and below.
      for (const [height, font] of lines) expect(height).toBeGreaterThanOrEqual(font)
      expect(name.bottom).toBeLessThanOrEqual(path.top + slack)
      expect(name.top - item.top).toBeGreaterThanOrEqual(3)
      expect(item.bottom - path.bottom).toBeGreaterThanOrEqual(3)
      // What a row says beside it stays clear of its lines and of the menu's edge.
      for (const word of said) {
        expect(word.left).toBeGreaterThanOrEqual(item.right)
        expect(word.right).toBeLessThanOrEqual(laid.menu.right - 8)
      }
    }
    // The one folder to open, reached by the keys: its ring is round its own row and over no other row's words.
    const item = menu.locator('.folder-item:enabled')
    await page.keyboard.press('Home')
    await expect(item).toBeFocused()
    const ring = await item.evaluate((el) => {
      const style = getComputedStyle(el)
      const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
      const r = el.getBoundingClientRect()
      return { style: style.outlineStyle, top: r.top - reach, bottom: r.bottom + reach, left: r.left - reach }
    })
    expect(ring.style).toBe('solid')
    expect(ring.left).toBeGreaterThanOrEqual(laid.menu.left)
    expect(ring.top).toBeGreaterThanOrEqual(laid.rows[0].path.bottom)
    expect(ring.bottom).toBeLessThanOrEqual(laid.rows[2].name.top)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  } finally {
    await app.close()
  }
})

// torno's #367: its page of projects heard every key first and kept the menu's own from it. pino's pages with the title
// bar leave a menu its keys, and this holds them to it.
test('on the page of projects and the New project page the folder menu has its keys: the arrows move in it, Escape closes it and the page stays', async () => {
  const open = tempProject('blinky')
  const workspace = dirname(open)
  const other = tempFolder('another-workspace')
  const config = join(tempFolder('config'), 'config.json')
  writeFileSync(config, JSON.stringify({ workspace, workspaces: [workspace, other] }))
  const { app, page } = await launch({ env: { PINO_CONFIG: config } })
  try {
    const projects = page.getByRole('main', { name: 'All projects' })
    const fresh = page.getByRole('region', { name: 'New project' })
    const button = page.getByRole('button', { name: `Workspace ${basename(workspace)}` })
    const menu = page.getByRole('menu', { name: 'Workspaces' })
    const walk = async (): Promise<void> => {
      await button.click()
      await expect(menu.locator('.folder-item:enabled')).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(menu.getByRole('menuitem', { name: 'Open workspace…' })).toBeFocused()
      await page.keyboard.press('Home')
      await expect(menu.locator('.folder-item:enabled')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expect(button).toBeFocused()
    }
    await expect(projects).toBeVisible()
    await walk()
    await expect(projects).toBeVisible()
    await projects.getByRole('button', { name: 'New project' }).click()
    await expect(fresh).toBeVisible()
    await walk()
    await expect(fresh).toBeVisible()
  } finally {
    await app.close()
  }
})

// The same with a picture of the Brief open large: it heard every Escape first, and the menu is drawn over it.
test('over a Brief picture opened large, Escape closes the folder menu first, then the picture', async () => {
  const dir = tempProject('blinky')
  writeFileSync(join(dir, 'brief.md'), '# blinky\n\n## References\n\n- reference/photo-1.png: the old board\n')
  mkdirSync(join(dir, 'reference'))
  writeFileSync(join(dir, 'reference', 'photo-1.png'), PNG)
  const { app, page } = await launch({ project: dir })
  try {
    await page.getByRole('img', { name: 'the old board' }).click()
    const picture = page.getByRole('dialog', { name: 'the old board' })
    await expect(picture).toBeVisible()
    const button = page.getByRole('button', { name: /^Workspace / })
    await button.click()
    const menu = page.getByRole('menu', { name: 'Workspaces' })
    await expect(menu.getByRole('menuitem', { name: 'Open workspace…' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(button).toBeFocused()
    await expect(picture).toBeVisible()
    // With the menu gone, the next Escape is the picture's, wherever the focus is.
    await page.keyboard.press('Escape')
    await expect(picture).toHaveCount(0)
  } finally {
    await app.close()
  }
})

// torno's #367: the menu comes when the list of folders has been read, and the focus went into it only some time after it
// was drawn.
test('the folder menu has the keys as soon as it is drawn: an Escape pressed at once closes it', async () => {
  const { app, page } = await launch({ project: tempProject('blinky') })
  try {
    // Escape from where the focus is, in the very task that put the menu there: no key of a person or a test can be sooner.
    await page.evaluate(() => {
      const seen = window as unknown as { __escaped?: boolean }
      seen.__escaped = false
      new MutationObserver((_changes, watching) => {
        if (!document.querySelector('.folder-menu')) return
        watching.disconnect()
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        seen.__escaped = true
      }).observe(document.body, { subtree: true, childList: true })
    })
    await page.getByRole('button', { name: /^Workspace / }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __escaped?: boolean }).__escaped)).toBe(true)
    await expect(page.getByRole('menu', { name: 'Workspaces' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test("the session dock's More menu is a card of rows, one under another", async () => {
  const { app, page } = await launch({ project: tempProject('blinky'), agent: true })
  try {
    const dock = page.locator('[data-region="session"]')
    await newSession(dock)
    await dock.getByRole('button', { name: 'More', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'More' })
    await isACard(menu)
    const rows = await menu.getByRole('menuitem').evaluateAll((items) => items.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))
    expect(rows.length).toBeGreaterThan(1)
    for (let i = 1; i < rows.length; i += 1) expect(rows[i - 1].bottom).toBeLessThanOrEqual(rows[i].top)
    for (const row of rows) expect(row.width).toBe(rows[0].width)
  } finally {
    await app.close()
  }
})

test("the view cube's menu is a card under the cube, inside the window", async () => {
  const { app, page } = await launch({ project: referenceProject() })
  try {
    await waitForBuild(page, 1)
    await page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: '3D' }).click()
    const dots = page.getByRole('button', { name: 'More views' })
    await dots.click()
    const menu = page.locator('.cube-menu')
    await isACard(menu)
    const box = (await menu.boundingBox())!
    const from = (await dots.boundingBox())!
    const view = (await page.locator('[data-region="viewport"]').boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(from.y + from.height)
    expect(box.x + box.width).toBeLessThanOrEqual(view.x + view.width)
    const rows = await menu.getByRole('menuitem').evaluateAll((items) => items.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))
    expect(rows).toHaveLength(3)
    for (let i = 1; i < rows.length; i += 1) expect(rows[i - 1].bottom).toBeLessThanOrEqual(rows[i].top)
    // It lies over the view: nothing is drawn on top of it.
    await expect.poll(() => menu.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
    })).toBe(true)
  } finally {
    await app.close()
  }
})
