// Fab files end to end over the engine's stand-in (serve 3): the fab's limits in the Brief from the first build, what
// blocks a release, and a release whose findings are pinned on the board.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { waitForBuild } from './helpers'
import { launch, referenceProject } from './launch'

const FABBED = { FAKE_KERNEL_SERVE: '3' }

const state = (page: Page) => page.evaluate(() => window.__pinoTest!.state())
const drawn = (page: Page) => page.evaluate(() => window.__pinoTest!.drawn())
const brief = (page: Page) => page.getByRole('tabpanel', { name: 'Brief' }).getByRole('region', { name: 'Fab', exact: true })
const openBrief = (page: Page) => page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: 'Brief' }).click()
const pill = (page: Page) => page.locator('[data-region="status"]').getByRole('button', { name: /^Fab files/ })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Fab files for JLCPCB' })

/** Whether the whole popover is on top: nothing of the view lies over any part of it. */
const onTop = (page: Page) =>
  dialog(page).evaluate((card) => {
    const box = card.getBoundingClientRect()
    const points = [0.02, 0.3, 0.6, 0.85, 0.98].flatMap((x) => [0.04, 0.5, 0.96].map((y) => [box.left + box.width * x, box.top + box.height * y]))
    const over = points.map(([x, y]) => document.elementFromPoint(x, y)).filter((el) => !card.contains(el)).map((el) => el?.className)
    // The body scrolls only when it must: nothing here is long enough to need it.
    const body = card.querySelector('.fab-body')!
    return over.length || body.scrollHeight > body.clientHeight + 1 ? JSON.stringify({ over, scroll: body.scrollHeight, client: body.clientHeight }) : true
  })

/** How many findings the pins on the view stand for: a gathered pin says its count. */
const pinned = (page: Page) =>
  page.locator('.pin').evaluateAll((pins) => pins.reduce((sum, pin) => sum + (pin.hasAttribute('data-many') ? Number(pin.textContent) : 1), 0))

async function onBoard(page: Page): Promise<void> {
  await page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: 'Board' }).click()
  await expect.poll(async () => (await drawn(page)).board?.hash ?? null).not.toBeNull()
}

test('the Brief shows the fab limits from the first build', async () => {
  const { app, page } = await launch({ project: referenceProject(), env: FABBED })
  try {
    await waitForBuild(page, 1)
    await openBrief(page)
    await expect(brief(page)).toContainText('JLC standard 2-layer')
    await expect(brief(page)).toContainText('Annular ring (copper round a hole)')
    await expect(brief(page)).toContainText("From JLC's capability page, read 2026-11-26.")
  } finally {
    await app.close()
  }
})

test('an engine without fab files shows no Fab files button', async () => {
  const { app, page } = await launch({ project: referenceProject() })
  try {
    await waitForBuild(page, 1)
    await expect(pill(page)).toHaveCount(0)
    await openBrief(page)
    await expect(brief(page)).toContainText('Nothing is asked of the fab on a card.')
    await expect(brief(page)).not.toContainText('Annular ring')
  } finally {
    await app.close()
  }
})

test('Fab files… says what blocks a release', async () => {
  const { app, page } = await launch({ project: referenceProject(), env: { ...FABBED, FAKE_KERNEL_RELEASE: 'refused' } })
  try {
    await waitForBuild(page, 1)
    await expect(pill(page)).toHaveText('Fab files…')
    await expect(pill(page)).toHaveAttribute('aria-haspopup', 'dialog')
    await pill(page).click()
    await expect(dialog(page)).toContainText('Route the board first')
    const make = dialog(page).getByRole('button', { name: 'Make fab files' })
    await expect(make).toBeDisabled()
    await expect(make).toHaveAttribute('title', 'Route the board first')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('Fab files… before the first build has landed says there is no built board yet, in those words alone', async () => {
  const { app, page } = await launch({ project: referenceProject(), env: { ...FABBED, FAKE_KERNEL_DELAY_MS: '8000' } })
  try {
    await pill(page).click()
    await expect(dialog(page).locator('[data-tone="fail"]')).toHaveText('No built board yet: fab files are made from a build. Save board.py and wait for it to build.')
    // Once the build lands, it is asked again.
    await expect(dialog(page)).toContainText('Next: v1.0.0 (first release)', { timeout: 20_000 })
    await expect(dialog(page).locator('[data-tone="fail"]')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('a release runs, shows its folder and pins its findings', async () => {
  const project = referenceProject()
  const { app, page } = await launch({ project, env: { ...FABBED, FAKE_KERNEL_RELEASE_MS: '150' } })
  try {
    await waitForBuild(page, 1)
    await onBoard(page)
    await expect(page.locator('.pin').first()).toBeVisible()
    const before = await pinned(page)
    await pill(page).click()
    await expect(dialog(page)).toContainText('Next: v1.0.0 (first release)')
    await expect.poll(() => onTop(page)).toBe(true)
    await dialog(page).getByRole('button', { name: 'Make fab files' }).click()
    await expect(pill(page)).toHaveText(/^Fab files: (start|gates|parts|gerbers|write)$/)
    await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog(page)).toContainText('fab/v1.0.0/')
    await expect(dialog(page)).toContainText('JLC places 20 parts in 12 BOM lines; 1 by hand')
    await expect(dialog(page)).toContainText("Check rotations in JLC's preview: 1 part")
    await expect(dialog(page)).toContainText('1 warning')
    await expect(dialog(page)).toContainText('fake-v1.0.0-gerbers.zip')
    await expect(dialog(page).getByRole('button', { name: 'Show in folder' })).toBeVisible()
    await expect.poll(() => onTop(page)).toBe(true)
    await expect(pill(page)).toHaveText('Fab files…')
    expect(existsSync(join(project, 'fab', 'v1.0.0', 'README.md'))).toBe(true)
    // The release's one finding with a place joins the board's pins, and the checks have their Release row.
    await expect.poll(async () => (await state(page)).fab?.result?.state).toBe('released')
    await expect.poll(() => pinned(page)).toBe(before + 1)
    await expect(page.locator('.route-card')).toContainText('Release')
  } finally {
    await app.close()
  }
})

test('a refused release lists its findings, and pointing at one lights its pin', async () => {
  const { app, page } = await launch({ project: referenceProject(), env: { ...FABBED, FAKE_KERNEL_RELEASE: 'refused' } })
  try {
    await waitForBuild(page, 1)
    await onBoard(page)
    // The popover's button is disabled while release_status says blocked: the release is started as main does it.
    await page.evaluate(() => window.pino.fab.release(window.__pinoTest!.state().project!.id))
    await expect.poll(async () => (await state(page)).fab?.result?.state).toBe('refused')
    await pill(page).click()
    await expect(dialog(page)).toContainText('Release refused: 1 error (U2 has no LCSC number)')
    await dialog(page).getByRole('button', { name: /U2 has no LCSC number, so JLC cannot place it/ }).hover()
    const base = await page.evaluate(() => window.__pinoTest!.state().build!.lastGood!.findings.length)
    await expect.poll(async () => (await state(page)).hotFinding).toBeGreaterThanOrEqual(base)
    await expect(page.locator('.pin[data-hot]')).toHaveCount(1)
  } finally {
    await app.close()
  }
})
