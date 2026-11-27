// The screenshots the design review compares with the picked mockups. It runs only when PINO_SHOTS names a folder
// outside the repository: `PINO_SHOTS=/some/folder pnpm -C app exec playwright test e2e/shots.spec.ts`.
//
// Each picture is a launch of its own: a hidden window's `capturePage()` gives one picture, and the next call never
// returns (torno found the same).

import { appendFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { capture, clickTarget, markScene, markTrack, screenOf, settled, startRoute, waitForBuild, zoomOn } from './helpers'
import { launch, referenceProject, tempFolder, type Launched } from './launch'

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

/** The New project page, filled: opened from a board's menu, with every PCB slot holding something. */
const onNewProject = async (run: Launched, project: string): Promise<void> => {
  await run.page.getByRole('button', { name: `Project ${basename(project)}` }).click()
  await run.page.getByRole('menuitem', { name: 'New project…' }).click()
  const page = run.page.getByRole('region', { name: 'New project', exact: true })
  await page.getByRole('textbox', { name: 'Name' }).fill('sensor-node')
  await page.getByRole('textbox', { name: 'What it does' }).fill('Reads temperature and humidity every minute and sends them over Wi-Fi from a LiPo cell.')
  const open = (title: string) => page.getByRole('list', { name: 'Add' }).getByRole('button', { name: title, exact: true }).click()
  await open('Power')
  await page.getByRole('button', { name: 'Add a power source' }).click()
  await page.getByRole('combobox', { name: 'Source of power 1' }).selectOption('battery')
  await page.getByRole('textbox', { name: 'Which battery, power 1' }).fill('LiPo 1S')
  await page.getByRole('textbox', { name: 'Voltage of power 1' }).fill('3.7')
  await open('Connections')
  await page.getByRole('button', { name: 'Add a connection' }).click()
  await page.getByRole('textbox', { name: 'What connection 1 is' }).fill('SHT40 sensor')
  await page.getByRole('textbox', { name: 'Connector of connection 1' }).fill('JST-SH 4-pin')
  await open('Size and shape')
  await page.getByRole('button', { name: 'Board width' }).click()
  await page.getByRole('textbox', { name: 'Value of size 1' }).fill('50')
  await page.getByRole('textbox', { name: 'Connector edges' }).fill('USB on a short edge')
  await open('Parts I have')
  await page.getByRole('button', { name: 'Add a part' }).click()
  await page.getByRole('textbox', { name: 'Part 1', exact: true }).fill('C25804')
  await expect(page.getByRole('listitem', { name: 'Part 1', exact: true })).toContainText('stock 1,234,567')
  await open('Fab and assembly')
  await open('Rules')
  await page.getByRole('textbox', { name: 'Rules' }).fill('Hand-solderable, 0805 or larger')
  await run.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await run.page.locator('.new-column').evaluate((el) => el.scrollTo(0, 0))
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
  'new-project': { env: FABBED, at: onNewProject },
  'new-project-dark': { env: FABBED, dark: true, at: onNewProject },
  'new-project-foot': {
    env: FABBED,
    at: async (run, project) => {
      await onNewProject(run, project)
      await run.page.locator('.new-column').evaluate((el) => el.scrollTo(0, el.scrollHeight))
    }
  },
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

// ---- the landing page's pictures (site/index.html): `app/scripts/site-images.py` crops them (docs/images/README.md)

/** A board to take them of, built and routed: only ever read, each launch works on a copy of its own. */
const siteBoard = process.env.PINO_SITE_BOARD ? resolve(process.env.PINO_SITE_BOARD) : null

/**
 * What of the board's folder stays behind: the conversations, the session and the marks, which are the person's; the
 * Brief and the thumbnail, which the copy makes anew; and the files that hold a path of the machine or a lock.
 */
const LEFT_BEHIND = [/^\.pino\/(chat|marks|kicad|brief)$/, /^\.pino\/(session\.json|thumb\.png|thumb\.json)$/, /(^|\/)(log\.txt|[^/]+\.lock)$/]

/** The board in a workspace of its own, `<temp>/boards/simple-blinker`, with a Brief written for the picture. */
function siteCopy(): string {
  const dir = join(tempFolder('site'), 'boards', 'simple-blinker')
  cpSync(siteBoard!, dir, { recursive: true, filter: (from) => !LEFT_BEHIND.some((left) => left.test(relative(siteBoard!, from))) })
  writeFileSync(join(dir, 'brief.md'), '# Simple blinker\n\nA small board that runs on a 9 V battery. Press the button and the LED blinks three times, then waits for the next press.\n')
  mkdirSync(join(dir, '.pino', 'brief'), { recursive: true })
  // The person's own cards, so that the picture puts no words in Claude's mouth. What they say is in board.py.
  const cards = [
    { id: 'C1', kind: 'requirement', by: 'person', text: 'One press of the button blinks the LED three times' },
    { id: 'C2', kind: 'part', by: 'person', text: 'Step clock: ICM7555, a CMOS 555', part: { lcsc: 'C434506' } },
    { id: 'C3', kind: 'power', by: 'person', text: '9 V battery on a snap, about 30 uA between presses' },
    { id: 'C4', kind: 'decision', by: 'person', text: 'A CD4017 counts the blinks, then holds the 555 in reset' }
  ]
  writeFileSync(join(dir, '.pino', 'brief', 'cards.json'), JSON.stringify({ next: 5, cards }))
  return dir
}

const onSiteBrief = async (run: Launched): Promise<void> => {
  await tab(run, 'Brief').click()
  await expect(run.page.locator('[data-card="C4"]')).toBeVisible()
  await expect(run.page.locator('.brief-words')).toContainText('9 V battery')
}
const onSiteSheet = async (run: Launched): Promise<void> => {
  await tab(run, 'Schematic').click()
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().sheet?.symbols ?? 0)).toBeGreaterThan(0)
  // Fitted, a block's title can stand under the tool rail: the sheet is dragged clear of it, from a bare part of it.
  await run.page.mouse.move(900, 820)
  await run.page.mouse.down()
  await run.page.mouse.move(900, 842, { steps: 8 })
  await run.page.mouse.up()
}
/** The Board, with the route the copy brought drawn on it. */
const onSiteBoard = async (run: Launched): Promise<void> => {
  await onBoard(run)
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.state().build?.lastGood?.routing?.state ?? null), { timeout: 30_000 }).toBe('current')
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().board?.route ?? null)).not.toBeNull()
}
const onSite3d = async (run: Launched): Promise<void> => {
  await onSiteBoard(run)
  await tab(run, '3D').click()
  await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.drawn().three?.loaded ?? false), { timeout: 30_000 }).toBe(true)
}

