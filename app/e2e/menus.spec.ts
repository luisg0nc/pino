// The menus that hang from a button (the folder menu of the title bar, the session dock's More, the view cube's "···"):
// each is a card over what is under it, its rows plain until pointed at, and no row's words lie over another's.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { newSession, waitForBuild } from './helpers'
import { launch, referenceProject, tempFolder, tempProject } from './launch'

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
test('the folder menu is a card, each recent folder two lines of its own: nothing overlaps, and the focus ring keeps off the other rows', async () => {
  const open = tempProject('blinky')
  const other = tempFolder('a-folder-with-a-long-name')
  const config = join(tempFolder('config'), 'config.json')
  writeFileSync(config, JSON.stringify({ project: open, recent: [open, other, join(other, 'gone')] }))
  const { app, page } = await launch({ env: { PINO_CONFIG: config } })
  try {
    await page.getByRole('button', { name: 'Project blinky' }).click()
    const menu = page.getByRole('menu', { name: 'Projects' })
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
