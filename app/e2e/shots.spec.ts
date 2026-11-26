// The screenshots the design review compares with the picked mockups. It runs only when PINO_SHOTS names a folder
// outside the repository: `PINO_SHOTS=/some/folder pnpm -C app exec playwright test e2e/shots.spec.ts`.
//
// Each picture is a launch of its own: a hidden window's `capturePage()` gives one picture, and the next call never
// returns (torno found the same).

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { capture, clickTarget, markScene, markTrack, screenOf, settled, startRoute, waitForBuild, zoomOn } from './helpers'
import { launch, referenceProject, type Launched } from './launch'

const folder = process.env.PINO_SHOTS ? resolve(process.env.PINO_SHOTS) : null
const inRepo = folder !== null && `${folder}/`.startsWith(`${resolve(__dirname, '../..')}/`)

test.skip(folder === null || inRepo, 'set PINO_SHOTS to a folder outside the repository')
test.setTimeout(90_000)

const tab = (run: Launched, name: string) => run.page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name })

interface Shot {
  width?: number
  height?: number
  dark?: boolean
  /** The first screen: no project is opened. */
  first?: true
  env?: Record<string, string>
  /** Drives the window to what the picture is of; `project` is the folder it has open. */
  at?(run: Launched, project: string): Promise<void>
}

const onBoard = async (run: Launched): Promise<void> => {
  await tab(run, 'Board').click()
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().board?.hash ?? null)).not.toBeNull()
}
const press = (key: string) => async (run: Launched) => {
  await onBoard(run)
  await run.page.keyboard.press(key)
}

const onSheet = async (run: Launched): Promise<void> => {
  await tab(run, 'Schematic').click()
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().sheet?.symbols ?? 0)).toBeGreaterThan(0)
  await clickTarget(run.page, { kind: 'part', ref: 'J1' })
  // The tag stands where the pointer has left it, not under the pointer's hover.
  await run.page.mouse.move(5, 5)
}

const in3d = async (run: Launched): Promise<void> => {
  await onSheet(run)
  await tab(run, '3D').click()
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().three?.loaded ?? false), { timeout: 20_000 }).toBe(true)
}

/** The marks of the mock's scene, made on the reference board round its regulator, and seen close. */
const onMarks = async (run: Launched): Promise<void> => {
  await onBoard(run)
  await markScene(run.page)
  await zoomOn(run.page, { kind: 'part', ref: 'U2' }, 900)
  await run.page.locator('[data-mark-row="M3"]').click()
  await run.page.mouse.move(5, 5)
}

/** An engine that routes, over a stand-in whose copper is a straight track for each open line. */
const ROUTES = { FAKE_KERNEL_SERVE: '2' }

/** The routed board, drawn: the route is started as the band's button does it. */
const routed = async (run: Launched): Promise<void> => {
  await onBoard(run)
  await startRoute(run.page)
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.state().build?.lastGood?.routing?.state ?? null), { timeout: 20_000 }).toBe('current')
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().board?.route ?? null)).not.toBeNull()
}

/** The page of projects, the open board's picture on its card. */
const onProjects = async (run: Launched, project: string): Promise<void> => {
  await expect.poll(() => existsSync(join(project, '.pino', 'thumb.json'))).toBe(true)
  await run.page.getByRole('button', { name: `Project ${basename(project)}` }).click()
  await run.page.getByRole('menuitem', { name: 'All projects' }).click()
  await expect.poll(() => run.page.locator('.project-picture img').evaluateAll((images) => images.map((img) => (img as HTMLImageElement).naturalWidth))).toEqual([480])
  await run.page.mouse.move(5, 5)
}

/** The Brief of a board in use: the person's words and cards, a size the board differs from, rules and the fab. */
const onBrief = async (run: Launched, project: string): Promise<void> => {
  await tab(run, 'Brief').click()
  writeFileSync(join(project, 'brief.md'), '# reference\n\nA USB-C board with an ESP32 and a 3.3 V regulator, for a sensor in the workshop.\n\n- It powers from 5 V and draws under 0.5 A\n- One SHT40 sensor over I2C\n\nThe datasheet is at https://example.org/datasheets/AP2112K.pdf\n')
  mkdirSync(join(project, '.pino', 'brief'), { recursive: true })
  const cards = [
    { id: 'C1', kind: 'frame', by: 'person', name: 'Power' },
    { id: 'C2', kind: 'power', by: 'person', frame: 'C1', text: 'USB-C, 5 V, 0.5 A' },
    { id: 'C3', kind: 'frame', by: 'person', name: 'Parts I have' },
    { id: 'C4', kind: 'part', by: 'person', frame: 'C3', text: 'pull-up', part: { lcsc: 'C25804', reading: { class: 'basic', package: '0603', stock: 1234567, price: 0.0024, checkedAt: '2026-11-26T05:00:00.000Z', fresh: true } } },
    { id: 'C5', kind: 'size', by: 'person', size: { what: 'Board width', value: '50', unit: 'mm', source: 'a guess' } },
    { id: 'C6', kind: 'size', by: 'agent', size: { what: 'Board height', value: '44', unit: 'mm', source: 'from Claude' } },
    { id: 'C7', kind: 'rule', by: 'person', text: 'Hand-solderable, 0805 or larger' },
    { id: 'C8', kind: 'fab', by: 'person', fab: { layers: 2, thickness: 1.6, assembly: 'jlc', boards: 5 } }
  ]
  writeFileSync(join(project, '.pino', 'brief', 'cards.json'), JSON.stringify({ next: 9, cards }))
  await expect(run.page.locator('[data-card="C7"]')).toBeVisible()
  await expect(run.page.locator('.brief-words')).toContainText('USB-C board')
  await run.page.mouse.move(5, 5)
}

