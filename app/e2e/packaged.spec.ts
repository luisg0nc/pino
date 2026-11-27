import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, referenceProject, tempFolder } from './launch'

// The packaged app: skipped unless PINO_PACKAGED names its executable, the one of `pnpm pack:check`,
// `app/dist/linux-unpacked/pino-app`, from the repository root: `PINO_PACKAGED=$PWD/app/dist/linux-unpacked/pino-app
// pnpm -C app exec playwright test e2e/packaged.spec.ts`. It is the one spec that does not start the app from `out/`.
// It needs uv, KiCad 10 and, once, the network: the run's home is empty, so uv fetches what builds the engine into it.
const packaged = process.env.PINO_PACKAGED ? resolve(process.env.PINO_PACKAGED) : undefined

test.skip(!packaged, "PINO_PACKAGED names the packaged app's executable")
test.describe.configure({ mode: 'serial' })

/** Every file and folder under `root` with its size and modification time: what must not change during a run. */
function listing(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((path) => {
      const stat = lstatSync(join(root, path))
      return `${path} ${stat.isDirectory() ? 'dir' : stat.size} ${stat.mtimeMs}`
    })
    .sort()
}

test('reaches the first screen, hidden, and finds the engine it carries', async () => {
  test.setTimeout(420_000) // the engine's environment is made anew in each run
  const before = listing(dirname(packaged!))
  const { app, page } = await launch({ packaged: packaged!, kernel: 'real', agent: true })
  try {
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    await expect(page.locator('.plate-headline')).toHaveText('pino')
    await expect(page.getByRole('list', { name: 'What pino needs' }).getByRole('listitem')).toHaveText(
      [/Claude Code/, /^KiCad 10\.\S+ found, with its libraries$/, "pino's Python environment is ready"],
      { timeout: 360_000 }
    )
    const resources = await app.evaluate(() => process.resourcesPath)
    expect(existsSync(join(resources, 'icon.png'))).toBe(true)
    // What the window bundles carries its notices, in the asar.
    const notices = await app.evaluate(({ app }) => {
      const fs = process.getBuiltinModule('node:fs')
      return fs.readFileSync(`${app.getAppPath()}/out/renderer/third-party-licenses.txt`, 'utf8')
    })
    for (const name of ['react ', 'react-dom ', 'three ', 'zustand ', '@fontsource/instrument-sans ', '@fontsource/martian-mono ']) expect(notices).toContain(name)
    // The engine's environment is under the profile (`userData`), never in the package.
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    expect(existsSync(join(userData, 'kernel-env'))).toBe(true)
    expect(existsSync(join(resources, 'kernel', '.venv'))).toBe(false)
  } finally {
    await app.close()
  }
  expect(listing(dirname(packaged!))).toEqual(before)
})

// An AppImage is mounted somewhere new at every start, and the environment kept under userData points at the engine of
// the start before: uv has to move it.
test("finds its engine again at the next start, in the environment kept from the one before", async () => {
  test.setTimeout(420_000)
  const env = { PINO_TEST_PROFILE: tempFolder('profile'), UV_CACHE_DIR: tempFolder('uv') }
  for (const start of [1, 2]) {
    const { app, page } = await launch({ packaged: packaged!, kernel: 'real', env })
    try {
      await expect(page.getByRole('list', { name: 'What pino needs' }).getByRole('listitem').last(), `start ${start}`).toHaveText("pino's Python environment is ready", { timeout: 360_000 })
    } finally {
      await app.close()
    }
  }
})

test('builds the reference board with the engine it carries, and writes nothing inside the package', async () => {
  test.setTimeout(420_000)
  const dir = referenceProject()
  const before = listing(dirname(packaged!))
  const { app, page } = await launch({ packaged: packaged!, kernel: 'real', project: dir, env: { PINO_CACHE_DIR: tempFolder('cache') } })
  try {
    await expect
      .poll(() => page.evaluate(() => window.__pinoTest!.state().build?.latest?.verdict ?? window.__pinoTest!.state().build?.problem ?? null), { timeout: 360_000, intervals: [1000] })
      .not.toBeNull()
    const build = (await page.evaluate(() => window.__pinoTest!.state().build))!
    expect(build.problem).toBeNull()
    expect(build.latest!.verdict).not.toBe('failed')
    expect(existsSync(join(dir, '.pino'))).toBe(true)
    // The engine is given nothing of an AppImage's mount, where the package is one.
    const engine = await app.evaluate(() => (globalThis as unknown as { __pinoMain: { kernelPid(): number | null } }).__pinoMain.kernelPid())
    const given = readFileSync(`/proc/${engine}/environ`, 'utf8').split('\0')
    expect(given.filter((entry) => /^(APPDIR|APPIMAGE|ARGV0|OWD)=|\.mount_/.test(entry))).toEqual([])
    expect(given.some((entry) => entry.startsWith('UV_PROJECT_ENVIRONMENT='))).toBe(true)
  } finally {
    await app.close()
  }
  expect(listing(dirname(packaged!))).toEqual(before)
})
