// The Brief, the first tab: the person's words and pictures, their cards, the sizes against the board, and what Claude
// wrote down. Over temporary projects, the engine's stand-in and the stand-in agent.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { newSession, waitForBuild } from './helpers'
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

const composer = (page: Page) => page.locator('[data-chat-composer]')
const turns = (page: Page) => page.locator('[data-region="session"] .chat-turn')

/** A prompt for the stand-in, sent as the person sends one, and waited for until its turn is over. */
async function say(page: Page, text: string): Promise<void> {
  const before = await turns(page).count()
  await composer(page).fill(text)
  await composer(page).press('Enter')
  await expect(turns(page)).toHaveCount(before + 1)
}
const addCard = (page: Page, input: object) => say(page, `tool mcp__pino__add_card ${JSON.stringify(input)}`)

/** The node of the spine a prompt's cards stand under, by its head. */
const node = (page: Page, n: number) => part(page, 'What Claude wrote down').locator('.brief-node').filter({ has: page.locator('.brief-node-head b', { hasText: new RegExp(`^Prompt ${n}$`) }) })

test("Claude's cards stand under the prompt that wrote them, a change struck in the older node", async () => {
  const { app, page } = await launch({ project: tempProject('blinky'), agent: true })
  try {
    await newSession(page.locator('[data-region="session"]'))
    await addCard(page, { kind: 'decision', text: 'Power: USB-C, 5 V' })
    await addCard(page, { card: 'C1', text: 'Power: a LiPo cell' })
    await expect(node(page, 1).locator('.brief-ghost s')).toHaveText('Power: USB-C, 5 V')
    await expect(node(page, 1).locator('.brief-ghost')).toContainText('Changed in prompt 2.')
    await expect(node(page, 1).locator('.brief-asked')).toContainText('You: tool mcp__pino__add_card')
    const now = node(page, 2).locator('[data-card="C1"]')
    await expect(now).toContainText('Power: a LiPo cell')
    await expect(now.locator('.brief-hand')).toHaveText('Claude, prompt 2')
    await expect(part(page, 'What Claude wrote down')).not.toContainText('Claude has written nothing down yet.')
    // What Claude wrote is not among the person's words.
    await expect(part(page, 'In your words')).not.toContainText('LiPo')
  } finally {
    await app.close()
  }
})

test('Make it yours gives the card to the person, and Claude may no longer change it', async () => {
  const dir = tempProject('blinky')
  const { app, page } = await launch({ project: dir, agent: true })
  try {
    await newSession(page.locator('[data-region="session"]'))
    await addCard(page, { kind: 'decision', text: 'Power: USB-C, 5 V' })
    const card = brief(page).locator('[data-card="C1"]')
    await card.getByRole('button', { name: /^C1,/ }).click()
    await card.getByRole('button', { name: 'Make it yours' }).click()
    // It is the person's now, and is edited where it stands.
    const field = card.getByRole('textbox')
    await expect(field).toHaveValue('Power: USB-C, 5 V')
    await field.press('Escape')
    await expect(card.locator('.brief-hand')).toHaveText('Yours, from prompt 1')
    expect(cardsFile(dir).cards).toMatchObject([{ id: 'C1', by: 'person', from: { by: 'agent' } }])
    await addCard(page, { card: 'C1', text: 'x' })
    // The refusal is in the tool's card, which is folded until it is opened.
    const refused = page.locator('[data-region="session"] .chat-tool[data-state="error"]')
    await refused.locator('.chat-tool-line').click()
    await expect(page.locator('[data-region="session"]')).toContainText("C1 is the person's")
    expect(cardsFile(dir).cards[0].text).toBe('Power: USB-C, 5 V')
  } finally {
    await app.close()
  }
})

