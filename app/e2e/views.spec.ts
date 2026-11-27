// The views and the marks end to end on the reference board, over the engine's stand-in and the stand-in agent: what
// is built is drawn, what is clicked is referred to exactly, a stroke goes with the prompt and Claude points back.

import { appendFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readBoard } from '../src/shared/board/board'
import { describeTarget, type Target } from '../src/shared/board/refs'
import { circuitOf } from '../src/shared/circuit'
import { clickTarget, drawStroke, newSession, screenOf, startRoute, waitForBuild } from './helpers'
import { launch, referenceProject } from './launch'

const FIXTURE = resolve(__dirname, '../test/fixtures/reference-build')
const fixture = (name: string) => readFileSync(join(FIXTURE, name), 'utf8')

const state = (page: Page) => page.evaluate(() => window.__pinoTest!.state())
const drawn = (page: Page) => page.evaluate(() => window.__pinoTest!.drawn())
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name })
const card = (page: Page): Locator => page.locator('.route-card')
const band = (page: Page): Locator => page.locator('.band')
const dock = (page: Page): Locator => page.locator('[data-region="session"]')
const save = (dir: string) => appendFileSync(join(dir, 'board.py'), '\n# saved again\n')

/** The Board tab chosen and its drawing of build `n` up. */
async function onBoard(page: Page): Promise<void> {
  await tab(page, 'Board').click()
  await expect.poll(async () => (await drawn(page)).board?.hash ?? null).not.toBeNull()
}

const PAD: Target = { kind: 'pad', ref: 'U2', number: '1' }

test('opens the reference board and the build lands', async () => {
  const { app, page } = await launch({ project: referenceProject() })
  try {
    await waitForBuild(page, 1)
    await onBoard(page)
    expect((await drawn(page)).board!.hash).toBe((await state(page)).build!.lastGood!.hash)
    // The opening's build, named in the builds timeline's words; its id is the title only.
    await expect(card(page).locator('h2').first()).toContainText('Latest build')
    await expect(card(page).locator('h2').first()).toHaveAttribute('title', /^h1, /)
    await tab(page, 'Schematic').click()
    await expect.poll(async () => (await drawn(page)).sheet?.symbols ?? 0).toBeGreaterThan(0)
    await tab(page, '3D').click()
    await expect.poll(async () => (await drawn(page)).three?.loaded ?? false, { timeout: 20_000 }).toBe(true)
  } finally {
    await app.close()
  }
})

test('a click on a pad gives the exact reference, and the other tabs carry it', async () => {
  const { app, page } = await launch({ project: referenceProject() })
  try {
    await waitForBuild(page, 1)
    await onBoard(page)
    await clickTarget(page, PAD)
    const board = readBoard(fixture('filled/board.kicad_pcb'))
    const circuit = circuitOf(JSON.parse(fixture('circuit.json')))
    await expect.poll(async () => (await state(page)).selection?.text).toBe(describeTarget(board, circuit, PAD))
    await expect(tab(page, 'Schematic')).toHaveText('Schematic · U2.1')
  } finally {
    await app.close()
  }
})

