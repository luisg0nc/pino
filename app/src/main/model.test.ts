import { cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { BuildResult } from '../shared/build'
import { fx, readJson, REFERENCE_BUILD, tempProject } from '../test/fixtures'
import { Models } from './model'

let temp: ReturnType<typeof tempProject>
const HASH = readJson<BuildResult>(fx('result.json')).hash!
const reference = readJson<BuildResult>(fx('result.json'))
const project = () => ({ id: 'p1', dir: temp.dir, name: 'board' })

beforeEach(() => {
  temp = tempProject()
  mkdirSync(join(temp.dir, '.pino/build'), { recursive: true })
  cpSync(REFERENCE_BUILD, join(temp.dir, '.pino/build', HASH), { recursive: true })
})
afterEach(() => temp.remove())

it("reads a build's board, circuit, placement and sheet", async () => {
  const model = (await new Models().get(project(), reference))!
  expect(model.board.footprints.map((f) => f.ref)).toContain('U2')
  expect(model.circuit!.nets.map((n) => n.name)).toContain('VBUS')
  expect(model.placement!.edges.length).toBeGreaterThan(0)
  expect(model.sheet!.frames).toHaveLength(3)
  expect(model.routeBoard).toBeNull()
})

it('parses a build once, and gives the result as it stands now', async () => {
  const models = new Models()
  const a = await models.get(project(), reference)
  const b = await models.get(project(), { ...reference, number: 9, cached: true })
  expect(b!.board).toBe(a!.board)
  expect(b!.result.number).toBe(9)
})

it('has nothing for a build that drew nothing, or whose folder is gone', async () => {
  expect(await new Models().get(project(), { ...reference, hash: null, verdict: 'failed' })).toBeNull()
  expect(await new Models().get(project(), { ...reference, hash: 'aaaaaaaa0099', artifacts: { board: '.pino/build/aaaaaaaa0099/board.kicad_pcb' } })).toBeNull()
})
