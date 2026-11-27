import { appendFileSync, cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { PinoState } from '../src/renderer/state/store'
import { APP } from '../src/shared/app'
import { newSession, waitForBuild } from './helpers'
import { launch, referenceProject, type Launched } from './launch'

// The builds timeline (torno #332): a bar across the foot of the three views, above the status line, folded by default,
// with a chip for each group of builds (a prompt's builds are one group, the person's saves in a row another); a drawer
// that opens upward from it, by its toggle and by the key, and folds back the same way; a group of several builds is a
// pile until a click shows them all. The route card's head names the build in the same words (torno #335). The agent is
// the stand-in in its stream mode (test/fake-agent.mjs), the engine its stand-in; the window is hidden.

test.describe.configure({ mode: 'serial' })

let run: Launched
let dir: string
let page: Page

const state = (): Promise<PinoState> => page.evaluate(() => window.__pinoTest!.state())
const dock = () => page.locator('[data-region="session"]')
const turns = () => dock().locator('.chat .chat-turn')
const timeline = (): Locator => page.locator('[data-region="builds"]')
const bar = () => timeline().locator('.timeline-bar')
const toggle = () => timeline().locator('.timeline-toggle')
const drawer = () => timeline().locator('.timeline-drawer')
const chips = () => timeline().locator('.tl-chip')
const head = () => page.locator('.route-card .route-head')
const group = (label: string) => timeline().locator('.tl-group').filter({ has: page.locator('.tl-group-label', { hasText: label }) })
const tab = (name: string) => page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name })
/** What each chip says: its label and its count, `Prompt 1 (2)`. */
const chipTexts = (): Promise<string[]> => chips().evaluateAll((els) => els.map((el) => [el.querySelector('.tl-chip-label')?.textContent, el.querySelector('.tl-chip-count')?.textContent].filter(Boolean).join(' ')))
/** How many builds that drew something main says the cause of. */
const builtBy = async (cause: string): Promise<number> => ((await state()).build?.history ?? []).filter((e) => e.cause === cause && e.verdict !== 'failed' && e.verdict !== 'running').length

async function say(lines: string[]): Promise<void> {
  const before = await turns().count()
  await dock().locator('[data-chat-composer]').fill(lines.join('\n'))
  await dock().locator('[data-chat-composer]').press('Enter')
  await expect(turns()).toHaveCount(before + 1, { timeout: 30_000 })
}

test.beforeAll(async () => {
  dir = referenceProject()
  appendFileSync(join(dir, 'board.py'), '\n# step 0\n')
  // A second project beside it, for the window's memory of the drawer.
  cpSync(dir, join(dirname(dir), 'second'), { recursive: true })
  run = await launch({ project: dir, agent: true })
  page = run.page
  await waitForBuild(page, 1)
})

test.afterAll(async () => {
  await run?.app.close()
})