test('a stroke goes with the prompt as its exact line, and Claude points back in orange', async () => {
  const { app, page } = await launch({ project: referenceProject(), agent: true })
  try {
    await waitForBuild(page, 1)
    await newSession(dock(page))
    await expect(dock(page).locator('.session-status')).toHaveText('Idle')
    await onBoard(page)
    // The composer takes the keys as a chat comes up: the tool's key is for the view.
    await page.locator('canvas.board').click({ position: { x: 8, y: 300 } })
    await page.keyboard.press('d')
    await drawStroke(page, PAD, [
      { dx: -60, dy: 0 },
      { dx: -60, dy: 60 },
      { dx: 60, dy: 60 }
    ])
    await expect.poll(async () => (await state(page)).marks.map((m) => `${m.id} ${m.kind} ${m.status}`)).toEqual(['M1 stroke draft'])
    const [stroke] = (await state(page)).marks
    expect(stroke.kind === 'stroke' && stroke.crosses.nets).toContain('VBUS')
    await expect(dock(page).locator('.chat-goes [data-mark="M1"]')).toBeVisible()

    const composer = page.locator('[data-chat-composer]')
    await composer.fill('tool mcp__pino__point {"targets":["U2"],"note":"this one"}')
    await composer.press('Enter')
    // What went with the prompt: M1's chip under it, and the exact line in what Claude was given.
    const added = dock(page).locator('.chat-added').first()
    await expect(added.locator('[data-mark="M1"]')).toBeVisible()
    await added.getByRole('button', { name: 'Show text' }).click()
    await expect(added.locator('.chat-added-text')).toContainText(`M1 `)
    await expect(added.locator('.chat-added-text')).toContainText(stroke.payload)

    await expect.poll(async () => (await state(page)).marks.map((m) => `${m.id} ${m.author} ${m.status}`)).toEqual(['M1 user sent', 'M2 agent sent'])
    await expect.poll(async () => (await drawn(page)).board?.marks ?? []).toContain('M2')
    await expect(dock(page).locator('.chat-tool-marks [data-mark="M2"]')).toHaveText('U2')
    await expect(dock(page).locator('.chat-goes')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('a save rebuilds once, and the part that moved is highlighted', async () => {
  const dir = referenceProject()
  const { app, page } = await launch({ project: dir, env: { FAKE_KERNEL_MOVE: 'R4:1.5,0' } })
  try {
    await waitForBuild(page, 1)
    await onBoard(page)
    save(dir)
    await waitForBuild(page, 2)
    await expect.poll(async () => (await drawn(page)).board?.highlighted ?? []).toContain('R4')
    // One save, one build: none follows it.
    await page.waitForTimeout(800)
    expect((await state(page)).build!.history.map((e) => e.number)).toEqual([1, 2])
  } finally {
    await app.close()
  }
})

test('a failing save keeps the drawing and says why', async () => {
  const dir = referenceProject()
  const { app, page } = await launch({ project: dir, env: { FAKE_KERNEL_FAIL_ON: '2' } })
  try {
    await waitForBuild(page, 1)
    await onBoard(page)
    const first = (await drawn(page)).board!.hash
    save(dir)
    await expect(band(page)).toContainText('Drawn from h1. h2 failed: invalid syntax, board.py line 12')
    expect((await drawn(page)).board!.hash).toBe(first)
  } finally {
    await app.close()
  }
})

test('a project in a folder with spaces and accents builds', async () => {
  const { app, page } = await launch({ project: referenceProject('my board ação') })
  try {
    await waitForBuild(page, 1)
    await onBoard(page)
    await expect(page.locator('[data-region="title"]')).toContainText('my board ação')
  } finally {
    await app.close()
  }
})

test('an engine that will not start is said, and the chat is still there', async () => {
  const { app, page } = await launch({ project: referenceProject(), env: { FAKE_KERNEL_DIE: 'start' } })
  try {
    await expect(page.locator('[data-region="viewport"]')).toContainText('The engine did not start', { timeout: 20_000 })
    await expect(dock(page).getByRole('button', { name: 'New session', exact: true })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('routing runs in the background, and its copper goes stale after a move', async () => {
  const dir = referenceProject()
  const { app, page } = await launch({ project: dir, env: { FAKE_KERNEL_SERVE: '2', FAKE_KERNEL_ROUTE_MS: '120', FAKE_KERNEL_MOVE: 'U2:2.5,0' } })
  try {
    await waitForBuild(page, 1)
    await onBoard(page)
    await startRoute(page)
    await expect(band(page)).toContainText(/Routing in the background, \d+ of \d+/)
    await expect.poll(async () => (await drawn(page)).board?.route ?? null, { timeout: 20_000 }).not.toBeNull()
    await expect(page.locator('[data-region="status"]')).toContainText(/routed \d+\/\d+/)
    await expect.poll(async () => (await drawn(page)).board?.revealing ?? true).toBe(false)
    // The build the route asked for is the person's, as the builds timeline and the route card's head say, and its build is routed.
    const timeline = page.locator('[data-region="builds"]')
    await expect(timeline.locator('.tl-chip').last()).toContainText('Route you ran')
    await expect(card(page).locator('h2').first()).toContainText('Latest build · route you ran')
    await expect(card(page).locator('h2').first()).toContainText('routed')
    await timeline.locator('.timeline-toggle').click()
    await expect(timeline.locator('.strip-node[data-on-show] .strip-by')).toHaveText('routed')
    await timeline.locator('.timeline-toggle').click()
    save(dir)
    await expect.poll(async () => (await drawn(page)).board?.stale ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
    await expect(band(page)).toContainText('Parts moved since.')
    // The save after it is the person's too, its build's copper stale.
    await expect(timeline.locator('.tl-chip').last()).toContainText('Saved by you')
    await timeline.locator('.timeline-toggle').click()
    await expect(timeline.locator('.strip-node[data-on-show] .strip-by')).toHaveText('stale')
    await timeline.locator('.timeline-toggle').click()
    // "Keep it" leaves the faded copper on show and puts the band away; "Route again" is the other way out of it.
    await band(page).getByRole('button', { name: 'Keep it' }).click()
    await expect(band(page)).toHaveCount(0)
    expect((await drawn(page)).board!.stale).toBeGreaterThan(0)
  } finally {
    await app.close()
  }
})

test("the 3D view takes the routed board's model while the copper is a route's", async () => {
  const dir = referenceProject()
  const { app, page } = await launch({ project: dir, env: { FAKE_KERNEL_SERVE: '2', FAKE_KERNEL_MOVE: 'U2:2.5,0' } })
  const three = async () => (await drawn(page)).three
  const note = page.locator('.three-copper')
  try {
    await waitForBuild(page, 1)
    await tab(page, '3D').click()
    await expect.poll(async () => (await three())?.loaded ?? false, { timeout: 20_000 }).toBe(true)
    expect((await three())!.source).toBe('build')
    expect((await three())!.boardMeshes).not.toContain('board_via')
    await startRoute(page)
    // Only the stand-in's routed model has a via mesh: these are the route file's own bytes.
    await expect.poll(async () => (await three())?.boardMeshes ?? [], { timeout: 20_000 }).toContain('board_via')
    expect((await three())!.source).toBe('route')
    await expect(note).toHaveCount(0)
    // A part moved: the copper is stale, still the route's on both views, and the 3D view says whose board it shows.
    save(dir)
    await expect(band(page)).toContainText('Parts moved since.', { timeout: 20_000 })
    await expect(note).toHaveText('3D is the board as route r1 had it: its parts may stand elsewhere on the Board view.')
    await expect.poll(async () => (await three())?.loaded ?? false, { timeout: 20_000 }).toBe(true)
    expect((await three())!.source).toBe('route')
  } finally {
    await app.close()
  }
})

test('a route with no model leaves the 3D view on the build, and it says so', async () => {
  const { app, page } = await launch({ project: referenceProject(), env: { FAKE_KERNEL_SERVE: '2', FAKE_KERNEL_NO_ROUTE_GLB: '1' } })
  try {
    await waitForBuild(page, 1)
    await tab(page, '3D').click()
    await startRoute(page)
    await expect(page.locator('.three-copper')).toHaveText('This route has no 3D model, so 3D lacks its tracks. Ask Claude to route again.', { timeout: 20_000 })
    await expect.poll(async () => (await drawn(page)).three?.loaded ?? false, { timeout: 20_000 }).toBe(true)
    expect((await drawn(page)).three!.source).toBe('build')
  } finally {
    await app.close()
  }
})

test('the wheel zooms the board and the sheet over a chip or a pin as it does over the drawing', async () => {
  const { app, page } = await launch({ project: referenceProject() })
  try {
    await waitForBuild(page, 1)
    const part: Target = { kind: 'part', ref: 'U2' }
    const other: Target = { kind: 'part', ref: 'J1' }
    await page.evaluate((target) => window.pino.marks.add(window.__pinoTest!.state().project!.id, { kind: 'point', space: 'board', target, at: { x: 0, y: 0 }, note: '' }), part)
    for (const [name, over] of [
      ['Board', '.mark-chip[data-mark="M1"]'],
      ['Board', '.pin'],
      ['Schematic', '.mark-chip[data-mark="M1"]']
    ] as const) {
      await tab(page, name).click()
      /** How far apart two parts are on screen: it grows as the view is zoomed in. */
      const apart = async () => {
        const [a, b] = [await screenOf(page, part), await screenOf(page, other)]
        return Math.hypot(a.x - b.x, a.y - b.y)
      }
      const was = await apart()
      await page.locator(`.views-panel ${over}`).first().hover()
      await page.mouse.wheel(0, -200)
      await expect.poll(apart, { message: `${name} over ${over}` }).toBeGreaterThan(was * 1.2)
      await page.keyboard.press('f')
    }
  } finally {
    await app.close()
  }
})

test('on a machine with no WebGL the 3D tab says so, and the rest of the window carries on', async () => {
  const { app, page } = await launch({ project: referenceProject(), args: ['--disable-gpu', '--disable-software-rasterizer'] })
  try {
    await waitForBuild(page, 1)
    await tab(page, '3D').click()
    await expect(page.locator('.views-panel [role="alert"]')).toContainText('This machine gives pino no WebGL, which the 3D view needs.')
    await onBoard(page)
    await clickTarget(page, PAD)
    await expect.poll(async () => (await state(page)).selection?.label).toBe('U2.1')
  } finally {
    await app.close()
  }
})
