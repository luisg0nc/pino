// Where the tests find the fixtures: the reference build (app/scripts/reference-build.mjs makes it with the real
// engine), the hand-written tiny board and the engine's stand-in. Paths are absolute, from this file.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const APP_DIR = resolve(__dirname, '..', '..')
export const FAKE_KERNEL = resolve(APP_DIR, 'test', 'fake-kernel.mjs')
export const REFERENCE_BUILD = resolve(APP_DIR, 'test', 'fixtures', 'reference-build')

export const fx = (name: string): string => resolve(REFERENCE_BUILD, name)
export const read = (path: string): string => readFileSync(resolve(APP_DIR, path), 'utf8')
export const readJson = <T = unknown>(path: string): T => JSON.parse(read(path)) as T
export const tinyBoard = (): string => read('test/fixtures/boards/tiny.kicad_pcb')

/** Whether a process of this id is there: asked of processes a test started, by their pids. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A folder that is a project: a temp folder with a board.py in it. The caller removes it. */
export function tempProject(name = 'board'): { root: string; dir: string; touch: (text?: string) => void; remove: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'pino-project-'))
  const dir = join(root, name)
  mkdirSync(dir)
  const touch = (text = `b = ${Math.random()}\n`) => writeFileSync(join(dir, 'board.py'), text)
  touch('b = 1\n')
  return { root, dir, touch, remove: () => rmSync(root, { recursive: true, force: true }) }
}
