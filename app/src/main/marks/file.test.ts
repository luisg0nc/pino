import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tempProject } from '../../test/fixtures'
import { arrow, point, region, stroke } from '../../test/marks'
import { loadMarks, sanitiseMark, saveMarks } from './file'

let temp: ReturnType<typeof tempProject>
beforeEach(() => (temp = tempProject()))
afterEach(() => temp.remove())

const marksFile = () => join(temp.dir, '.pino/marks/marks.json')
const put = (text: string) => {
  mkdirSync(join(temp.dir, '.pino/marks'), { recursive: true })
  writeFileSync(marksFile(), text)
}

describe('the marks file', () => {
  it('writes atomically under .pino/marks and reads it back', async () => {
    const file = { schema: 'pino.marks/1' as const, next: 5, marks: [point({ payload: 'p' }), arrow(), stroke(), region()] }
    await saveMarks(temp.dir, file)
    expect(JSON.parse(readFileSync(marksFile(), 'utf8'))).toEqual(file)
    expect(await loadMarks(temp.dir)).toEqual({ file })
    expect(readdirSync(join(temp.dir, '.pino/marks'))).toEqual(['marks.json'])
  })

  it('is empty where there is none', async () => {
    expect(await loadMarks(temp.dir)).toEqual({ file: { schema: 'pino.marks/1', next: 1, marks: [] } })
    expect(existsSync(join(temp.dir, '.pino'))).toBe(false)
  })

  it('a damaged file is set aside and said', async () => {
    put('{nope')
    const { file, problem } = await loadMarks(temp.dir)
    expect(file.marks).toEqual([])
    expect(problem).toBe('Your marks file could not be read. It was kept as .pino/marks/marks.json.bad-1.')
    expect(readFileSync(join(temp.dir, '.pino/marks/marks.json.bad-1'), 'utf8')).toBe('{nope')
    expect(existsSync(marksFile())).toBe(false)
  })

  it('sets aside, and drops nothing silently, a file of another schema or with one mark that is none', async () => {
    writeFileSync(join(temp.root, 'x'), '')
    for (const [i, text] of ['{"schema":"pino.marks/2","next":1,"marks":[]}', JSON.stringify({ schema: 'pino.marks/1', next: 2, marks: [point(), { id: 'M2' }] }), '{"schema":"pino.marks/1","next":"1","marks":[]}'].entries()) {
      put(text)
      expect((await loadMarks(temp.dir)).problem).toContain(`marks.json.bad-${i + 1}`)
    }
  })

  it('never gives an id out twice, whatever the file says is next', async () => {
    put(JSON.stringify({ schema: 'pino.marks/1', next: 1, marks: [point({ id: 'M9' })] }))
    expect((await loadMarks(temp.dir)).file.next).toBe(10)
  })

  it('refuses to write through a .pino that is a link', async () => {
    const outside = join(temp.root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(temp.dir, '.pino'))
    await expect(saveMarks(temp.dir, { schema: 'pino.marks/1', next: 1, marks: [] })).rejects.toThrow('is a link')
    expect(readdirSync(outside)).toEqual([])
    const loaded = await loadMarks(temp.dir)
    expect(loaded.file.marks).toEqual([])
    expect(loaded.problem).toContain('is a link')
  })

  it('refuses to write through a marks folder that is a link', async () => {
    mkdirSync(join(temp.dir, '.pino'))
    symlinkSync(temp.root, join(temp.dir, '.pino/marks'))
    await expect(saveMarks(temp.dir, { schema: 'pino.marks/1', next: 1, marks: [] })).rejects.toThrow('is a link')
    expect(existsSync(join(temp.root, 'marks.json'))).toBe(false)
  })
})

describe('a mark from a file or the window', () => {
  it('takes each kind whole', () => {
    for (const mark of [point(), arrow(), stroke(), region()]) expect(sanitiseMark(mark)).toEqual(mark)
  })

  it('takes nothing that is not a mark', () => {
    const bad = [
      null,
      point({ id: 'X1' as never }),
      point({ status: 'new' as never }),
      point({ note: 'n'.repeat(301) }),
      point({ at: { x: Infinity, y: 0 } }),
      point({ target: { kind: 'file' } as never }),
      stroke({ points: Array.from({ length: 401 }, () => ({ x: 0, y: 0 })) }),
      stroke({ points: [{ x: 0 } as never] }),
      region({ intent: 'delete' as never }),
      { ...point(), kind: 'circle' }
    ]
    for (const mark of bad) expect(sanitiseMark(mark)).toBeNull()
  })

  it('keeps no field it does not know', () => {
    expect(sanitiseMark({ ...point(), extra: '../../x' })).toEqual(point())
  })
})
