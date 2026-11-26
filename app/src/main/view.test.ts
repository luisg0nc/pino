import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOK } from '../shared/view'
import { ViewHolder, viewOf } from './view'

const selection = { tab: 'board', target: { kind: 'pad', ref: 'U2', number: '1' }, text: 'pad U2.1', label: 'U2.1' }

describe('what the window says it shows', () => {
  it('takes the tab, the way the board is looked at, and the selection', () => {
    expect(viewOf({ tab: 'board', look: DEFAULT_LOOK, selection })).toEqual({ tab: 'board', look: DEFAULT_LOOK, selection })
    expect(viewOf({ tab: '3d', look: { ...DEFAULT_LOOK, active: 'B.Cu', extra: 1 }, selection: null })).toEqual({ tab: '3d', look: { ...DEFAULT_LOOK, active: 'B.Cu' }, selection: null })
  })

  it('takes nothing that is not that', () => {
    expect(viewOf(null)).toBeNull()
    expect(viewOf({ tab: 'terminal', look: DEFAULT_LOOK, selection: null })).toBeNull()
    expect(viewOf({ tab: 'board', look: { ...DEFAULT_LOOK, pours: 'yes' }, selection: null })).toBeNull()
    for (const bad of [{ ...selection, text: 'x'.repeat(5000) }, { ...selection, text: 'a\nb' }, { ...selection, target: { kind: 'file', path: '/etc' } }, { ...selection, label: 7 }]) {
      expect(viewOf({ tab: 'board', look: DEFAULT_LOOK, selection: bad })!.selection).toBeNull()
    }
  })

  it('holds the view of the open project, and no other', () => {
    const holder = new ViewHolder()
    holder.tell('p1', { tab: 'board', look: DEFAULT_LOOK, selection: null })
    expect(holder.of('p1')!.tab).toBe('board')
    expect(holder.of('p2')).toBeNull()
    holder.tell('p1', 'nonsense')
    expect(holder.of('p1')!.tab).toBe('board')
    holder.forget('p1')
    expect(holder.of('p1')).toBeNull()
  })
})
