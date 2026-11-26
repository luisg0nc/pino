// A workspace of boards: first run, the page of projects, the two crumbs and their menus.
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { newSession, waitForBuild } from './helpers'
import { agentsIn, launch, referenceProject, tempFolder, tempProject, type Launched } from './launch'

const state = (page: Page) => page.evaluate(() => window.__pinoTest!.state())
const all = (page: Page) => page.getByRole('main', { name: 'All projects' })
const names = (page: Page) => all(page).locator('.project-card-name')

/** A workspace holding `a` (a board), `b` (a brief alone) and `empty`. */
function workspaceOfThree(): string {
  const root = tempFolder('workspace')
  mkdirSync(join(root, 'a'))
  writeFileSync(join(root, 'a', 'board.py'), '')
  mkdirSync(join(root, 'b'))
  writeFileSync(join(root, 'b', 'brief.md'), '# b\n')
  mkdirSync(join(root, 'empty'))
  return root
}

/** A launch with a config file that names these. */
async function launchOn(config: { workspace?: string; project?: string; workspaces: string[] }, opts: { agent?: boolean } = {}): Promise<Launched> {
  const path = join(tempFolder('config'), 'config.json')
  writeFileSync(path, JSON.stringify(config))
  return launch({ ...opts, env: { PINO_CONFIG: path } })
}

test("first run offers ~/boards, makes it in the run's home and opens its page", async () => {
  const { app, page } = await launch()
  try {
    // The folder is made where main's home is: it is the run's own, and only then is the button pressed.
    const home = await app.evaluate(() => process.env.HOME!)
    expect(home.startsWith(join(realpathSync(tmpdir()), 'pino-e2e-home-'))).toBe(true)
    await expect(page.getByRole('heading', { name: 'Choose a folder for your boards' })).toBeVisible()
    await page.getByRole('button', { name: 'Use ~/boards' }).click()
    await expect(all(page)).toContainText('No boards here yet.')
    expect(statSync(join(home, 'boards')).isDirectory()).toBe(true)
    expect((await state(page)).workspace?.root).toBe(join(home, 'boards'))
    // What is missing on the machine stands at the page's foot: no agent was asked for.
    await expect(all(page).getByRole('list', { name: 'What pino needs' }).getByRole('listitem')).toHaveText([/^Claude Code was not found/])
  } finally {
    await app.close()
  }
})

