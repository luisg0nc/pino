import { writeFileSync } from 'node:fs'
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { Target } from '../src/shared/board/refs'

/** An item of the dock's More menu, chosen as a person does. */
export async function fromMore(dock: Locator, item: string): Promise<void> {
  await dock.getByRole('button', { name: 'More', exact: true }).click()
  await dock.page().getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: item, exact: true }).click()
}

/**
 * "New session" in the dock, wherever a person finds it: the button of the pane with no session, or, with one (live or
 * ended), the item of the header's More menu.
 */
export async function newSession(dock: Locator): Promise<void> {
  const plain = dock.getByRole('button', { name: 'New session', exact: true })
  await expect(plain.or(dock.getByRole('button', { name: 'More', exact: true }))).toBeVisible()
  if (await plain.isVisible()) await plain.click()
  else await fromMore(dock, 'New session')
}

/** The model, edits or effort list of the dock, as a person reaches it: the header's model button is pressed, if its menu is not up. */
export async function inModelMenu(dock: Locator, name: 'Model' | 'Edits' | 'Effort'): Promise<Locator> {
  const list = dock.getByRole('combobox', { name, exact: true })
  if (!(await list.isVisible())) await dock.locator('button.session-model').click()
  await expect(list).toBeVisible()
  return list
}

/** The model button's menu put away, if it is up. */
export async function closeModelMenu(dock: Locator): Promise<void> {
  if (await dock.getByRole('combobox', { name: 'Model', exact: true }).isVisible()) await dock.locator('button.session-model').click()
  await expect(dock.getByRole('combobox', { name: 'Model', exact: true })).toHaveCount(0)
}

/** What the dock's More menu offers right now, in order: it is opened, read and put away again. */
export async function moreItems(dock: Locator): Promise<string[]> {
  await dock.getByRole('button', { name: 'More', exact: true }).click()
  const menu = dock.page().getByRole('menu', { name: 'More' })
  await expect(menu).toBeVisible()
  const items = (await menu.getByRole('menuitem').allTextContents()).map((t) => t.trim())
  await dock.page().keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  return items
}

const captured = new WeakSet<ElectronApplication>()

/**
 * The window as it is drawn, to a PNG file: main's `capturePage`, since Playwright's own screenshot hangs on a hidden
 * window.
 * Once for each launch: a hidden window gives one picture, and the next call never returns.
 */
export async function capture(app: ElectronApplication, file: string): Promise<void> {
  if (captured.has(app)) throw new Error('a hidden window gives one picture a launch: launch again for another')
  captured.add(app)
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(file, Buffer.from(png, 'base64'))
}

/** The window's content at this size, and the page told of it. */
export async function resize(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height })
  await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([width, height])
}

/** Waits until build `n` has landed and the Board tab (or whichever is chosen) has drawn it. */
export async function waitForBuild(page: Page, n: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__pinoTest!.state().build?.lastGood?.number ?? 0), { timeout: 20_000 }).toBeGreaterThanOrEqual(n)
}

/** Two frames: what was changed is on the canvas. */
export const settled = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))

/** Where on screen a thing is in the chosen view, once the view says. */
export async function screenOf(page: Page, target: Target): Promise<{ x: number; y: number }> {
  await expect.poll(() => page.evaluate((t) => window.__pinoTest!.screenOf(t) !== null, target)).toBe(true)
  return (await page.evaluate((t) => window.__pinoTest!.screenOf(t), target))!
}

/** A click on a thing in the chosen view. */
export async function clickTarget(page: Page, target: Target): Promise<void> {
  const at = await screenOf(page, target)
  await page.mouse.click(at.x, at.y)
}