test('what came since the person looked is marked new, once', async () => {
  const dir = tempProject('blinky')
  const { app, page } = await launch({ project: dir, agent: true })
  try {
    await newSession(page.locator('[data-region="session"]'))
    await addCard(page, { kind: 'decision', text: 'Power: USB-C' })
    await say(page, 'say noted')
    // The first time the Brief is looked at, nothing in it is new.
    await expect.poll(() => existsSync(join(dir, '.pino', 'brief', 'seen.json'))).toBe(true)
    await tab(page, 'Schematic').click()
    await addCard(page, { kind: 'question', text: 'Case: which enclosure?' })
    await tab(page, 'Brief').click()
    await expect(brief(page).locator('.brief-band')).toContainText('New since you looked: prompt 3')
    await expect(node(page, 3).locator('.brief-newpill')).toHaveText('new')
    // What was seen before is folded to one line, and shown again when asked.
    await expect(node(page, 1)).toHaveCount(0)
    await brief(page).getByRole('button', { name: 'Show them' }).click()
    await expect(node(page, 1).locator('.brief-newpill')).toHaveCount(0)
    await brief(page).getByRole('button', { name: 'Mark as seen' }).click()
    await expect(brief(page).locator('.brief-newpill')).toHaveCount(0)
    await expect(brief(page).locator('.brief-band')).toHaveCount(0)
    // Leaving for the page of projects keeps what was on screen as seen.
    await addCard(page, { kind: 'note', text: 'Silk: a name on it' })
    await expect(node(page, 4).locator('.brief-newpill')).toHaveText('new')
    await page.getByRole('button', { name: 'Project blinky' }).click()
    await page.getByRole('menuitem', { name: 'All projects' }).click()
    await page.getByRole('main', { name: 'All projects' }).getByRole('button', { name: 'blinky' }).click()
    await expect(brief(page).locator('[data-card="C3"]')).toBeVisible()
    await expect(brief(page).locator('.brief-newpill')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('Check stock again fills the reading and is not new since you looked', async () => {
  const dir = tempProject('blinky')
  const first = await launch({ project: dir, agent: true, env: { FAKE_KERNEL_SERVE: '3', FAKE_KERNEL_PARTS: 'offline' } })
  try {
    await newSession(first.page.locator('[data-region="session"]'))
    await addCard(first.page, { kind: 'part', lcsc: 'C25804', text: 'Pull-up: 10k' })
    await expect(brief(first.page).locator('[data-card="C1"]')).toContainText('(from 2026-11-20: jlcsearch could not be reached)')
    // Leaving the tab keeps it as seen.
    await tab(first.page, 'Schematic').click()
    await expect.poll(() => existsSync(join(dir, '.pino', 'brief', 'seen.json'))).toBe(true)
  } finally {
    await first.app.close()
  }
  const { app, page } = await launch({ project: dir, env: { FAKE_KERNEL_SERVE: '3' } })
  try {
    await tab(page, 'Brief').click()
    const card = brief(page).locator('[data-card="C1"]')
    await card.getByRole('button', { name: /^C1,/ }).click()
    await card.getByRole('button', { name: 'Check stock again' }).click()
    await expect(card).toContainText('basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)')
    await expect(brief(page).locator('.brief-newpill')).toHaveCount(0)
    await expect(brief(page).locator('.brief-band')).toHaveCount(0)
    expect(cardsFile(dir).cards[0]).not.toHaveProperty('was')
  } finally {
    await app.close()
  }
})

test("a part of the person's own has its stock checked from their words, and a lookup that fails says why", async () => {
  const dir = tempProject('blinky')
  writeCards(dir, [{ id: 'C1', kind: 'part', by: 'person', text: 'pull-up', part: { lcsc: 'C25804' } }])
  const { app, page } = await launch({ project: dir, env: { FAKE_KERNEL_SERVE: '2' } })
  try {
    const row = part(page, 'In your words').locator('[data-card="C1"]')
    await expect(row).toContainText('C25804 · stock not checked')
    await row.hover()
    await row.getByRole('button', { name: 'Check stock again' }).click()
    await expect(brief(page).locator('.brief-problem')).toContainText('The engine is too old for parts')
    expect(cardsFile(dir).cards[0].part).toEqual({ lcsc: 'C25804' })
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
