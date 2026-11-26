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
    await expect(newPage(page).getByRole('button', { name: 'Start: make the project and ask Claude' })).toBeEnabled()
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

/** An engine that looks parts up (protocol 3). */
const PARTS = { FAKE_KERNEL_SERVE: '3' }

const slot = (page: Page, title: string) => newPage(page).getByRole('region', { name: title, exact: true })
const open = (page: Page, title: string) => newPage(page).getByRole('list', { name: 'Add' }).getByRole('button', { name: title, exact: true }).click()

/** A row of Parts I have, with this typed as its part. */
async function typePart(page: Page, n: number, typed: string) {
  await slot(page, 'Parts I have').getByRole('button', { name: 'Add a part' }).click()
  await slot(page, 'Parts I have').getByRole('textbox', { name: `Part ${n}`, exact: true }).pressSequentially(typed)
  return slot(page, 'Parts I have').getByRole('listitem', { name: `Part ${n}`, exact: true })
}

const cardsIn = (dir: string) => (JSON.parse(readFileSync(join(dir, '.pino', 'brief', 'cards.json'), 'utf8')) as { cards: Array<{ kind: string; part?: unknown }> }).cards

test('a part typed in Parts I have is checked against JLC as it is typed', async () => {
  const { app, page, root } = await onEmpty({ env: PARTS })
  try {
    await open(page, 'Parts I have')
    await expect(await typePart(page, 1, 'C25804')).toContainText('basic · 0603 · stock 1,234,567 · $0.0024 each (checked 2026-11-26)')
    await expect(await typePart(page, 2, 'C1')).toContainText('JLC has no such part (checked ')
    await expect(await typePart(page, 3, 'ESP32-C3 module')).toContainText('A module in words: Claude looks it up.')
    expect(readdirSync(root)).toEqual([])
  } finally {
    await app.close()
  }
})

test('a part typed while jlcsearch cannot be reached says so and does not hold Start', async () => {
  const { app, page, root } = await onEmpty({ env: { ...PARTS, FAKE_KERNEL_PARTS: 'unreachable' } })
  try {
    await name(page).fill('blinky')
    await what(page).fill('Blinks an LED.')
    await open(page, 'Parts I have')
    await expect(await typePart(page, 1, 'C25804')).toContainText('Stock not checked: jlcsearch could not be reached.')
    await expect(makeIt(page)).toBeEnabled()
    await makeIt(page).click()
    await expect(page.getByRole('button', { name: 'Project blinky' })).toBeVisible()
    expect(cardsIn(join(root, 'blinky')).filter((c) => c.kind === 'part').map((c) => c.part)).toEqual([{ lcsc: 'C25804' }])
  } finally {
    await app.close()
  }
})

test('every PCB slot becomes cards of the person, in frames', async () => {
  const { app, page, root } = await onEmpty({ env: PARTS })
  try {
    await name(page).fill('blinky')
    await what(page).fill('Blinks an LED.')
    await open(page, 'Power')
    const power = slot(page, 'Power')
    await power.getByRole('button', { name: 'Add a power source' }).click()
    await expect(power.getByRole('combobox', { name: 'Source of power 1' })).toHaveValue('USB-C')
    await expect(power.getByRole('textbox', { name: 'Which battery, power 1' })).toHaveCount(0)
    await power.getByRole('textbox', { name: 'Voltage of power 1' }).fill('5')
    await power.getByRole('textbox', { name: 'Current of power 1' }).fill('0.5')
    await open(page, 'Connections')
    const connections = slot(page, 'Connections')
    await connections.getByRole('button', { name: 'Add a connection' }).click()
    await connections.getByRole('textbox', { name: 'What connection 1 is' }).fill('SHT40 sensor')
    await connections.getByRole('combobox', { name: 'How connection 1 talks' }).selectOption('I2C')
    await connections.getByRole('textbox', { name: 'Connector of connection 1' }).fill('JST-SH 4-pin')
    // A row half typed says why under it, and holds Make it until it is whole.
    await connections.getByRole('textbox', { name: 'What connection 1 is' }).fill('')
    await expect(connections).toContainText('Say what plugs in.')
    await expect(makeIt(page)).toBeDisabled()
    await connections.getByRole('textbox', { name: 'What connection 1 is' }).fill('SHT40 sensor')
    await open(page, 'Parts I have')
    await expect(await typePart(page, 1, 'C25804')).toContainText('stock 1,234,567')
    await open(page, 'Fab and assembly')
    const fab = slot(page, 'Fab and assembly')
    await expect(fab.getByRole('spinbutton', { name: 'How many boards' })).toHaveValue('5')
    await fab.getByRole('combobox', { name: 'Layers' }).selectOption('4')
    await makeIt(page).click()
    await expect(page.getByRole('button', { name: 'Project blinky' })).toBeVisible()
    const brief = page.getByRole('tabpanel', { name: 'Brief' })
    // A frame whose cards all stand in a table (Fab and assembly) has no heading among the person's words.
    for (const heading of ['Power', 'Connections', 'Parts I have']) await expect(brief.getByRole('region', { name: heading, exact: true })).toBeVisible()
    for (const said of ['USB-C, 5 V, 0.5 A', 'SHT40 sensor over I2C, JST-SH 4-pin', 'You asked for 4 layers, 1.6 mm, JLC assembles it, 5 boards']) await expect(brief).toContainText(said)
    const cards = cardsIn(join(root, 'blinky'))
    expect(cards.find((c) => c.kind === 'part')?.part).toMatchObject({ lcsc: 'C25804', reading: { class: 'basic', stock: 1234567 } })
  } finally {
    await app.close()
  }
})

