import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { KeptCause } from '../shared/build'
import { KEPT_CAUSES, readCauses, writeCauses } from './buildCauses'

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'pino-causes-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const put = (text: string): void => {
  mkdirSync(join(dir, '.pino'), { recursive: true })
  writeFileSync(join(dir, '.pino', 'build-causes.json'), text)
}
const file = (builds: unknown[]): string => JSON.stringify({ schema: 'pino.build-causes/1', builds })

describe('reading the causes', () => {
  it('is empty when there is no file, or it is not one', async () => {
    expect((await readCauses(dir)).size).toBe(0)
    put('{nope')
    expect((await readCauses(dir)).size).toBe(0)
    put(JSON.stringify({ schema: 'pino.build-causes/2', builds: [{ number: 1, cause: 'person' }] }))
    expect((await readCauses(dir)).size).toBe(0)
    put(JSON.stringify({ schema: 'pino.build-causes/1', builds: 'x' }))
    expect((await readCauses(dir)).size).toBe(0)
    put('[]')
    expect((await readCauses(dir)).size).toBe(0)
  })

  it('reads each row, and drops one with a bad number, cause or turn', async () => {
    put(
      file([
        { number: 1, cause: 'person' },
        { number: 2, cause: 'agent', turn: { prompt: 'u1', conversation: 'c1' } },
        { number: 3, cause: 'agent', turn: { prompt: 'u2' } },
        { number: 4, cause: 'route' },
        { number: 5, cause: 'unknown' },
        { number: 'x', cause: 'person' },
        { number: 0, cause: 'person' },
        { number: 1.5, cause: 'person' },
        { number: 6, cause: 'robot' },
        { number: 7, cause: 'agent', turn: 'u1' },
        { number: 8, cause: 'agent', turn: { prompt: 3 } },
        { number: 9, cause: 'agent', turn: { prompt: 'u1', conversation: 4 } },
        null,
        7
      ])
    )
    expect([...(await readCauses(dir))]).toEqual([
      [1, { cause: 'person' }],
      [2, { cause: 'agent', turn: { prompt: 'u1', conversation: 'c1' } }],
      [3, { cause: 'agent', turn: { prompt: 'u2' } }],
      [4, { cause: 'route' }],
      [5, { cause: 'unknown' }]
    ])
  })

  it('reads nothing through a link or a file in place of .pino', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'pino-causes-elsewhere-'))
    try {
      writeFileSync(join(elsewhere, 'build-causes.json'), file([{ number: 1, cause: 'person' }]))
      symlinkSync(elsewhere, join(dir, '.pino'))
      expect((await readCauses(dir)).size).toBe(0)
      rmSync(join(dir, '.pino'))
      writeFileSync(join(dir, '.pino'), 'x')
      expect((await readCauses(dir)).size).toBe(0)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})

describe('writing the causes', () => {
  it('writes them whole, round trips, and has git pass over the file', async () => {
    const causes = new Map<number, KeptCause>([
      [1, { cause: 'unknown' }],
      [2, { cause: 'agent', turn: { prompt: 'u1', conversation: 'c1' } }]
    ])
    await writeCauses(dir, causes)
    const on = JSON.parse(readFileSync(join(dir, '.pino', 'build-causes.json'), 'utf8'))
    expect(on).toEqual({ schema: 'pino.build-causes/1', builds: [{ number: 1, cause: 'unknown' }, { number: 2, cause: 'agent', turn: { prompt: 'u1', conversation: 'c1' } }] })
    expect(readFileSync(join(dir, '.pino', '.gitignore'), 'utf8')).toContain('build-causes.json\n')
    expect([...(await readCauses(dir))]).toEqual([...causes])
  })

  it('keeps the newest 200 by number', async () => {
    const causes = new Map<number, KeptCause>()
    for (let n = 300; n >= 1; n--) causes.set(n, { cause: 'person' })
    await writeCauses(dir, causes)
    const read = await readCauses(dir)
    expect(read.size).toBe(KEPT_CAUSES)
    expect(KEPT_CAUSES).toBe(200)
    expect(Math.min(...read.keys())).toBe(101)
    expect(Math.max(...read.keys())).toBe(300)
  })

  it('writes nothing through a link in place of .pino', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'pino-causes-elsewhere-'))
    try {
      symlinkSync(elsewhere, join(dir, '.pino'))
      await expect(writeCauses(dir, new Map([[1, { cause: 'person' }]]))).rejects.toThrow(/link/)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})