test('the builds of a project are a folded bar under the views, a chip for each prompt and for the saves in a row', async () => {
  await newSession(dock())
  await expect(dock().locator('[data-chat-composer]')).toBeEnabled()
  // A prompt that builds twice, and one that builds once.
  await say(['edit board.py "# step 0" "# step 1"', 'work 2', 'edit board.py "# step 1" "# step 2"'])
  await expect.poll(() => builtBy('agent'), { timeout: 30_000 }).toBe(2)
  // Two saves of the person's in a row, the first while Claude's second turn still works: only its tool calls make a
  // save Claude's.
  const before = await turns().count()
  await dock().locator('[data-chat-composer]').fill('edit board.py "# step 2" "# step 3"\nwork 8')
  await dock().locator('[data-chat-composer]').press('Enter')
  await expect.poll(() => builtBy('agent'), { timeout: 30_000 }).toBe(3)
  appendFileSync(join(dir, 'board.py'), '# a note\n')
  await expect.poll(() => builtBy('person'), { timeout: 30_000 }).toBe(1)
  expect((await state()).session?.status).toBe('working')
  await expect(turns()).toHaveCount(before + 1, { timeout: 30_000 })
  await expect.poll(async () => (await state()).session?.status, { timeout: 30_000 }).toBe('idle')
  appendFileSync(join(dir, 'board.py'), '# another\n')
  await expect.poll(() => builtBy('person'), { timeout: 30_000 }).toBe(2)

  // Folded: one line across the foot of the views, on the status line, and no drawer.
  await expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer()).toBeHidden()
  const [line, status, view] = [(await bar().boundingBox())!, (await page.locator('[data-region="status"]').boundingBox())!, (await page.locator('[data-region="viewport"]').boundingBox())!]
  expect(line.height).toBeLessThan(40)
  expect(Math.abs(line.y + line.height - status.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(line.x - view.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(line.width - view.width)).toBeLessThanOrEqual(1)
  // The view stands on the bar.
  const panel = (await page.locator('.views-panel').boundingBox())!
  expect(Math.abs(panel.y + panel.height - line.y)).toBeLessThanOrEqual(1)
  // One chip a group: the opening's build, each prompt's builds with their count, the saves; no words of the prompt.
  await expect.poll(chipTexts, { timeout: 15_000 }).toEqual(['Earlier', 'Prompt 1 (2)', 'Prompt 2', 'Saved by you (2)'])
  // A prompt's chip ends with what the prompt cost (torno #372; the stand-in says $0); the saves' has none.
  await expect(chips().nth(1).locator('.tl-chip-cost')).toHaveText(/^\$0/, { timeout: 15_000 })
  await expect(chips().nth(2).locator('.tl-chip-cost')).toHaveText(/^\$0/)
  await expect(chips().last().locator('.tl-chip-cost')).toHaveCount(0)
  await expect(chips().first().locator('.tl-chip-cost')).toHaveCount(0)
  // The last group holds the build on show; the prompt's words are in the title.
  await expect(chips().last()).toHaveAttribute('data-on-show', '')
  await expect(chips().nth(1)).toHaveAttribute('title', /step 0/)
  // The route card's head names the build in the same words.
  await expect(head().locator('h2')).toContainText('Latest build · saved by you')
  await expect(head().locator('h2')).toHaveAttribute('title', /^h\d+, /)
})

test('its toggle opens the drawer upward over the view, a group shows each of its builds, a build is shown, and the key does it too', async () => {
  const panel = page.locator('.views-panel')
  const before = (await panel.boundingBox())!
  await toggle().click()
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer()).toBeVisible()
  // Over the view, which keeps its size.
  const [opened, line] = [(await drawer().boundingBox())!, (await bar().boundingBox())!]
  expect(Math.abs(opened.y + opened.height - line.y)).toBeLessThanOrEqual(1)
  expect((await panel.boundingBox())!.height).toBe(before.height)
  await expect(timeline().locator('.timeline-head')).toContainText('Builds of reference')

  // A group of two is a pile; a click on its head shows both with how each stands, again puts them back.
  const two = group('Prompt 1')
  const label = two.locator('.tl-group-head')
  await expect(label).toHaveAttribute('aria-expanded', 'false')
  await expect(label).toContainText('(2)')
  await expect(two.locator('.tl-pile')).toHaveCount(1)
  const made = ((await state()).build?.history ?? []).filter((e) => e.cause === 'agent').slice(0, 2).map((e) => e.number)
  await label.click()
  await expect(label).toHaveAttribute('aria-expanded', 'true')
  const builds = two.locator('.strip-node[data-build]')
  await expect(builds).toHaveCount(2)
  await expect(builds.first()).toHaveAttribute('data-build', `h${made[0]}`)
  await expect(builds.first().locator('.strip-by')).toHaveText('ok')

  // A press on a build shows it; the head names it as older, and Back to latest goes back.
  await builds.first().click()
  await expect.poll(async () => (await state()).shown).toBe(made[0])
  await expect(builds.first()).toHaveAttribute('data-on-show', '')
  await expect(head().locator('h2')).toContainText('Prompt 1 · older build')
  await head().getByRole('button', { name: 'Back to latest' }).click()
  await expect.poll(async () => (await state()).shown).toBeNull()
  await expect(head().locator('h2')).toContainText('Latest build · saved by you')
  await label.click()
  await expect(two.locator('.tl-pile')).toHaveCount(1)

  // Kept by the window, open or shut.
  expect(await page.evaluate((key) => localStorage.getItem(key), `${APP.name}.timeline`)).toBe('open')
  // The key folds it, and opens it again: it is heard everywhere, in the box of the chat too.
  await dock().locator('[data-chat-composer]').focus()
  await page.keyboard.press('Control+Shift+H')
  await expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer()).toBeHidden()
  expect(await page.evaluate((key) => localStorage.getItem(key), `${APP.name}.timeline`)).toBe('shut')
  await page.keyboard.press('Control+Shift+H')
  await expect(drawer()).toBeVisible()
  await toggle().click()
  await expect(drawer()).toBeHidden()

  // A chip opens the drawer at its group, with all of its builds.
  await chips().filter({ hasText: 'Prompt 1' }).click()
  await expect(drawer()).toBeVisible()
  await expect(group('Prompt 1').locator('.strip-node[data-build]')).toHaveCount(2)
})

test("the bar serves the three views and is not on the Brief or Usage, which are no build's", async () => {
  for (const name of ['Schematic', '3D', 'Board']) {
    await tab(name).click()
    await expect(bar()).toBeVisible()
  }
  for (const name of ['Brief', 'Usage']) {
    await tab(name).click()
    await expect(timeline()).toHaveCount(0)
    // The key does nothing there.
    await page.keyboard.press('Control+Shift+H')
  }
  await tab('Board').click()
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true')
})

test("open is the window's, not the project's: another project keeps it open", async () => {
  await page.getByRole('button', { name: 'Project reference' }).click()
  await page.getByRole('menu', { name: 'Projects' }).getByRole('menuitem', { name: 'second', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Project second' })).toBeVisible()
  await waitForBuild(page, 1)
  await expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  await expect(drawer()).toBeVisible()
  await expect(timeline().locator('.timeline-head')).toContainText('Builds of second')
  await toggle().click()
  await expect(drawer()).toBeHidden()
})

// The bar's count and the chips' counts are of the same builds; the drawer's head counts those kept, and says so.
test('the bar counts every build the chips count, a failed one too, and the drawer says how many are kept', async () => {
  const project = referenceProject()
  const own = await launch({ project, env: { FAKE_KERNEL_FAIL_ON: '2' } })
  try {
    await waitForBuild(own.page, 1)
    const said = own.page.locator('[data-region="builds"]')
    for (const n of [2, 3]) {
      appendFileSync(join(project, 'board.py'), `# save ${n}\n`)
      // Build 2 fails, so it is waited for in the history, not as a build that drew.
      await expect.poll(() => own.page.evaluate(() => window.__pinoTest!.state().build?.history.filter((e) => e.verdict !== 'running').length ?? 0), { timeout: 20_000 }).toBe(n)
    }
    await expect(said.locator('.tl-chip')).toHaveText(['Earlier', 'Saved by you(2)'])
    await expect(said.locator('.timeline-toggle')).toHaveText('Builds3')
    await said.locator('.timeline-toggle').click()
    await expect(said.locator('.timeline-head')).toContainText('Builds of reference2 kept')
  } finally {
    await own.app.close()
  }
})
