// What Claude Code spent: the sentence under a turn's end, why a large turn was large, and the Usage page with a
// conversation's ledger. The project's earlier conversation is a chat log written by the spec, with the CLI's numbers
// on its turns, as the transcript keeps them; the live turns are the stand-in's, which says they cost nothing, over the
// engine's stand-in: one resumes the earlier conversation, one calls `look` for real and saves a file that is built.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { fromMore, newSession, waitForBuild } from './helpers'
import { launch, referenceProject, type Launched } from './launch'

const EARLIER = '5f0c1d2e-0000-4000-8000-00000000aaaa'

test.describe.configure({ mode: 'serial' })

let open: Launched
const dockOf = (page: Page): Locator => page.locator('[data-region="session"]')
const composer = (page: Page): Locator => page.locator('[data-chat-composer]')
const usagePage = (page: Page): Locator => page.locator('main .usage-page')
const state = (page: Page) => page.evaluate(() => window.__pinoTest!.state())
const tab = (page: Page, name: string): Locator => page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name })

async function say(page: Page, text: string): Promise<void> {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}

/** An earlier conversation of six prompts: four of $1, one of $8 with 14 pictures from look and two builds, and a first turn after a resume; on file as the one to resume. */
function writeEarlier(dir: string): void {
  const at = Date.now() - 2 * 60 * 60 * 1000
  const lines: object[] = []
  const turn = (n: number, cost: number | undefined, requests: number) => ({
    kind: 'turn', id: `e${n}`, ok: true, stopped: false, seconds: 20, pulled: {},
    usage: { input: 10, output: 2000, cacheRead: 150_000 * requests, cacheCreation: 9000, requests, ...(cost !== undefined ? { costUsd: cost } : {}), sessionCostUsd: 1 },
    ...(n === 5 ? { builds: { count: 2, from: 3, to: 5 } } : {})
  })
  for (let n = 1; n <= 6; n++) {
    lines.push({ kind: 'user', id: `u${n}`, text: n === 5 ? 'Look at it from every side' : `Prompt said ${n}`, images: [], state: 'sent', at: at + n * 10 * 60 * 1000 })
    if (n === 5) lines.push({ kind: 'tool', id: 'look5', toolUseId: 'look5', name: 'mcp__pino__look', own: true, input: {}, state: 'done', images: Array.from({ length: 14 }, (_, i) => ({ id: `p${i}`, mediaType: 'image/png' })) })
    lines.push(n === 5 ? turn(n, 8, 62) : n === 6 ? turn(n, undefined, 7) : turn(n, 1, 8))
  }
  mkdirSync(join(dir, '.pino', 'chat'), { recursive: true })
  writeFileSync(join(dir, '.pino', 'chat', `${EARLIER}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
  writeFileSync(join(dir, '.pino', 'session.json'), JSON.stringify({ conversationId: EARLIER, agent: 'claude' }))
}

test.beforeAll(async () => {
  const dir = referenceProject()
  writeEarlier(dir)
  open = await launch({ project: dir, agent: true })
  await waitForBuild(open.page, 1)
})

test.afterAll(async () => {
  await open?.app.close()
})

test('a resumed conversation: a large turn says why, and its first new turn says its cost is not known', async () => {
  const { page } = open
  await dockOf(page).getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(composer(page)).toBeVisible()
  const why = dockOf(page).locator('.chat-turn .usage-why')
  await expect(why).toHaveCount(1)
  await expect(why).toContainText("Why this turn was large: 8 × this project's usual turn")
  await expect(why).toContainText('62 calls, and each read the whole conversation again: 150 k a call on average, 9.3 M in all.')
  await expect(why).toContainText('14 pictures came in on the way, all from look.')
  await expect(why).toContainText('2 builds ran, h3 to h5.')

  await say(page, 'say done')
  const last = dockOf(page).locator('.chat .chat-turn').last()
  await expect(last.locator('.chat-turn-usage')).toHaveText('Cost not known for this turn. 1 call: 0 of context read again, 1 new to it, 1 written.')
  await expect(last.locator('.chat-turn-note')).toContainText("Claude Code counts a resumed conversation's cost together")

  await why.getByRole('button', { name: 'Open in Usage', exact: true }).click()
  await expect(tab(page, 'Usage')).toHaveAttribute('aria-selected', 'true')
  await expect(usagePage(page).locator('.usage-ledger tr[data-lit]')).toContainText('Look at it from every side')
})

test('the end of a live turn says what it took, and its pictures and builds are counted', async () => {
  const { page } = open
  await tab(page, 'Board').click()
  // The resumed session ends, and a new one takes its place: until it has, the composer on show is the old session's,
  // still open while its stop is on the way, and a prompt written there goes with it.
  const before = (await state(page)).session!.sessionId
  await fromMore(dockOf(page), 'Stop')
  await expect.poll(async () => (await state(page)).session?.status).toBe('exited')
  await newSession(dockOf(page))
  await expect.poll(async () => (await state(page)).session?.sessionId).not.toBe(before)
  await expect.poll(async () => (await state(page)).session?.status).toBe('idle')
  await expect(composer(page)).toBeEnabled()
  // The save is built while the turn is still at work.
  await say(page, 'tool mcp__pino__look {}\nwrite extra.py a = 1\nslow 3')
  const line = dockOf(page).locator('.chat .chat-turn .chat-turn-usage')
  await expect(line).toHaveText('$0 for 1 call: 0 of context read again, 1 new to it, 1 written.', { timeout: 30_000 })
  await tab(page, 'Usage').click()
  // The page was left on the earlier conversation's ledger.
  await usagePage(page).locator('.usage-back').click()
  await usagePage(page).locator('.usage-convs tbody tr').last().locator('.usage-conv').click()
  const row = usagePage(page).locator('.usage-ledger tbody tr')
  await expect(row).toHaveCount(1)
  // The number, the words, the calls, the pictures, the builds.
  await expect(row.locator('td').nth(2)).toHaveText('1')
  await expect(row.locator('td').nth(3)).toHaveText('1')
  await expect(row.locator('td').nth(4)).toHaveText('1')
})

test('the Usage page says the week in a sentence, its days, where the tokens went and the conversations', async () => {
  const { page } = open
  await usagePage(page).locator('.usage-back').click()
  await expect(usagePage(page).locator('h1')).toHaveText('Usage of reference')
  // 4 × $1 + $8 and the live turn's $0; the two turns after a resume are not counted. 8 prompts in 2 conversations.
  await expect(usagePage(page).locator('.usage-lead')).toContainText('$12.00 over 8 prompts in 2 conversations.')
  await expect(usagePage(page).locator('.usage-lead small')).toContainText('Prompt 5 took 67 % of the week: 62 calls and 14 pictures.')
  await expect(usagePage(page).locator('.usage-lead small')).toContainText('2 first turns after a resume have no cost to count.')
  await expect(usagePage(page).locator('svg.usage-days')).toBeVisible()
  await expect(usagePage(page).locator('.usage-legend')).toContainText('read again')
  await expect(usagePage(page).locator('.usage-convs tbody tr')).toHaveCount(2)
  await usagePage(page).getByRole('group', { name: 'Range' }).getByRole('button', { name: 'All' }).click()
  await expect(usagePage(page).locator('.usage-lead')).toContainText('$12.00 over 8 prompts')
})

test('a conversation opens to its prompts as a ledger, the large one with why, the resume as a line', async () => {
  const { page } = open
  await usagePage(page).locator(`.usage-convs tr[data-conversation="${EARLIER}"] .usage-conv`).click()
  await expect(usagePage(page).locator('.usage-lead')).toHaveText('$12.00 for 7 prompts and 102 calls, with 2 turns of unknown cost.')
  const hot = usagePage(page).locator('.usage-ledger tr[data-hot]')
  await expect(hot).toHaveCount(1)
  await expect(hot).toContainText('Look at it from every side')
  await expect(usagePage(page).locator('.usage-ledger-why .usage-why')).toContainText('2 builds ran, h3 to h5.')
  await expect(usagePage(page).locator('.usage-ledger-sep')).toHaveCount(2)
  await expect(usagePage(page).locator('.usage-ledger tr[data-prompt="u6"]')).toContainText('not known')
  await tab(page, 'Board').click()
  await expect(usagePage(page)).toHaveCount(0)
})
