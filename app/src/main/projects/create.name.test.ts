// The hidden folder a new project is made in is named from the app's one name: under another name, what is made and
// what is swept follow it.
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createProject, sweepStaleNew } from './create'
import { makeReadings } from './readings'

vi.mock('../../shared/app', async (original) => {
  const actual = await original<typeof import('../../shared/app')>()
  return { ...actual, APP: { ...actual.APP, name: 'other' } }
})

const root = mkdtempSync(join(realpathSync(tmpdir()), 'pino-create-name-'))
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('makes and sweeps its temp folder under the app’s name', async () => {
  let temp = ''
  await createProject(
    { name: 'blinky', description: 'Blinks.', photos: [], doodles: [], pdfs: [], power: [], connections: [], sizes: [], enclosure: '', edges: '', parts: [], fab: null, rules: '', links: [] },
    { root, readings: makeReadings(), hooks: { beforeRename: (at) => void (temp = at) } }
  )
  expect(temp.slice(root.length + 1)).toMatch(/^\.blinky\.other-new-[0-9a-f]{12}$/)
  const stale = '.x.other-new-0123456789ab'
  mkdirSync(join(root, stale))
  const old = new Date(Date.now() - 3_600_000)
  utimesSync(join(root, stale), old, old)
  sweepStaleNew(root, Date.now())
  expect(readdirSync(root)).toEqual(['blinky'])
})
