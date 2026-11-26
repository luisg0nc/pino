// The one spec that runs the real engine, through uv, on the reference board: that the app and the engine agree on
// what a build is. It is skipped where uv, kicad-cli or the engine's environment is missing (CI).

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { readBoard } from '../src/shared/board/board'
import { describeTarget, type Target } from '../src/shared/board/refs'
import { circuitOf } from '../src/shared/circuit'
import { findCommand } from '../src/main/sessions/choice'
import { clickTarget } from './helpers'
import { launch, referenceProject } from './launch'

const kernel = resolve(__dirname, '../../kernel')
const here = ['uv', 'kicad-cli'].every((command) => findCommand(command, process.env.PATH)) && existsSync(join(kernel, '.venv'))

test.skip(!here, "needs uv and kicad-cli on PATH, and the engine's environment (uv sync in kernel/)")
test.setTimeout(180_000)

test('builds the reference board with the real engine, and draws it', async () => {
  const dir = referenceProject()
  // The environment that is there is used as it is: the run's home is empty, and nothing is fetched into it.
  const { app, page } = await launch({ project: dir, kernel: 'real', env: { UV_NO_SYNC: '1', UV_OFFLINE: '1' } })
  try {
    await expect.poll(() => page.evaluate(() => window.__pinoTest!.state().build?.latest?.verdict ?? window.__pinoTest!.state().build?.problem ?? null), { timeout: 150_000 }).not.toBeNull()
    const build = (await page.evaluate(() => window.__pinoTest!.state().build))!
    expect(build.problem).toBeNull()
    expect(build.latest!.verdict).not.toBe('failed')
    expect(build.engine.state).toBe('ready')
    await page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: 'Board' }).click()
    await expect.poll(() => page.evaluate(() => window.__pinoTest!.drawn().board?.hash ?? null)).toBe(build.latest!.hash)

    const pad: Target = { kind: 'pad', ref: 'U2', number: '1' }
    await clickTarget(page, pad)
    const folder = join(dir, '.pino', 'build', build.latest!.hash!)
    const board = readBoard(readFileSync(join(folder, 'filled', 'board.kicad_pcb'), 'utf8'))
    const circuit = circuitOf(JSON.parse(readFileSync(join(folder, 'circuit.json'), 'utf8')))
    await expect.poll(() => page.evaluate(() => window.__pinoTest!.state().selection?.text ?? null)).toBe(describeTarget(board, circuit, pad))

    await page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: 'Schematic' }).click()
    await expect.poll(() => page.evaluate(() => window.__pinoTest!.drawn().sheet?.symbols ?? 0)).toBeGreaterThan(0)
    await page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: '3D' }).click()
    await expect.poll(() => page.evaluate(() => window.__pinoTest!.drawn().three?.loaded ?? false), { timeout: 30_000 }).toBe(true)
  } finally {
    await app.close()
  }
})
