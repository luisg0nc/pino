import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NewMark } from '../../shared/marks'
import { tempProject } from '../../test/fixtures'
import { modelOf, tiny } from '../../test/marks'
import type { BuildModel } from '../model'
import { MarkStore } from './store'

let temp: ReturnType<typeof tempProject>
let model: BuildModel | null
beforeEach(() => {
  temp = tempProject()
  model = modelOf(tiny)
})
afterEach(() => temp.remove())

const project = () => ({ id: 'p1', dir: temp.dir, name: 'board' })
const store = (notices: string[] = []) => new MarkStore({ model: async () => model, now: () => new Date('2026-11-26T09:00:00Z'), notice: (t) => notices.push(t) })
const part = (ref = 'R1'): Extract<NewMark, { kind: 'point' }> => ({ kind: 'point', space: 'board', target: { kind: 'part', ref }, at: { x: 0, y: 0 }, note: '' })
const onDisk = () => JSON.parse(readFileSync(join(temp.dir, '.pino/marks/marks.json'), 'utf8'))

describe('the mark store', () => {
  it('makes a mark whole: id, build, payload, label and time', async () => {
    const mark = await store().add(project(), part(), 'user')
    expect(mark).toEqual({
      id: 'M1', author: 'user', status: 'draft', anchor: 'ok', build: 2, checkedBuild: 2, note: '', label: 'M1', createdAt: '2026-11-26T09:00:00.000Z',
      payload: 'part R1 · 10k · R_0402_1005Metric · at (0.00, 0.00) mm · rot 0° · top', kind: 'point', space: 'board', target: { kind: 'part', ref: 'R1' }, at: { x: 0, y: 0 }
    })
    expect(onDisk().marks).toEqual([mark])
  })

  it('numbers marks M1, M2 and never reuses a removed id', async () => {
    const s = store()
    expect((await s.add(project(), part(), 'user')).id).toBe('M1')
    expect((await s.add(project(), part('U1'), 'user')).id).toBe('M2')
    await s.remove(project(), 'M2')
    expect((await s.add(project(), part(), 'user')).id).toBe('M3')
    expect((await store().add(project(), part(), 'user')).id).toBe('M4')
  })

  it("keeps the person's marks as drafts and Claude's as sent", async () => {
    const s = store()
    await s.add(project(), part(), 'user')
    const agent = await s.add(project(), part('U1'), 'agent')
    expect(agent).toMatchObject({ author: 'agent', status: 'sent', label: 'U1' })
    expect((await s.drafts(project())).map((m) => m.id)).toEqual(['M1'])
    expect((await s.open(project())).map((m) => m.id)).toEqual(['M2'])
    await s.markSent(project(), ['M1', 'M9'])
    expect(await s.drafts(project())).toEqual([])
    expect((await s.open(project())).map((m) => m.id)).toEqual(['M1', 'M2'])
  })

  it('works out what a stroke crosses itself, whatever the window said', async () => {
    const mark = await store().add(project(), { kind: 'stroke', layer: 'F.Cu', points: [{ x: -2, y: 0 }, { x: 6, y: 0 }], crosses: { nets: ['LIE'], parts: [] }, note: '' }, 'user')
    expect(mark).toMatchObject({ crosses: { nets: ['A', 'GND'], parts: ['R1', 'U1'] } })
  })

  it('refuses a mark on what is not there, with nothing built, and past its limit', async () => {
    await expect(store().add(project(), part('R9'), 'user')).rejects.toThrow('R9 is not on this board')
    await expect(store().add(project(), { ...part(), at: { x: Number.NaN, y: 0 } }, 'user')).rejects.toThrow('that is not a mark')
    model = null
    await expect(store().add(project(), part(), 'user')).rejects.toThrow('there is no build to mark yet')
    model = modelOf(tiny)
    const full = { schema: 'pino.marks/1', next: 201, marks: Array.from({ length: 200 }, (_, i) => ({ id: `M${i + 1}`, author: 'user', status: 'sent', anchor: 'ok', build: 1, note: '', payload: 'p', label: 'l', createdAt: 't', kind: 'point', space: 'board', target: { kind: 'part', ref: 'R1' }, at: { x: 0, y: 0 } })) }
    mkdirSync(join(temp.dir, '.pino/marks'), { recursive: true })
    writeFileSync(join(temp.dir, '.pino/marks/marks.json'), JSON.stringify(full))
    await expect(store().add(project(), part(), 'user')).rejects.toThrow('pino keeps 200 marks: resolve or remove some')
  })

  it('one write at a time: ten adds at once give ten marks in the file', async () => {
    const s = store()
    await Promise.all(Array.from({ length: 10 }, () => s.add(project(), part(), 'user')))
    expect(onDisk().marks.map((m: { id: string }) => m.id)).toEqual(Array.from({ length: 10 }, (_, i) => `M${i + 1}`))
  })

  it('takes a note, an intent and a layer, and can put a sent mark back among the drafts', async () => {
    const s = store()
    const region: NewMark = { kind: 'region', layers: ['F.Cu', 'B.Cu'], intent: null, holds: [], points: [{ x: -2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: -2 }], note: '' }
    await s.add(project(), region, 'user')
    const updated = await s.update(project(), 'M1', { note: '  a clip goes here  ', intent: 'keep-clear', layer: 'B.Cu' })
    expect(updated).toMatchObject({ note: 'a clip goes here', intent: 'keep-clear', layers: ['B.Cu'] })
    expect(updated.payload).toMatch(/^keep this clear: region · bottom copper · /)
    await s.markSent(project(), ['M1'])
    expect((await s.update(project(), 'M1', { status: 'draft' })).status).toBe('draft')
    await expect(s.update(project(), 'M1', { note: 'n'.repeat(301) })).rejects.toThrow('300 characters')
    await expect(s.update(project(), 'M1', { layer: 'In9.Cu' })).rejects.toThrow('this board has no layer In9.Cu')
    await expect(s.update(project(), 'M9', { note: 'x' })).rejects.toThrow('there is no mark M9')
  })

  it('resolves a sent mark with its note, and no draft', async () => {
    const s = store()
    await s.add(project(), part(), 'user')
    await expect(s.resolve(project(), 'M1', 'done', 'agent')).rejects.toThrow('M1 has not been sent to you yet')
    await s.markSent(project(), ['M1'])
    expect(await s.resolve(project(), 'M1', 'moved it', 'agent')).toMatchObject({ status: 'resolved', resolvedNote: 'moved it', resolvedBy: 'agent' })
    expect(await s.open(project())).toEqual([])
  })

  it('re-anchors on a build, and writes only when something moved', async () => {
    const s = store()
    await s.add(project(), part(), 'user')
    const heard: number[] = []
    s.onChange((_id, marks) => heard.push(marks.length))
    await s.reanchor(project(), modelOf({ ...tiny, footprints: tiny.footprints.filter((f) => f.ref !== 'R1') }, { number: 3 }))
    expect((await s.list(project()))[0]).toMatchObject({ anchor: 'stale', checkedBuild: 3 })
    await s.reanchor(project(), modelOf(tiny, { number: 4, hash: null, verdict: 'failed' }))
    expect(heard).toEqual([1])
  })

  it('says a damaged file once, and starts with no marks', async () => {
    mkdirSync(join(temp.dir, '.pino/marks'), { recursive: true })
    writeFileSync(join(temp.dir, '.pino/marks/marks.json'), 'nope')
    const notices: string[] = []
    const s = store(notices)
    expect(await s.list(project())).toEqual([])
    await s.list(project())
    expect(notices).toHaveLength(1)
    expect(s.takeProblem(project().id)).toContain('could not be read')
    expect(s.takeProblem(project().id)).toBeNull()
  })
})
