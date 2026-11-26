// Makes app/test/fixtures/reference-build/: the reference board (kernel/tests/fixtures/reference) built once with
// the real engine, so the app's tests read what the engine really writes; and app/test/fixtures/fab-profiles.json,
// the engine's own fab profiles. Needs uv and kicad-cli. Parts answer from the kernel's recorded jlcsearch fixtures,
// with a parts cache of the run's own, so nothing is asked over the network and the user's cache is not read.
// Run it from anywhere: node app/scripts/reference-build.mjs. It writes those two and nothing else.

import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kernel = resolve(app, '..', 'kernel')
const out = join(app, 'test', 'fixtures', 'reference-build')

/** What the app reads of a build, by the name the result lists it under. */
const FILES = {
  board: 'board.kicad_pcb',
  filled: 'filled/board.kicad_pcb',
  schematic_svg: 'schematic.svg',
  sheet: 'sheet.json',
  circuit: 'circuit.json',
  placement: 'placement.json',
  drc: 'drc.json',
  glb: 'board.glb'
}

const env = { ...process.env }
delete env.DISPLAY
delete env.WAYLAND_DISPLAY

const work = mkdtempSync(join(tmpdir(), 'pino-reference-'))
try {
  env.PINO_CACHE_DIR = join(work, 'cache')
  env.PINO_PARTS_RECORDED = join(kernel, 'tests', 'fixtures', 'parts', 'jlcsearch')
  const profiles = execFileSync('uv', ['run', '--directory', kernel, 'python', '-c', 'import json; from pino_kernel.fab import PROFILES; print(json.dumps([p.to_json() for p in PROFILES.values()], indent=1))'], { env, encoding: 'utf8' })
  writeFileSync(join(app, 'test', 'fixtures', 'fab-profiles.json'), profiles)
  const project = join(work, 'reference')
  cpSync(join(kernel, 'tests', 'fixtures', 'reference'), project, { recursive: true })
  const stdout = execFileSync('uv', ['run', '--directory', kernel, 'pino-kernel', 'build', project, '--no-cache'], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const result = JSON.parse(stdout)
  if (result.verdict === 'failed') throw new Error(result.headline)
  rmSync(out, { recursive: true, force: true })
  for (const file of Object.values(FILES)) {
    mkdirSync(dirname(join(out, file)), { recursive: true })
    copyFileSync(join(project, '.pino', 'build', result.hash, file), join(out, file))
  }
  // the result lists what is in the fixture, and nothing that is not
  result.artifacts = Object.fromEntries(Object.keys(FILES).map((name) => [name, result.artifacts[name]]))
  writeFileSync(join(out, 'result.json'), `${JSON.stringify(result, null, 1)}\n`)
  console.log(`${result.headline}\nwrote ${Object.keys(FILES).length + 1} files to app/test/fixtures/reference-build`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
