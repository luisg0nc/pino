import { afterEach, describe, expect, it } from 'vitest'
import { MOST_MARKS } from '../../shared/marks'
import type { ProjectInfo } from '../../shared/project'
import { tempProject } from '../../test/fixtures'
import { toolsOver } from '../../test/mcp'
import { referenceModel } from '../../test/marks'
import { MarkStore } from '../marks/store'

const model = referenceModel()
const made: Array<() => void> = []
afterEach(() => made.splice(0).forEach((remove) => remove()))

async function tools() {
  const temp = tempProject()
  made.push(temp.remove)
  const project: ProjectInfo = { id: 'p1', dir: temp.dir, name: 'reference' }
  const store = new MarkStore({ model: async () => model })
  const t = await toolsOver({ project: () => project, model: async () => model, state: () => undefined, marks: store })
  return { ...t, project, store }
}

describe('point', () => {
  it('makes orange marks the view will draw, and says their ids', async () => {
    const t = await tools()
    expect(await t.call('point', { targets: ['U2', 'U2.1'], note: 'these two' })).toBe('Pointed: M1 U2, M2 U2.1. They are orange in the view.')
    expect((await t.store.list(t.project)).map((m) => [m.id, m.author, m.status, m.note])).toEqual([
      ['M1', 'agent', 'sent', 'these two'],
      ['M2', 'agent', 'sent', 'these two']
    ])
  })

  it('with an unknown name makes nothing, and offers the nearest names', async () => {
    const t = await tools()
    const said = await t.call('point', { targets: ['U2', 'U9', 'net:VBUSS'] })
    expect(said).toContain('No part U9. Nearest: U1, U2')
    expect(said).toContain('No net VBUSS. Nearest: VBUS')
    expect(await t.store.list(t.project)).toEqual([])
  })

  it('at a gap draws the arrow across it, labelled with what measure says', async () => {
    const t = await tools()
    const measured = /: (\d+\.\d\d) mm/.exec(await t.call('measure', { what: 'gap', a: 'C3', b: 'U2' }))![1]
    expect(await t.call('point', { targets: [{ gap: ['C3', 'U2'] }] })).toBe(`Pointed: M1 gap ${measured} mm. They are orange in the view.`)
    const [mark] = await t.store.list(t.project)
    expect(mark).toMatchObject({ kind: 'arrow', author: 'agent', from: { kind: 'part', ref: 'C3' }, label: `gap ${measured} mm` })
  })

  it('on the sheet stands where the sheet draws the thing, and takes no gap', async () => {
    const t = await tools()
    await t.call('point', { targets: ['U2'], space: 'sheet' })
    const symbol = model.sheet!.symbols.find((s) => s.ref === 'U2')!
    expect((await t.store.list(t.project))[0]).toMatchObject({ kind: 'point', space: 'sheet', at: { x: (symbol.x0 + symbol.x1) / 2, y: (symbol.y0 + symbol.y1) / 2 } })
    expect(await t.call('point', { targets: [{ gap: ['C3', 'U2'] }], space: 'sheet' })).toBe('A gap is measured on the board: leave space out.')
  })

  it('takes one to eight targets, and never more marks than pino keeps', async () => {
    const t = await tools()
    expect(await t.call('point', { targets: [] })).toBe('point takes 1 to 8 targets.')
    expect(await t.call('point', { targets: Array(9).fill('U2') })).toBe('point takes 1 to 8 targets.')
    for (let i = 0; i < MOST_MARKS - 1; i++) await t.store.add(t.project, { kind: 'point', space: 'board', target: { kind: 'part', ref: 'U2' }, at: { x: 0, y: 0 }, note: '' }, 'agent')
    expect(await t.call('point', { targets: ['U1', 'U2'] })).toBe(`pino keeps ${MOST_MARKS} marks: resolve or remove some`)
    expect(await t.store.list(t.project)).toHaveLength(MOST_MARKS - 1)
  })
})

describe('marks and resolve_mark', () => {
  it('lists the marks with their exact lines, open ones first, resolved ones only when asked', async () => {
    const t = await tools()
    expect(await t.call('marks')).toBe('There are no open marks.')
    await t.store.add(t.project, { kind: 'point', space: 'board', target: { kind: 'part', ref: 'C3' }, at: { x: 0, y: 0 }, note: 'closer to U2' }, 'user')
    await t.call('point', { targets: ['U2'] })
    await t.call('resolve_mark', { id: 'M2', note: 'looked' })
    const [first, second] = await t.store.list(t.project)
    expect(await t.call('marks')).toBe(`M1 · draft · person · ${first.payload} · note: "closer to U2"`)
    expect(await t.call('marks', { status: 'all' })).toBe(`M1 · draft · person · ${first.payload} · note: "closer to U2"\nM2 · resolved · you · ${second.payload} · resolved: "looked"`)
  })

  it('refuses a draft and an id that is not there, and resolves a sent mark with its note', async () => {
    const t = await tools()
    await t.store.add(t.project, { kind: 'point', space: 'board', target: { kind: 'part', ref: 'C3' }, at: { x: 0, y: 0 }, note: '' }, 'user')
    expect(await t.call('resolve_mark', { id: 'M1', note: 'done' })).toBe('M1 has not been sent to you yet')
    expect(await t.call('resolve_mark', { id: 'M9', note: 'done' })).toBe('there is no mark M9')
    await t.store.markSent(t.project, ['M1'])
    expect(await t.call('resolve_mark', { id: 'M1', note: 'moved C3 by 2 mm' })).toBe('Resolved M1: moved C3 by 2 mm')
    expect((await t.store.list(t.project))[0]).toMatchObject({ status: 'resolved', resolvedBy: 'agent', resolvedNote: 'moved C3 by 2 mm' })
  })
})
