// Where the tests find the fixtures: the reference build (app/scripts/reference-build.mjs makes it with the real
// engine), the hand-written tiny board and the engine's stand-in. Paths are absolute, from this file.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const APP_DIR = resolve(__dirname, '..', '..')
export const FAKE_KERNEL = resolve(APP_DIR, 'test', 'fake-kernel.mjs')
export const REFERENCE_BUILD = resolve(APP_DIR, 'test', 'fixtures', 'reference-build')

export const fx = (name: string): string => resolve(REFERENCE_BUILD, name)
export const read = (path: string): string => readFileSync(resolve(APP_DIR, path), 'utf8')
export const readJson = <T = unknown>(path: string): T => JSON.parse(read(path)) as T
export const tinyBoard = (): string => read('test/fixtures/boards/tiny.kicad_pcb')
