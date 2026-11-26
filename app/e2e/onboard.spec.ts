// The New project page: nothing is written before the project is made, then it is made whole.
import { mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { agentsIn, launch, tempFolder, type Launched } from './launch'

const state = (page: Page) => page.evaluate(() => window.__pinoTest!.state())
const newPage = (page: Page) => page.getByRole('region', { name: 'New project' })
const name = (page: Page) => newPage(page).getByRole('textbox', { name: 'Name' })
const what = (page: Page) => newPage(page).getByRole('textbox', { name: 'What it does' })
const makeIt = (page: Page) => newPage(page).getByRole('button', { name: 'or make it without starting Claude' })

/** A PNG of one grey pixel. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==', 'base64')

/** Every file under a folder, relative and sorted. */
function files(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]))
    .sort()
}

/** A launch on an empty workspace, which opens on the New project page. */
async function onEmpty(opts: { agent?: boolean; env?: Record<string, string>; root?: string } = {}): Promise<Launched & { root: string }> {
  const root = opts.root ?? tempFolder('workspace')
  const config = join(tempFolder('config'), 'config.json')
  writeFileSync(config, JSON.stringify({ workspace: root, workspaces: [root] }))
  const run = await launch({ agent: opts.agent, env: { PINO_CONFIG: config, ...opts.env } })
  return { ...run, root }
}

/** What the photo and PDF dialogs answer from here on. */
const pick = (run: Launched, paths: string[]) =>
  run.app.evaluate((_main, picked) => {
    ;(globalThis as unknown as { __pinoMain: { pickFiles: string[] | null } }).__pinoMain.pickFiles = picked
  }, paths)

/** A photo on the disk, chosen through the page's dialog. */
async function addPhoto(run: Launched): Promise<string> {
  const photo = join(tempFolder('photos'), 'desk.png')
  writeFileSync(photo, PNG)
  await pick(run, [photo])
  await newPage(run.page).getByRole('button', { name: 'Add photos' }).click()
  await expect(newPage(run.page).getByRole('listitem', { name: 'Photo photo 1' })).toBeVisible()
  return photo
}