test('the page lists the boards; Enter opens one; the crumbs name both', async () => {
  const root = workspaceOfThree()
  const { app, page } = await launchOn({ workspace: root, workspaces: [root] })
  try {
    await expect(names(page)).toHaveText(['New project', 'a', 'b', 'empty'])
    const list = all(page).getByRole('list', { name: `Projects in ${basename(root)}` })
    await expect(list.getByRole('button', { name: 'New project' })).toBeDisabled()
    await expect(list.getByRole('button', { name: 'b', exact: true })).toContainText('No board yet')
    await expect(list.getByRole('button', { name: 'empty' })).toContainText('Empty')
    await expect(page.getByRole('button', { name: /^Project / })).toHaveCount(0)
    // Arrows move between the cards, and never to the one that cannot be pressed.
    await list.getByRole('button', { name: 'a', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(list.getByRole('button', { name: 'b', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(list.getByRole('button', { name: 'a', exact: true })).toBeFocused()
    // A letter typed on the page filters; Escape clears it.
    await page.keyboard.press('e')
    const filter = all(page).getByRole('searchbox', { name: 'Filter projects' })
    await expect(filter).toBeFocused()
    await expect(filter).toHaveValue('e')
    await expect(names(page)).toHaveText(['New project', 'empty'])
    await page.keyboard.press('Escape')
    await expect(names(page)).toHaveText(['New project', 'a', 'b', 'empty'])
    await list.getByRole('button', { name: 'a', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: `Workspace ${basename(root)}` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Project a' })).toBeVisible()
    expect((await state(page)).page).toBe('project')
  } finally {
    await app.close()
  }
})

test('the page is read again when the window is come back to', async () => {
  const root = workspaceOfThree()
  const { app, page } = await launchOn({ workspace: root, workspaces: [root] })
  try {
    await expect(names(page)).toHaveText(['New project', 'a', 'b', 'empty'])
    mkdirSync(join(root, 'late'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(names(page)).toHaveText(['New project', 'a', 'b', 'empty', 'late'])
  } finally {
    await app.close()
  }
})

test('the project menu lists every board with the open one current, and switches', async () => {
  const root = workspaceOfThree()
  const { app, page } = await launchOn({ workspace: root, project: join(root, 'a'), workspaces: [root] })
  try {
    await page.getByRole('button', { name: 'Project a' }).click()
    const menu = page.getByRole('menu', { name: 'Projects' })
    await expect(menu.getByRole('menuitem')).toHaveText(['New project…', 'All projects', 'acurrent', 'b', 'emptyempty'])
    await expect(menu.getByRole('menuitem', { name: 'New project…' })).toBeDisabled()
    await expect(menu.locator('[aria-current="true"]')).toContainText('a')
    await menu.getByRole('menuitem', { name: 'b', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Project b' })).toBeVisible()
    expect((await state(page)).project?.dir).toBe(join(root, 'b'))
  } finally {
    await app.close()
  }
})

test('the workspace menu lists the recent workspaces and opens another', async () => {
  const first = workspaceOfThree()
  const second = workspaceOfThree()
  const third = tempFolder('picked')
  const { app, page } = await launchOn({ workspace: first, workspaces: [first, second, join(first, 'gone')] })
  try {
    await page.getByRole('button', { name: `Workspace ${basename(first)}` }).click()
    const menu = page.getByRole('menu', { name: 'Workspaces' })
    await expect(menu.locator('.folder-row')).toHaveCount(3)
    await expect(menu.locator('.folder-row[data-open]')).toContainText('current')
    await expect(menu.locator('.folder-row[data-missing]')).toContainText('Not found')
    await expect(menu.locator('.folder-row[data-missing]').getByRole('menuitem')).toBeDisabled()
    await menu.locator('.folder-item:enabled').click()
    await expect(page.getByRole('button', { name: `Workspace ${basename(second)}` })).toBeVisible()
    expect((await state(page)).workspace?.root).toBe(second)
    await app.evaluate((_main, folder) => {
      ;(globalThis as unknown as { __pinoMain: { pickFolder: string | null } }).__pinoMain.pickFolder = folder
    }, third)
    await page.getByRole('button', { name: `Workspace ${basename(second)}` }).click()
    await page.getByRole('menuitem', { name: 'Open workspace…' }).click()
    await expect(page.getByRole('button', { name: `Workspace ${basename(third)}` })).toBeVisible()
    await expect(all(page)).toContainText('No boards here yet.')
  } finally {
    await app.close()
  }
})

test('Choose folder… and Open workspace… on a board open its parent, on that board', async () => {
  const root = workspaceOfThree()
  const { app, page } = await launch()
  const choose = (folder: string) =>
    app.evaluate((_main, picked) => {
      ;(globalThis as unknown as { __pinoMain: { pickFolder: string | null } }).__pinoMain.pickFolder = picked
    }, folder)
  try {
    await choose(join(root, 'a'))
    await page.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(page.getByRole('button', { name: `Workspace ${basename(root)}` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Project a' })).toBeVisible()
    await choose(join(root, 'b'))
    await page.getByRole('button', { name: `Workspace ${basename(root)}` }).click()
    await page.getByRole('menuitem', { name: 'Open workspace…' }).click()
    await expect(page.getByRole('button', { name: 'Project b' })).toBeVisible()
    expect((await state(page)).project?.dir).toBe(join(root, 'b'))
  } finally {
    await app.close()
  }
})

test('a launcher folder that is a project opens its parent on it, and starts there again next time', async () => {
  const dir = tempProject('blinky')
  const first = await launch({ project: dir })
  await expect(first.page.getByRole('button', { name: 'Project blinky' })).toBeVisible()
  await first.app.close()
  const { app, page } = await launch({ env: { PINO_CONFIG: first.config } })
  try {
    await expect(page.getByRole('button', { name: 'Project blinky' })).toBeVisible()
    expect((await state(page)).project?.dir).toBe(dir)
  } finally {
    await app.close()
  }
})

test('a project in the home folder opens the first screen and says why', async () => {
  // The run's home is made by `launch`, so the project is put in one given to it.
  const home = tempFolder('home-with-a-board')
  mkdirSync(join(home, 'blinky'))
  writeFileSync(join(home, 'blinky', 'board.py'), '')
  const { app, page } = await launch({ project: join(home, 'blinky'), env: { HOME: home } })
  try {
    await expect(page.getByRole('alert')).toHaveText('blinky is in your home folder, not in a folder of boards. Choose a folder for your boards, such as ~/boards, and move blinky into it.')
    expect((await state(page)).page).toBe('first')
  } finally {
    await app.close()
  }
})

test('a board built in this run has its picture on its card', async () => {
  const dir = referenceProject('reference')
  const { app, page } = await launch({ project: dir })
  try {
    await waitForBuild(page, 1)
    // The picture is of the build, and is kept beside the board, which git is told to pass over.
    await expect.poll(() => existsSync(join(dir, '.pino', 'thumb.json'))).toBe(true)
    const hash = (await state(page)).build!.lastGood!.hash
    expect(JSON.parse(readFileSync(join(dir, '.pino', 'thumb.json'), 'utf8'))).toMatchObject({ hash })
    await page.getByRole('button', { name: 'Project reference' }).click()
    await page.getByRole('menuitem', { name: 'All projects' }).click()
    const picture = all(page).getByRole('button', { name: 'reference' }).locator('img')
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]), { timeout: 10_000 }).toEqual([480, 320])
    // Only the open project's newest build is taken: a picture said to be of another is dropped.
    const id = await page.evaluate(() => window.pino.workspace.current().then((open) => open.project))
    expect(id).toBeNull()
    const before = readFileSync(join(dir, '.pino', 'thumb.json'), 'utf8')
    await page.evaluate(() => window.pino.project.saveThumb('p000000000000', 'aaaaaaaaaaaa', new Uint8Array([1, 2, 3])))
    expect(readFileSync(join(dir, '.pino', 'thumb.json'), 'utf8')).toBe(before)
  } finally {
    await app.close()
  }
})

test('All projects in the middle of a turn ends the session and shows the page', async () => {
  const dir = tempProject('blinky')
  const { app, page } = await launch({ project: dir, agent: true })
  try {
    await newSession(page.locator('[data-region="session"]'))
    const composer = page.locator('[data-chat-composer]')
    await composer.fill('slow 30')
    await composer.press('Enter')
    await expect(page.locator('[data-region="session"] .session-status')).toHaveText('Working')
    await expect.poll(() => agentsIn(dir)).toHaveLength(1)
    await page.getByRole('button', { name: 'Project blinky' }).click()
    await page.getByRole('menuitem', { name: 'All projects' }).click()
    await expect(all(page)).toBeVisible()
    await expect.poll(() => agentsIn(dir), { timeout: 10_000 }).toEqual([])
  } finally {
    await app.close()
  }
})
