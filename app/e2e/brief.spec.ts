// The Brief, the first tab: the person's words and pictures, their cards, the sizes against the board, and what Claude
// wrote down. Over temporary projects, the engine's stand-in and the stand-in agent.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { waitForBuild } from './helpers'
import { launch, referenceProject, tempFolder, tempProject } from './launch'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const state = (page: Page) => page.evaluate(() => window.__pinoTest!.state())
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Views' }).getByRole('tab')
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name })
const brief = (page: Page) => page.getByRole('tabpanel', { name: 'Brief' })
const part = (page: Page, name: string) => brief(page).getByRole('region', { name, exact: true })

const cardsFile = (dir: string): { next: number; cards: Array<Record<string, unknown>> } => JSON.parse(readFileSync(join(dir, '.pino', 'brief', 'cards.json'), 'utf8'))

function writeCards(dir: string, cards: object[]): void {
  mkdirSync(join(dir, '.pino', 'brief'), { recursive: true })
  writeFileSync(join(dir, '.pino', 'brief', 'cards.json'), JSON.stringify({ next: cards.length + 1, cards }))
}

/** A project with words, a photo and a PDF of reference/, and cards of the person's. */
function describedProject(): string {
  const dir = tempProject('blinky')
  writeFileSync(join(dir, 'brief.md'), '# blinky\n\nA board that blinks one LED. See https://example.org/led for the part.\n\n## References\n\n- reference/photo-1.png: the old board\n- reference/datasheet.pdf\n')
  mkdirSync(join(dir, 'reference'))
  writeFileSync(join(dir, 'reference', 'photo-1.png'), PNG)
  writeFileSync(join(dir, 'reference', 'datasheet.pdf'), '%PDF-1.4\n')
  writeCards(dir, [
    { id: 'C1', kind: 'frame', by: 'person', name: 'Power' },
    { id: 'C2', kind: 'power', by: 'person', frame: 'C1', text: 'USB-C, 5 V, 0.5 A' },
    { id: 'C3', kind: 'rule', by: 'person', text: '0603 or larger' },
    { id: 'C4', kind: 'fab', by: 'person', fab: { layers: 2, thickness: 1.6, assembly: 'jlc', boards: 5 } }
  ])
  return dir
}