const SITE_SHOTS: Record<string, Pick<Shot, 'dark'> & { at(run: Launched): Promise<void> }> = {
  brief: { at: onSiteBrief },
  schematic: { at: onSiteSheet },
  board: { at: onSiteBoard },
  '3d': { at: onSite3d },
  hero: { at: onSiteBoard },
  'hero-dark': { dark: true, at: onSiteBoard }
}

test.describe('site', () => {
  test.skip(siteBoard === null || !existsSync(join(siteBoard, 'board.py')), 'set PINO_SITE_BOARD to a board folder')
  test.setTimeout(180_000)

  for (const [name, shot] of Object.entries(SITE_SHOTS)) {
    test(name, async () => {
      // The real engine, which fetches nothing into the run's empty home and looks no part up.
      const env = { UV_NO_SYNC: '1', UV_OFFLINE: '1', PINO_CACHE_DIR: tempFolder('cache'), PINO_TEST_SIZE: '1600x1000' }
      const run = await launch({ project: siteCopy(), agent: true, kernel: 'real', env })
      try {
        const scheme = shot.dark ? ('dark' as const) : ('light' as const)
        await run.app.evaluate(({ nativeTheme }, source) => void (nativeTheme.themeSource = source), scheme)
        await run.page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme })
        await expect.poll(() => run.page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([1600, 1000])
        await expect.poll(() => run.page.evaluate(() => window.__pinoTest!.state().build?.latest?.verdict ?? null), { timeout: 150_000 }).toBe('ok')
        await waitForBuild(run.page, 1)
        await shot.at(run)
        await run.page.mouse.move(5, 5)
        await run.page.evaluate(() => document.fonts.ready.then(() => undefined))
        await settled(run.page)
        await run.page.waitForTimeout(1500)
        // Nothing of the person's home is on screen or in a tooltip, the title bar first.
        const title = run.page.locator('[data-region="title"]')
        await expect(title).toContainText('simple-blinker')
        for (const said of [await title.innerHTML(), await run.page.evaluate(() => `${document.title}\n${document.body.innerText}`)]) expect(said).not.toContain(homedir())
        // The window's regions, in the page's pixels, for the crops.
        const boxes = await run.page.evaluate(() => {
          const found: Record<string, { x: number; y: number; width: number; height: number }> = {}
          for (const el of document.querySelectorAll<HTMLElement>('[data-region]')) {
            const { x, y, width, height } = el.getBoundingClientRect()
            if (width > 0 && height > 0) found[el.dataset.region!] ??= { x, y, width, height }
          }
          return { window: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }, ...found }
        })
        writeFileSync(join(folder!, `site-${name}.json`), JSON.stringify(boxes, null, 1))
        await capture(run.app, join(folder!, `site-${name}.png`))
      } finally {
        await run.app.close()
      }
    })
  }
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
