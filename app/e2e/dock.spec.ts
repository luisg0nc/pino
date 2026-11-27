// The session dock's width: its left edge is dragged or moved with the keys (torno's), within limits, and the window
// keeps it. The window is 1440 wide: the dock's narrow default (384) beside the card (264).

import { expect, test, type Page } from '@playwright/test'
import { launch, tempFolder, tempProject } from './launch'

const dock = (page: Page) => page.locator('[data-region="session"]')
const edge = (page: Page) => page.getByRole('separator', { name: 'Resize session' })
const width = async (page: Page) => (await dock(page).boundingBox())!.width
const kept = (page: Page) => page.evaluate(() => localStorage.getItem('pino.dock'))

async function dragEdgeBy(page: Page, dx: number): Promise<void> {
  const at = (await edge(page).boundingBox())!
  const x = at.x + at.width / 2
  const y = at.y + at.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 4 })
  await page.mouse.up()
}

test('the session dock is resized by dragging its edge and with the arrow keys, within limits', async () => {
  const { app, page } = await launch({ project: tempProject() })
  try {
    await expect(edge(page)).toBeVisible()
    expect(await width(page)).toBe(384)
    const chat = (await dock(page).locator('.session-body').boundingBox())!.width

    // A press that moves nothing keeps the window's default: nothing is written.
    await dragEdgeBy(page, 0)
    expect(await kept(page)).toBeNull()

    await dragEdgeBy(page, -100)
    expect(await width(page)).toBe(484)
    // The chat in it is as much wider.
    expect((await dock(page).locator('.session-body').boundingBox())!.width).toBe(chat + 100)
    expect(await kept(page)).toBe('484')
    await expect(edge(page)).toHaveAttribute('aria-valuenow', '484')
    // Dragged with the pointer, the edge is done with: it keeps no focus.
    await expect(edge(page)).not.toBeFocused()

    // It stops at a minimum width rather than vanishing...
    await dragEdgeBy(page, 900)
    expect(await width(page)).toBe(320)
    // ...and at a maximum that keeps 420 px of view free beside the card.
    await dragEdgeBy(page, -1400)
    expect((await dock(page).boundingBox())!.x).toBe(264 + 420)

    // The edge also answers to the arrow keys, 16 px a press.
    await edge(page).focus()
    const widest = await width(page)
    await page.keyboard.press('ArrowRight')
    expect(await width(page)).toBe(widest - 16)
    await page.keyboard.press('ArrowLeft')
    expect(await width(page)).toBe(widest)
    await page.keyboard.press('ArrowLeft')
    expect(await width(page)).toBe(widest)
    expect(await kept(page)).toBe(String(widest))
  } finally {
    await app.close()
  }
})

// torno's #361: what the drag wrote on the shell stayed, over the default of every window after it.
test("a drag of the dock's edge that ends where it began leaves the window's default to follow its width", async () => {
  const { app, page } = await launch({ project: tempProject() })
  // What stands over the CSS default: a spec never resizes the window, so this is what is read.
  const inline = () => page.locator('.shell').evaluate((el: HTMLElement) => el.style.getPropertyValue('--dock-w'))
  try {
    await expect(edge(page)).toBeVisible()
    const at = (await edge(page).boundingBox())!
    const x = at.x + at.width / 2
    const y = at.y + at.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 100, y, { steps: 4 })
    await expect.poll(() => width(page)).toBe(484)
    expect(await inline()).toBe('484px')
    await page.mouse.move(x, y, { steps: 4 })
    await page.mouse.up()
    expect(await width(page)).toBe(384)
    expect(await kept(page)).toBeNull()
    expect(await inline()).toBe('')

    // With a width kept, the one on the shell stays.
    await dragEdgeBy(page, -100)
    await dragEdgeBy(page, 0)
    expect(await inline()).toBe('484px')
    expect(await kept(page)).toBe('484')
  } finally {
    await app.close()
  }
})

test('a dock width the person set is kept across a reload and a relaunch', async () => {
  const dir = tempProject()
  // One profile for both launches, as the person has one: a test run's own is removed when it ends.
  const env = { PINO_TEST_PROFILE: tempFolder('profile') }
  const first = await launch({ project: dir, env })
  try {
    await dragEdgeBy(first.page, -130)
    expect(await width(first.page)).toBe(514)
    await first.page.reload()
    await first.page.waitForSelector('[data-region="session"]')
    expect(await width(first.page)).toBe(514)
  } finally {
    await first.app.close()
  }
  const second = await launch({ project: dir, env })
  try {
    expect(await second.app.evaluate(({ app }) => app.getPath('userData'))).toBe(env.PINO_TEST_PROFILE)
    await expect.poll(() => width(second.page)).toBe(514)
  } finally {
    await second.app.close()
  }
})