/** What Claude wrote down over three prompts, the last two new since the person looked, one card changed. */
const onSpine = async (run: Launched, project: string): Promise<void> => {
  mkdirSync(join(project, '.pino', 'chat'), { recursive: true })
  mkdirSync(join(project, '.pino', 'brief'), { recursive: true })
  const at = (minute: number): number => Date.parse(`2026-11-26T10:${String(minute).padStart(2, '0')}:00.000Z`)
  const prompts = ['Make a small USB-C sensor board for the workshop, with an SHT40.', 'Power it from a LiPo cell instead.', 'Which LDO would you use?']
  writeFileSync(join(project, '.pino', 'chat', 'c1.jsonl'), prompts.map((text, i) => `${JSON.stringify({ kind: 'user', id: `u${i + 1}`, text, images: [], state: 'sent', at: at(i * 7) })}\n`).join(''))
  const turn = (n: number) => ({ prompt: `u${n}`, conversation: 'c1' })
  const cards = [
    { id: 'C1', kind: 'requirement', by: 'agent', text: 'Sensor: reads temperature and humidity every minute', turn: turn(1) },
    { id: 'C2', kind: 'decision', by: 'agent', text: 'Power: a single LiPo cell, charged over USB-C', turn: turn(2), was: [{ text: 'Power: USB-C, 5 V from a charger', turn: turn(1) }] },
    { id: 'C3', kind: 'question', by: 'agent', text: 'Case: which enclosure? The connector edge waits on it', turn: turn(2) },
    { id: 'C4', kind: 'part', by: 'agent', text: 'LDO: AP2112K-3.3, 600 mA', part: { lcsc: 'C51118', reading: { class: 'extended', package: 'SOT-25-5', stock: null, price: 0.09, checkedAt: '2026-11-03T22:33:00.000Z', fresh: true } }, turn: turn(3) }
  ]
  writeFileSync(join(project, '.pino', 'brief', 'cards.json'), JSON.stringify({ next: 5, cards }))
  // Seen: the first prompt's card as it is, and nothing newer.
  const { seenOf } = await import('../src/shared/brief')
  writeFileSync(join(project, '.pino', 'brief', 'seen.json'), JSON.stringify(seenOf([cards[0]] as never, new Date(at(1)).toISOString())))
  await tab(run, 'Brief').click()
  await expect(run.page.locator('[data-card="C4"]')).toBeVisible()
  await run.page.locator('[data-card="C4"] .brief-cn-id').click()
  await run.page.locator('.brief-voices').evaluate((el) => el.scrollIntoView())
  await run.page.mouse.move(5, 5)
}

/** An engine that makes fab files. */
const FABBED = { FAKE_KERNEL_SERVE: '3' }

/** The board with the "Fab files…" popover open: ready for a release, or just after one. */
const fabPopover = (release: boolean) => async (run: Launched): Promise<void> => {
  await onBoard(run)
  await run.page.getByRole('button', { name: 'Fab files…' }).click()
  const dialog = run.page.getByRole('dialog', { name: 'Fab files for JLCPCB' })
  await expect(dialog).toContainText('Next: v1.0.0')
  if (release) {
    await dialog.getByRole('button', { name: 'Make fab files' }).click()
    await expect(dialog).toContainText('Show in folder', { timeout: 20_000 })
  }
  await run.page.mouse.move(5, 5)
}

