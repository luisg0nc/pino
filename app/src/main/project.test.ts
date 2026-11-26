import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openProject, projectIdOf } from './project'

let tmp: string
let real: string
let file: string

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'pino-project-')))
  real = join(tmp, 'blinky')
  mkdirSync(real)
  file = join(tmp, 'board.py')
  writeFileSync(file, '')
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('a project', () => {
  it('opens a real folder by its real path, with a stable id', async () => {
    const p = await openProject(real)
    expect(p).toEqual({ id: projectIdOf(real), dir: real, name: basename(real) })
    expect((await openProject(real)).id).toBe(p.id)
  })

  it('gives a folder the same id through a link or a trailing slash', async () => {
    symlinkSync(real, join(tmp, 'a link'))
    const p = await openProject(real)
    expect(await openProject(join(tmp, 'a link'))).toEqual(p)
    expect(await openProject(`${real}/`)).toEqual(p)
  })

  it('opens a folder whose name has spaces, unicode or a leading dash', async () => {
    for (const n of ['my board', 'placa-ção', '-dash']) {
      mkdirSync(join(tmp, n))
      await expect(openProject(join(tmp, n))).resolves.toMatchObject({ name: n, dir: join(tmp, n) })
    }
  })

  it('refuses a file and a missing path in plain words', async () => {
    await expect(openProject(file)).rejects.toThrow('board.py is not a folder pino can open: it is a file')
    await expect(openProject(join(tmp, 'gone'))).rejects.toThrow('gone is not a folder pino can open: it is not there')
  })

  it('refuses a folder it may not read', async () => {
    const shut = join(tmp, 'shut')
    mkdirSync(shut)
    chmodSync(shut, 0o000)
    try {
      await expect(openProject(shut)).rejects.toThrow('shut is not a folder pino can open: it cannot be read')
    } finally {
      chmodSync(shut, 0o755)
    }
  })

  it('refuses a path that is not a whole one', async () => {
    await expect(openProject('blinky')).rejects.toThrow('is not a folder pino can open')
    await expect(openProject('')).rejects.toThrow('is not a folder pino can open')
  })

  it('makes ids that are one URL segment', () => {
    expect(projectIdOf('/a b/ç')).toMatch(/^p[0-9a-f]{12}$/)
    expect(projectIdOf('/a b/c')).not.toBe(projectIdOf('/a b/ç'))
  })
})
