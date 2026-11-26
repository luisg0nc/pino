import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { BuildResult } from '../shared/build'
import { tempProject } from '../test/fixtures'
import { fx, readJson } from '../test/fixtures'
import { artifactPath, readArtifact, readRouteFile, resultOfBuild, routePath } from './artifacts'

let temp: ReturnType<typeof tempProject>
const project = () => ({ id: 'p1', dir: temp.dir, name: 'board' })
const HASH = 'aaaaaaaa0001'
const result = (artifacts: Record<string, string> = { board: `.pino/build/${HASH}/board.kicad_pcb`, glb: `.pino/build/${HASH}/board.glb` }) =>
  ({ number: 1, hash: HASH, artifacts }) as unknown as BuildResult

beforeEach(() => {
  temp = tempProject()
  const folder = join(temp.dir, '.pino', 'build', HASH)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'board.kicad_pcb'), '(kicad_pcb)')
  writeFileSync(join(folder, 'board.glb'), Buffer.from([1, 2, 3]))
  writeFileSync(join(folder, 'result.json'), '{}')
})
afterEach(() => temp.remove())

it('names a file of a build, inside its folder', () => {
  expect(artifactPath(project(), HASH, 'board', result())).toBe(join(temp.dir, '.pino/build', HASH, 'board.kicad_pcb'))
})

it('refuses a name the result does not list, and a hash that is not one', () => {
  expect(() => artifactPath(project(), '../../etc', 'board', result())).toThrow('not a build hash')
  expect(() => artifactPath(project(), HASH, 'glb', result({}))).toThrow('h1 has no glb')
  expect(() => artifactPath(project(), HASH, 'svg' as never, result({ svg: 'x' }))).toThrow('h1 has no svg')
})

it('refuses a path that leaves the build folder', () => {
  for (const path of ['board.py', `.pino/build/${HASH}/../../../board.py`, '/etc/passwd', `.pino/build/aaaaaaaa0002/board.kicad_pcb`]) {
    expect(() => artifactPath(project(), HASH, 'board', result({ board: path })), path).toThrow('is not in the folder of its build')
  }
})

it('reads text as text and the model as bytes', async () => {
  expect(await readArtifact(project(), HASH, 'board', result())).toBe('(kicad_pcb)')
  expect([...((await readArtifact(project(), HASH, 'glb', result())) as Uint8Array)]).toEqual([1, 2, 3])
})

it('reads nothing through a link that leads out of the build folder', async () => {
  writeFileSync(join(temp.root, 'secret'), 'no')
  symlinkSync(join(temp.root, 'secret'), join(temp.dir, '.pino/build', HASH, 'sheet.json'))
  await expect(readArtifact(project(), HASH, 'sheet', result({ sheet: `.pino/build/${HASH}/sheet.json` }))).rejects.toThrow('is not in the folder of its build')
})

it("names a route's files by its key", async () => {
  expect(routePath(project(), 'cccccccc00000001', 'filled')).toBe(join(temp.dir, '.pino/routes/cccccccc00000001/filled/board.kicad_pcb'))
  expect(routePath(project(), 'cccccccc00000001', 'route')).toBe(join(temp.dir, '.pino/routes/cccccccc00000001/route.json'))
  expect(() => routePath(project(), '../x', 'board')).toThrow('not a route key')
  expect(() => routePath(project(), 'cccccccc00000001', 'log' as never)).toThrow('a route has no log')
  await expect(readRouteFile(project(), 'cccccccc00000001', 'board')).rejects.toThrow()
})

it('finds the result of a build by its hash: the one in hand, else the one its folder keeps', async () => {
  const known = result()
  expect(await resultOfBuild(project(), HASH, [null, known])).toBe(known)
  const kept = { ...readJson<BuildResult>(fx('result.json')), hash: 'aaaaaaaa0002', number: 2 }
  mkdirSync(join(temp.dir, '.pino/build/aaaaaaaa0002'))
  writeFileSync(join(temp.dir, '.pino/build/aaaaaaaa0002/result.json'), JSON.stringify(kept))
  expect((await resultOfBuild(project(), 'aaaaaaaa0002', [known])).number).toBe(2)
  await expect(resultOfBuild(project(), 'aaaaaaaa0003', [])).rejects.toThrow('build aaaaaaaa0003 is no longer kept')
  await expect(resultOfBuild(project(), HASH, [])).rejects.toThrow('build aaaaaaaa0001 is no longer kept')
  await expect(resultOfBuild(project(), '..', [])).rejects.toThrow('not a build hash')
})