const SHOTS: Record<string, Shot> = {
  brief: { env: FABBED, at: onBrief },
  'brief-dark': { env: FABBED, dark: true, at: onBrief },
  'brief-spine': { at: onSpine },
  // The page below its first screenful: the sizes, the rules and the fab.
  'brief-foot': {
    env: FABBED,
    at: async (run, project) => {
      await onBrief(run, project)
      await run.page.locator('.brief-page').evaluate((el) => el.scrollTo(0, el.scrollHeight))
    }
  },
  'fab-ready': { env: FABBED, at: fabPopover(false) },
  'fab-ready-dark': { env: FABBED, dark: true, at: fabPopover(false) },
  'fab-released': { env: FABBED, at: fabPopover(true) },
  'fab-released-dark': { env: FABBED, dark: true, at: fabPopover(true) },
  'first-light': { first: true },
  'first-dark': { first: true, dark: true },
  projects: { at: onProjects },
  'projects-dark': { dark: true, at: onProjects },
  'marks-dense': {
    at: async (run) => {
      await onBoard(run)
      // Five marks within 3 mm of one another: their chips must stand clear of each other.
      await run.page.evaluate(async () => {
        const id = window.__pinoTest!.state().project!.id
        for (const number of ['1', '2', '3', '4', '5']) {
          await window.pino.marks.add(id, { kind: 'point', space: 'board', target: { kind: 'pad', ref: 'U2', number }, at: { x: 0, y: 0 }, note: `pad ${number}` })
        }
      })
      await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.state().marks.length)).toBe(5)
      await zoomOn(run.page, { kind: 'part', ref: 'U2' }, 600)
      await run.page.mouse.move(5, 5)
    }
  },
  'board-routing': {
    env: { ...ROUTES, FAKE_KERNEL_ROUTE_MS: '700' },
    at: async (run) => {
      await onBoard(run)
      await startRoute(run.page)
      await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.state().build?.route?.index ?? 0), { timeout: 20_000 }).toBeGreaterThanOrEqual(6)
    }
  },
  'board-routed': { env: ROUTES, at: routed },
  'board-stale': {
    env: { ...ROUTES, FAKE_KERNEL_MOVE: 'U2:2.5,0' },
    at: async (run, project) => {
      await routed(run)
      appendFileSync(join(project, 'board.py'), '\n# moved\n')
      await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().board?.stale ?? 0), { timeout: 20_000 }).toBeGreaterThan(0)
    }
  },
  'marks-routed': {
    env: ROUTES,
    at: async (run) => {
      await routed(run)
      await markScene(run.page)
      await markTrack(run.page)
      await zoomOn(run.page, { kind: 'part', ref: 'U2' }, 900)
      await run.page.mouse.move(5, 5)
    }
  },
  marks: { at: onMarks },
  'marks-dark': { dark: true, at: onMarks },
  'marks-drawing': {
    at: async (run) => {
      await onBoard(run)
      await zoomOn(run.page, { kind: 'part', ref: 'U2' }, 900)
      await run.page.keyboard.press('d')
      const from = await screenOf(run.page, { kind: 'pad', ref: 'U2', number: '1' })
      await run.page.mouse.move(from.x, from.y)
      await run.page.mouse.down()
      for (const [dx, dy] of [[-30, 20], [-55, 55], [-50, 100], [-20, 130], [30, 140], [75, 125]]) await run.page.mouse.move(from.x + dx, from.y + dy, { steps: 6 })
      // held there: the picture is of a stroke being drawn
    }
  },
  '3d': { at: in3d },
  '3d-dark': { dark: true, at: in3d },
  sheet: { at: onSheet },
  'sheet-dark': { dark: true, at: onSheet },
  board: { at: onBoard },
  'board-1920': { width: 1920, height: 1080, at: onBoard },
  'board-dark': { dark: true, at: onBoard },
  'board-nets': { at: press('n') },
  'board-bottom': { at: press('2') }
}

test.beforeAll(() => {
  mkdirSync(folder!, { recursive: true })
})

for (const [name, shot] of Object.entries(SHOTS)) {
  test(name, async () => {
    const project = referenceProject()
    // The first screen with the stand-in found, as on a machine that is ready.
    const size: Record<string, string> = shot.width ? { PINO_TEST_SIZE: `${shot.width}x${shot.height}` } : {}
    const run = await launch({ ...(shot.first ? { agent: true } : { project }), env: { ...shot.env, ...size } })
    try {
      const scheme = shot.dark ? ('dark' as const) : ('light' as const)
      await run.app.evaluate(({ nativeTheme }, source) => void (nativeTheme.themeSource = source), scheme)
      // Playwright emulates a scheme of its own: it is told the same one.
      await run.page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme })
      // Made at its size by main (PINO_TEST_SIZE): the picture is of that, or the run is wrong.
      await expect.poll(() => run.page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([shot.width ?? 1440, shot.height ?? 900])
      if (shot.first) await expect(run.page.locator('.welcome-ready li[data-ok]')).toHaveCount(3)
      else await waitForBuild(run.page, 1)
      await shot.at?.(run, project)
      await run.page.evaluate(() => document.fonts.ready.then(() => undefined))
      await settled(run.page)
      // The canvas of a hidden window reaches the compositor a frame or two after it is drawn.
      await run.page.waitForTimeout(300)
      await capture(run.app, join(folder!, `${name}.png`))
    } finally {
      await run.app.close()
    }
  })
}
