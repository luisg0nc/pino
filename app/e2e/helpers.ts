import { expect, type Locator } from '@playwright/test'

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
