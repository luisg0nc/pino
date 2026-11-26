import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOK } from '../shared/view'
import { askWindow, NoAnswer, takeAnswer, ViewHolder, viewOf } from './view'

const selection = { tab: 'board', target: { kind: 'pad', ref: 'U2', number: '1' }, text: 'pad U2.1', label: 'U2.1' }

describe('what the window says it shows', () => {
  it('takes the tab, the way the board is looked at, and the selection', () => {
    expect(viewOf({ tab: 'board', look: DEFAULT_LOOK, selection })).toEqual({ tab: 'board', look: DEFAULT_LOOK, selection })
    expect(viewOf({ tab: '3d', look: { ...DEFAULT_LOOK, active: 'B.Cu', extra: 1 }, selection: null })).toEqual({ tab: '3d', look: { ...DEFAULT_LOOK, active: 'B.Cu' }, selection: null })
  })

  it('takes nothing that is not that', () => {
    expect(viewOf(null)).toBeNull()
    expect(viewOf({ tab: 'terminal', look: DEFAULT_LOOK, selection: null })).toBeNull()
    // The Brief is what the person may see too, though nothing is selected on it.
    expect(viewOf({ tab: 'brief', look: DEFAULT_LOOK, selection: null })?.tab).toBe('brief')
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

describe('asking the window', () => {
  function window_() {
    const sent: Array<{ channel: string; message: { id: number; kind: string; req: unknown } }> = []
    const closers: Array<() => void> = []
    let destroyed = false
    const win = {
      isDestroyed: () => destroyed,
      once: (_e: string, cb: () => void) => closers.push(cb),
      removeListener: () => {},
      webContents: { send: (channel: string, message: never) => sent.push({ channel, message }) }
    } as never
    return {
      win,
      sent,
      close() {
        destroyed = true
        closers.forEach((cb) => cb())
      }
    }
  }

  it('sends the question with an id, and takes the one answer of that id', async () => {
    const w = window_()
    const asked = askWindow<{ ok: number }>(w.win, 'look', { size: 800 })
    expect(w.sent[0]).toMatchObject({ channel: 'view:ask', message: { kind: 'look', req: { size: 800 } } })
    const { id } = w.sent[0].message
    takeAnswer(id + 100, { ok: 0 })
    takeAnswer(id, { ok: 1 })
    takeAnswer(id, { ok: 2 })
    expect(await asked).toEqual({ ok: 1 })
  })

  it("rejects with the window's own words, when it takes too long, and when it is closed", async () => {
    const w = window_()
    const failed = askWindow(w.win, 'look', {})
    takeAnswer(w.sent[0].message.id, { error: 'there is no build to draw' })
    await expect(failed).rejects.toThrow('there is no build to draw')
    await expect(askWindow(w.win, 'look', {}, 20)).rejects.toBeInstanceOf(NoAnswer)
    const closing = askWindow(w.win, 'look', {})
    w.close()
    await expect(closing).rejects.toThrow('the window was closed')
    await expect(askWindow(w.win, 'look', {})).rejects.toThrow('the window is closed')
  })
})
