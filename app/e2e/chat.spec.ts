// The session dock end to end, against the stand-in agent: never the real claude.
import { existsSync, mkdirSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { closeModelMenu, fromMore, inModelMenu, moreItems, newSession } from './helpers'
import { agentsIn, launch, tempFolder, tempProject, type Launched } from './launch'

const dockOf = (page: Page): Locator => page.locator('[data-region="session"]')
const composer = (page: Page): Locator => page.locator('[data-chat-composer]')
const status = (page: Page): Locator => dockOf(page).locator('.session-status')
const turns = (page: Page): Locator => dockOf(page).locator('.chat-turn')

async function say(page: Page, text: string): Promise<void> {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}

/** A project open with a session running in it, idle. */
async function inSession(dir = tempProject(), env: Record<string, string> = {}): Promise<Launched & { dir: string }> {
  const run = await launch({ project: dir, agent: true, env })
  await newSession(dockOf(run.page))
  await expect(composer(run.page)).toBeVisible()
  await expect(status(run.page)).toHaveText('Idle')
  return { ...run, dir }
}

const tree = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()

test('a new session is a chat in the dock: a prompt is answered and the status goes Working then Idle', async () => {
  const { app, page } = await inSession()
  try {
    await page.evaluate(() => {
      const seen: string[] = []
      Object.assign(window, { __seen: seen })
      window.pino.session.onStatus((m) => seen.push(m.status))
    })
    await say(page, 'say hello')
    await expect(dockOf(page).locator('.chat-user')).toContainText('say hello')
    await expect(dockOf(page).locator('.chat-text')).toHaveText('hello')
    await expect(status(page)).toHaveText('Idle')
    expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual(['working', 'idle'])
    await expect(page.locator('[data-region="status"]')).toContainText('Idle')
    await expect(composer(page)).toHaveValue('')
  } finally {
    await app.close()
  }
})

test("Claude calls pino's one tool through the real MCP server, and its card shows the answer", async () => {
  const { app, page, dir } = await inSession()
  try {
    await say(page, 'tool mcp__pino__project {}')
    const card = dockOf(page).locator('.chat-tool[data-own]')
    await expect(card).toHaveAttribute('data-state', 'done')
    await expect(card.locator('.chat-tool-label')).toContainText('pino · project')
    await card.locator('.chat-tool-line').click()
    await expect(card).toContainText(`Project blinky in ${dir}. board.py: absent. brief.md: present.`)
  } finally {
    await app.close()
  }
})

test('a permission is asked in the dock and answered there', async () => {
  const { app, page, dir } = await inSession()
  try {
    const input = JSON.stringify({ file_path: join(dir, 'board.py'), content: 'b = 1' })
    const asking = dockOf(page).locator('.ask-takeover[data-ask-takeover="request"]')
    await say(page, `ask Write ${input}`)
    await expect(asking).toContainText('Claude Code asks to use Write')
    await expect(status(page)).toHaveText('Needs you')
    await asking.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(asking).toHaveCount(0)
    await expect(status(page)).toHaveText('Idle')
    const first = dockOf(page).locator('.chat-tool').last()
    await first.locator('.chat-tool-line').click()
    await expect(first).toContainText('allowed: ')
    await say(page, `ask Write ${input}`)
    await asking.getByRole('button', { name: 'Deny', exact: true }).click()
    await expect(status(page)).toHaveText('Idle')
    await expect(dockOf(page).locator('.chat-tool').last()).toHaveAttribute('data-state', 'denied')
    await expect(dockOf(page).locator('.chat-ask[data-state="denied"]')).toContainText('Denied')
  } finally {
    await app.close()
  }
})

test('Stop ends a long turn, and the session takes the next prompt', async () => {
  const { app, page } = await inSession()
  try {
    await say(page, 'slow 20')
    await expect(status(page)).toHaveText('Working')
    await expect(dockOf(page).locator('.chat-text')).toContainText('word1')
    await composer(page).press('Escape')
    await expect(turns(page)).toContainText('Stopped', { timeout: 10_000 })
    await expect(status(page)).toHaveText('Idle')
    await say(page, 'say on we go')
    await expect(dockOf(page).locator('.chat-text').last()).toHaveText('on we go')
    // The button does the same as the key, and a prompt sent while Claude works waits its turn.
    await say(page, 'slow 20')
    await expect(status(page)).toHaveText('Working')
    await say(page, 'say later')
    await expect(dockOf(page).locator('.chat-user').last()).toHaveAttribute('data-state', 'queued')
    await dockOf(page).getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(dockOf(page).locator('.chat-text').last()).toHaveText('later')
    await expect(status(page)).toHaveText('Idle')
  } finally {
    await app.close()
  }
})

test('the header has the model, and More ends the session or starts another', async () => {
  const { app, page, dir } = await inSession()
  try {
    await say(page, 'say hello')
    await expect(status(page)).toHaveText('Idle')
    await (await inModelMenu(dockOf(page), 'Model')).selectOption('haiku')
    await expect((await inModelMenu(dockOf(page), 'Effort'))).toBeEnabled()
    await closeModelMenu(dockOf(page))
    expect(await moreItems(dockOf(page))).toEqual(['New session', 'Stop'])
    await fromMore(dockOf(page), 'Stop')
    await expect(status(page)).toHaveText('Ended')
    await expect(composer(page)).toBeDisabled()
    await expect.poll(() => agentsIn(dir)).toEqual([])
    expect(await moreItems(dockOf(page))).toEqual(['Resume', 'New session'])
    await fromMore(dockOf(page), 'Resume')
    await expect(status(page)).toHaveText('Idle')
    await expect(dockOf(page).getByRole('region', { name: 'Earlier in this conversation' })).toContainText('say hello')
    await newSession(dockOf(page))
    await expect(status(page)).toHaveText('Idle')
    await expect(dockOf(page).locator('.chat-user')).toHaveCount(0)
    await expect.poll(() => agentsIn(dir)).toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('a window loaded again shows the session that is running, and a later launch offers to resume', async () => {
  const first = await inSession()
  try {
    await say(first.page, 'say remember me')
    await expect(status(first.page)).toHaveText('Idle')
    await first.page.reload()
    await expect(dockOf(first.page).locator('.chat-text')).toHaveText('remember me')
    await expect(status(first.page)).toHaveText('Idle')
    expect(agentsIn(first.dir)).toHaveLength(1)
  } finally {
    await first.app.close()
  }
  const second = await launch({ project: first.dir, agent: true, env: { PINO_CONFIG: first.config } })
  try {
    const dock = dockOf(second.page)
    await expect(dock.getByRole('region', { name: 'Last conversation' })).toContainText('remember me')
    await dock.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(dock.getByRole('region', { name: 'Earlier in this conversation' })).toContainText('remember me')
  } finally {
    await second.app.close()
  }
})

test('a folder with Claude Code settings of its own asks before the first chat', async () => {
  const dir = tempProject()
  mkdirSync(join(dir, '.claude'))
  writeFileSync(join(dir, '.claude', 'settings.json'), '{}')
  const { app, page } = await launch({ project: dir, agent: true })
  try {
    const dock = dockOf(page)
    await newSession(dock)
    const card = dock.getByRole('group', { name: 'This folder has Claude Code settings of its own' })
    await expect(card).toContainText('.claude/settings.json')
    await expect(card.locator('.num').first()).toHaveText('.claude/settings.json')
    expect(agentsIn(dir)).toEqual([])
    await card.getByRole('button', { name: 'Not now' }).click()
    await expect(card).toHaveCount(0)
    expect(agentsIn(dir)).toEqual([])
    // Nothing of a session: no conversation, no chat log. (The Brief on screen keeps what was seen of it, under brief/.)
    expect(['session.json', 'chat'].filter((name) => existsSync(join(dir, '.pino', name)))).toEqual([])
    await newSession(dock)
    await card.getByRole('button', { name: 'Trust and start' }).click()
    await expect(composer(page)).toBeVisible()
    await expect(status(page)).toHaveText('Idle')
    expect(agentsIn(dir)).toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('Claude Code missing from PATH is said in the dock, and the window keeps working', async () => {
  const { app, page } = await launch({ project: tempProject() })
  try {
    const dock = dockOf(page)
    await newSession(dock)
    await expect(dock.getByRole('alert')).toHaveText('Claude Code was not found on PATH. Install it, or start pino from a terminal where claude runs.')
    await expect(status(page)).toHaveText('No session')
    await page.getByRole('tab', { name: '3D' }).click()
    await expect(page.getByRole('tabpanel', { name: '3D' })).toBeVisible()
    // It can be tried again.
    await expect(dock.getByRole('button', { name: 'New session', exact: true })).toBeEnabled()
  } finally {
    await app.close()
  }
})

test('a .pino that is a link: nothing is written through it, the window says so once, the chat still runs', async () => {
  const dir = tempProject()
  const outside = tempFolder('outside')
  symlinkSync(outside, join(dir, '.pino'))
  const { app, page } = await inSession(dir)
  try {
    await say(page, 'say hello')
    await expect(dockOf(page).locator('.chat-text')).toHaveText('hello')
    const notice = page.locator('[data-region="status"] .status-notice')
    await expect(notice).toHaveText(`${join(dir, '.pino')} is a link, not a folder of pino's own inside the project: pino writes nothing there. Put a real folder in its place.`)
    await say(page, 'say again')
    await expect(dockOf(page).locator('.chat-text').last()).toHaveText('again')
    expect(await page.getByText('is a link, not a folder').count()).toBe(1)
    expect(readdirSync(outside)).toEqual([])
  } finally {
    await app.close()
  }
  expect(readdirSync(outside)).toEqual([])
})

test('nothing is written in the project outside .pino', async () => {
  const dir = tempProject()
  writeFileSync(join(dir, 'brief.md'), 'a brief')
  const before = tree(dir)
  const written = statSync(join(dir, 'brief.md')).mtimeMs
  const { app, page } = await inSession(dir)
  try {
    await say(page, 'tool mcp__pino__project {}')
    await expect(dockOf(page).locator('.chat-tool[data-own]')).toHaveAttribute('data-state', 'done')
    await expect(status(page)).toHaveText('Idle')
  } finally {
    await app.close()
  }
  const added = tree(dir).filter((path) => !before.includes(path))
  expect(added).toContain('.pino/session.json')
  expect(added.filter((path) => path !== '.pino' && !path.startsWith('.pino/'))).toEqual([])
  expect(statSync(join(dir, 'brief.md')).mtimeMs).toBe(written)
})

test('closing the project in the middle of a turn ends the session, and its token opens nothing', async () => {
  const { app, page, dir } = await inSession()
  try {
    await say(page, 'slow 30')
    await expect(status(page)).toHaveText('Working')
    await expect.poll(() => agentsIn(dir)).toHaveLength(1)
    await page.getByRole('button', { name: 'Project blinky' }).click()
    await page.getByRole('menuitem', { name: 'All projects' }).click()
    await expect(page.getByRole('main', { name: 'All projects' })).toBeVisible()
    await expect.poll(() => agentsIn(dir), { timeout: 10_000 }).toEqual([])
    const after = tree(dir)
    const stamps = after.map((path) => statSync(join(dir, path)).mtimeMs)
    await page.waitForTimeout(1000)
    expect(tree(dir)).toEqual(after)
    expect(after.map((path) => statSync(join(dir, path)).mtimeMs)).toEqual(stamps)
  } finally {
    await app.close()
  }
})

test('closing the window ends the session: no stand-in is left running in the folder', async () => {
  const { app, page, dir } = await inSession()
  await say(page, 'slow 30')
  await expect(status(page)).toHaveText('Working')
  await expect.poll(() => agentsIn(dir)).toHaveLength(1)
  await app.close()
  await expect.poll(() => agentsIn(dir), { timeout: 10_000 }).toEqual([])
})

test('a stand-in that will not leave does not keep pino from quitting, and is ended with it', async () => {
  const { app, page, dir } = await inSession(tempProject(), { FAKE_AGENT_STUBBORN: '1' })
  await say(page, 'slow 30')
  await expect(status(page)).toHaveText('Working')
  const before = Date.now()
  await app.close()
  expect(Date.now() - before).toBeLessThan(8000)
  await expect.poll(() => agentsIn(dir), { timeout: 5000 }).toEqual([])
})