test('a project with no board.py opens on the Brief with its words, its picture and its cards', async () => {
  const dir = describedProject()
  const { app, page } = await launch({ project: dir })
  try {
    await expect(tabs(page)).toHaveText(['Brief', 'Schematic', 'Board', '3D'])
    await expect(tab(page, 'Brief')).toHaveAttribute('aria-selected', 'true')
    const words = part(page, 'In your words')
    await expect(words).toContainText('A board that blinks one LED.')
    // The name on top and the list of files are pino's own lines, not shown among the words.
    await expect(words.locator('.brief-words')).not.toContainText('References')
    await expect(words.getByRole('link', { name: /example\.org/ })).toBeVisible()
    const photo = words.getByRole('img', { name: 'the old board' })
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
    await expect(words.locator('.brief-tile')).toContainText('the old board')
    await expect(words.locator('.brief-ref')).toContainText('datasheet.pdf')
    const power = words.getByRole('region', { name: 'Power' })
    await expect(power).toContainText('USB-C, 5 V, 0.5 A')
    await expect(power.locator('.brief-hand')).toHaveText('You')
    await expect(part(page, 'What Claude wrote down')).toContainText('Claude has written nothing down yet.')
    await expect(part(page, 'Rules')).toContainText('0603 or larger')
    await expect(part(page, 'Fab')).toContainText('You asked for 2 layers, 1.6 mm, JLC assembles it, 5 boards')
    // No band of a view stands over the page.
    await expect(page.locator('.band')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('follows brief.md changed and removed from outside', async () => {
  const dir = tempProject('blinky')
  const { app, page } = await launch({ project: dir })
  try {
    await expect(part(page, 'In your words')).toContainText('brief.md has no words yet.')
    writeFileSync(join(dir, 'brief.md'), '# blinky\n\nNow with a buzzer.\n')
    await expect(brief(page).locator('.brief-words')).toContainText('Now with a buzzer.', { timeout: 2000 })
    rmSync(join(dir, 'brief.md'))
    await expect(brief(page).getByText('No brief.md yet. Write what the board does there, or tell Claude.')).toBeVisible({ timeout: 2000 })
  } finally {
    await app.close()
  }
})

test("a note added on the page is the person's card, in the file; removed, it can be put back", async () => {
  const dir = tempProject('blinky')
  const { app, page } = await launch({ project: dir })
  try {
    await brief(page).getByRole('button', { name: 'Add a note' }).click()
    const field = brief(page).getByRole('textbox', { name: 'New note' })
    await field.fill('ask about the case')
    await field.press('Enter')
    await expect(part(page, 'In your words')).toContainText('ask about the case')
    expect(cardsFile(dir).cards).toMatchObject([{ id: 'C1', kind: 'note', by: 'person', text: 'ask about the case' }])
    await brief(page).locator('.brief-note').hover()
    await brief(page).getByRole('button', { name: 'Remove the note' }).click()
    await expect(brief(page).locator('.brief-note')).toHaveCount(0)
    await brief(page).getByRole('button', { name: 'Undo' }).click()
    await expect(brief(page).locator('.brief-note')).toContainText('ask about the case')
    // The person's own words are never written by the page.
    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toBe('# blinky\n')
    // A cards file pulled from elsewhere is taken up while the page is open.
    writeCards(dir, [{ id: 'C1', kind: 'note', by: 'person', text: 'from a pull' }])
    await expect(brief(page).locator('.brief-note')).toContainText('from a pull', { timeout: 3000 })
  } finally {
    await app.close()
  }
})

test('a board built opens on the views next time; the route card opens the Brief', async () => {
  const dir = referenceProject('reference')
  const profile = tempFolder('profile')
  const first = await launch({ project: dir, env: { PINO_TEST_PROFILE: profile } })
  try {
    await waitForBuild(first.page, 1)
    await expect(tab(first.page, 'Schematic')).toHaveAttribute('aria-selected', 'true')
    await first.page.locator('[data-region="left"]').getByRole('button', { name: 'Open the Brief' }).click()
    await expect(tab(first.page, 'Brief')).toHaveAttribute('aria-selected', 'true')
    await expect(brief(first.page)).toBeVisible()
  } finally {
    await first.app.close()
  }
  const { app, page } = await launch({ env: { PINO_TEST_PROFILE: profile, PINO_CONFIG: first.config } })
  try {
    await expect(tab(page, 'Brief')).toHaveAttribute('aria-selected', 'true')
    expect((await state(page)).tab).toBe('brief')
  } finally {
    await app.close()
  }
})

test("the board's width beside the person's size, marked when they differ", async () => {
  const dir = referenceProject('reference')
  writeCards(dir, [
    { id: 'C1', kind: 'size', by: 'person', size: { what: 'Board width', value: '50', unit: 'mm', source: 'a guess' } },
    { id: 'C2', kind: 'size', by: 'person', size: { what: 'Board height', value: '44', unit: 'mm', source: 'measured' } }
  ])
  const { app, page } = await launch({ project: dir })
  try {
    await waitForBuild(page, 1)
    await tab(page, 'Brief').click()
    const width = brief(page).locator('[data-card="C1"]')
    await expect(width).toContainText('the board is 56 mm')
    await expect(width).toHaveAttribute('data-differs', '')
    const height = brief(page).locator('[data-card="C2"]')
    await expect(height).toContainText('the board is 44 mm')
    await expect(height).not.toHaveAttribute('data-differs')
    await brief(page).getByRole('button', { name: 'Add a size' }).click()
    const form = brief(page).getByRole('group', { name: 'Size' })
    await form.getByRole('textbox', { name: 'What it measures' }).fill('USB-C offset')
    await form.getByRole('textbox', { name: 'Value' }).fill('3')
    await form.getByRole('button', { name: 'Add' }).click()
    await expect(brief(page).locator('[data-card="C3"]')).toContainText('USB-C offset')
    await expect(brief(page).locator('[data-card="C3"]')).not.toContainText('the board is')
  } finally {
    await app.close()
  }
})