const start = (page: Page) => newPage(page).getByRole('button', { name: 'Start: make the project and ask Claude' })
const dock = (page: Page) => page.locator('[data-region="session"]')

test('Start makes the project, opens it on the Brief and sends the first prompt with its picture', async () => {
  const run = await onEmpty({ agent: true })
  const { app, page, root } = run
  try {
    await name(page).fill('blinky')
    await what(page).fill('Blinks an LED.')
    await addPhoto(run)
    await open(page, 'Rules')
    await newPage(page).getByRole('textbox', { name: 'Rules' }).fill('hand-solderable')
    await expect(start(page)).toBeEnabled()
    await start(page).click()
    await expect(page.getByRole('button', { name: 'Project blinky' })).toBeVisible()
    expect((await state(page)).tab).toBe('brief')
    const prompt = dock(page).locator('.chat-user').first()
    await expect(prompt).toContainText('This is a new board, blinky, made in pino just now.')
    await expect(prompt).toContainText('(attached: picture 1)')
    // The picture went with it: the transcript's item holds it, with the file it is.
    const pictures = await page.evaluate(async () => {
      const history = await window.pino.chat.history(window.__pinoTest!.state().session!.sessionId)
      return history.items.flatMap((item) => (item.kind === 'user' ? item.images : []))
    })
    expect(pictures).toHaveLength(1)
    // What pino added to the prompt counts the Brief as told: the prompt has just said it all.
    await dock(page).locator('.chat-added').first().getByRole('button', { name: 'Show text' }).click()
    await expect(dock(page).locator('.chat-added-text').first()).toContainText('Brief: 1 card (0 new).')
    await expect.poll(() => agentsIn(join(root, 'blinky'))).toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('the right pane shows the first prompt as main writes it, as the slots fill', async () => {
  const { app, page, root } = await onEmpty()
  try {
    const pane = newPage(page).getByRole('complementary', { name: 'The first prompt' })
    await expect(pane).toContainText('What the board does, in your words, goes here.')
    await name(page).fill('blinky')
    await what(page).fill('Blinks an LED.')
    await expect(pane).toContainText('This is a new board, blinky, made in pino just now.')
    await open(page, 'Power')
    await slot(page, 'Power').getByRole('button', { name: 'Add a power source' }).click()
    await slot(page, 'Power').getByRole('textbox', { name: 'Voltage of power 1' }).fill('5')
    await expect(pane).toContainText('Power:\n- USB-C, 5 V', { useInnerText: true })
    await expect(pane).toContainText('Before you write board.py, settle')
    expect(readdirSync(root)).toEqual([])
  } finally {
    await app.close()
  }
})

test('with no Claude Code, Start makes the project and keeps the first prompt for later', async () => {
  const { app, page, root } = await onEmpty()
  try {
    await name(page).fill('blinky')
    await what(page).fill('Blinks an LED.')
    await start(page).click()
    await expect(page.getByRole('button', { name: 'Project blinky' })).toBeVisible()
    await expect(dock(page)).toContainText('The first prompt of this project was not sent: Claude Code was not found')
    await expect(dock(page)).toContainText('The first prompt is kept: it goes when you start a session.')
    expect(files(join(root, 'blinky'))).toContain('brief.md')
  } finally {
    await app.close()
  }
})

test('a first prompt that was kept goes when a session is started', async () => {
  // The agent's command is not there yet when Start is pressed, as before Claude Code is installed.
  const command = join(tempFolder('bin'), 'agent')
  const { app, page, root } = await onEmpty({ env: { PINO_AGENT_CMD: command } })
  try {
    await name(page).fill('blinky')
    await what(page).fill('Blinks an LED.')
    await start(page).click()
    await expect(dock(page)).toContainText('The first prompt is kept: it goes when you start a session.')
    expect(agentsIn(join(root, 'blinky'))).toEqual([])
    writeFileSync(command, `#!/bin/sh\nexec node '${join(__dirname, '..', 'test', 'fake-agent.mjs')}' "$@"\n`, { mode: 0o755 })
    await dock(page).getByRole('button', { name: 'New session' }).click()
    await expect(dock(page).locator('.chat-user').first()).toContainText('This is a new board, blinky, made in pino just now.')
    await expect(dock(page)).not.toContainText('The first prompt is kept')
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