test('an empty workspace opens on the New project page, and nothing is written before Make it', async () => {
  const run = await onEmpty()
  const { app, page, root } = run
  try {
    await expect(newPage(page).getByRole('heading', { name: 'New project' })).toBeVisible()
    await expect(name(page)).toBeFocused()
    await expect(makeIt(page)).toBeDisabled()
    await name(page).fill('blinky')
    await what(page).fill('Blinks an LED.')
    await addPhoto(run)
    await expect(newPage(page).getByRole('complementary', { name: 'The first prompt' })).toContainText('blinky/')
    await expect(makeIt(page)).toBeEnabled()
    await expect(newPage(page).getByRole('button', { name: 'Start: make the project and ask Claude' })).toBeDisabled()
    expect(readdirSync(root)).toEqual([])
    // Escape leaves the page and keeps the draft; Discard asks, then empties it.
    await name(page).press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('main', { name: 'All projects' })).toContainText('No boards here yet.')
    await page.getByRole('main', { name: 'All projects' }).getByRole('button', { name: 'New project' }).click()
    await expect(name(page)).toHaveValue('blinky')
    await newPage(page).getByRole('button', { name: 'Discard' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click()
    await page.getByRole('main', { name: 'All projects' }).getByRole('button', { name: 'New project' }).click()
    await expect(name(page)).toHaveValue('')
    expect(readdirSync(root)).toEqual([])
  } finally {
    await app.close()
  }
})

test('Make it without starting Claude makes the folder whole and opens it on the Brief', async () => {
  const run = await onEmpty({ agent: true })
  const { app, page, root } = run
  try {
    await name(page).fill('blinky')
    await what(page).fill('Blinks an LED.')
    await addPhoto(run)
    await newPage(page).getByRole('button', { name: 'Size and shape' }).click()
    await newPage(page).getByRole('button', { name: 'Board width' }).click()
    await newPage(page).getByRole('textbox', { name: 'Value of size 1' }).fill('50')
    await newPage(page).getByRole('button', { name: 'Rules' }).click()
    await newPage(page).getByRole('textbox', { name: 'Rules' }).fill('hand-solderable')
    await makeIt(page).click()
    await expect(page.getByRole('button', { name: 'Project blinky' })).toBeVisible()
    expect((await state(page)).tab).toBe('brief')
    const dir = join(root, 'blinky')
    expect(files(dir).filter((f) => !f.startsWith('.pino/') || f === '.pino/brief/cards.json')).toEqual(['.pino/brief/cards.json', 'brief.md', 'reference/photo-1.png'])
    expect(readdirSync(root)).toEqual(['blinky'])
    await expect(page.getByRole('tabpanel', { name: 'Brief' })).toContainText('Blinks an LED.')
    await expect(page.getByRole('tabpanel', { name: 'Brief' })).toContainText('hand-solderable')
    expect(agentsIn(dir)).toEqual([])
  } finally {
    await app.close()
  }
})

test('a name another folder has is refused before anything is made', async () => {
  const root = tempFolder('workspace')
  mkdirSync(join(root, 'Blinky'))
  const { app, page } = await onEmpty({ root })
  try {
    await page.getByRole('main', { name: 'All projects' }).getByRole('button', { name: 'New project' }).click()
    await name(page).fill('blinky')
    await what(page).fill('Blinks an LED.')
    await expect(newPage(page)).toContainText('A folder `Blinky` is there already.')
    await expect(makeIt(page)).toBeDisabled()
    expect(readdirSync(root)).toEqual(['Blinky'])
  } finally {
    await app.close()
  }
})

test('a sketch over the photo is a doodle in reference/', async () => {
  const run = await onEmpty()
  const { app, page, root } = run
  try {
    await name(page).fill('blinky')
    await what(page).fill('Blinks an LED.')
    await addPhoto(run)
    // The key is the page's, not the field's: it is pressed with no field in focus.
    await what(page).press('Escape')
    await page.keyboard.press('s')
    const board = page.getByRole('dialog', { name: 'Doodle board' })
    await board.getByRole('combobox', { name: 'Draw over' }).selectOption({ label: 'Photo 1, desk.png' })
    const box = (await board.getByLabel('Drawing area').boundingBox())!
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 5 })
    await page.mouse.up()
    await board.getByRole('button', { name: 'Done' }).click()
    await expect(newPage(page).getByRole('listitem', { name: 'Doodle doodle 1' })).toBeVisible()
    await makeIt(page).click()
    await expect(page.getByRole('button', { name: 'Project blinky' })).toBeVisible()
    const dir = join(root, 'blinky')
    expect(statSync(join(dir, 'reference', 'doodle-1.png')).size).toBeGreaterThan(100)
    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toContain('- reference/doodle-1.png: drawn over reference/photo-1.png\n')
  } finally {
    await app.close()
  }
})

test('New project from the menu of an open project makes another and opens it, and opening a workspace sweeps what a crash left', async () => {
  const root = tempFolder('workspace')
  mkdirSync(join(root, 'a'))
  writeFileSync(join(root, 'a', 'brief.md'), '# a\n')
  const stale = join(root, '.x.pino-new-0123456789ab')
  mkdirSync(stale)
  const old = new Date(Date.now() - 3_600_000)
  utimesSync(stale, old, old)
  const { app, page } = await onEmpty({ root })
  try {
    await page.getByRole('main', { name: 'All projects' }).getByRole('button', { name: 'a', exact: true }).click()
    expect(readdirSync(root)).toEqual(['a'])
    await page.getByRole('button', { name: 'Project a' }).click()
    await page.getByRole('menuitem', { name: 'New project…' }).click()
    await name(page).fill('second')
    await what(page).fill('Another board.')
    await makeIt(page).click()
    await expect(page.getByRole('button', { name: 'Project second' })).toBeVisible()
    expect(readdirSync(root).sort()).toEqual(['a', 'second'])
  } finally {
    await app.close()
  }
})
