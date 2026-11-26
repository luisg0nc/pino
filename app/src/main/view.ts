// What the person has on screen, as the window says it: the tab, how the board is looked at and what is selected.
// What comes from the window is not taken at its word.

import type { BrowserWindow } from 'electron'
import type { Target } from '../shared/board/refs'
import { isRecord } from '../shared/build'
import { type BoardLook, PANE_TABS, type PaneTab, type Selection, type ViewTab } from '../shared/view'

export interface SeenView {
  tab: PaneTab
  look: BoardLook
  selection: Selection | null
}

const TABS: readonly ViewTab[] = ['schematic', 'board', '3d']
const MOST_TEXT = 2000

/** One line of text, short enough to go into a prompt. */
const line = (v: unknown): v is string => typeof v === 'string' && v.length <= MOST_TEXT && !/[\r\n]/.test(v)

const TARGET_KEYS: Record<Target['kind'], string[]> = { part: ['ref'], pad: ['ref', 'number'], net: ['name'], track: ['uuid'], via: ['uuid'], zone: ['uuid'] }

export function targetOfValue(v: unknown): Target | null {
  if (!isRecord(v) || typeof v.kind !== 'string' || !Object.hasOwn(TARGET_KEYS, v.kind)) return null
  const kind = v.kind as Target['kind']
  if (!TARGET_KEYS[kind].every((k) => line(v[k]))) return null
  const named = Object.fromEntries(TARGET_KEYS[kind].map((k) => [k, v[k]]))
  if (kind !== 'zone') return { kind, ...named } as Target
  const at = v.at
  return isRecord(at) && Number.isFinite(at.x) && Number.isFinite(at.y) ? { kind, uuid: v.uuid as string, at: { x: at.x as number, y: at.y as number } } : null
}

function selectionOf(v: unknown): Selection | null {
  if (!isRecord(v) || !TABS.includes(v.tab as ViewTab) || !line(v.text) || !line(v.label)) return null
  const target = targetOfValue(v.target)
  return target ? { tab: v.tab as ViewTab, target, text: v.text, label: v.label } : null
}

export function viewOf(value: unknown): SeenView | null {
  if (!isRecord(value) || !PANE_TABS.includes(value.tab as PaneTab) || !isRecord(value.look)) return null
  const { active, pours, ratsnest, silk, netColours } = value.look
  if (!line(active) || ![pours, ratsnest, silk, netColours].every((v) => typeof v === 'boolean')) return null
  const look = { active, pours, ratsnest, silk, netColours } as BoardLook
  return { tab: value.tab as PaneTab, look, selection: selectionOf(value.selection) }
}

/** The view of the one open project. */
export class ViewHolder {
  private held: { projectId: string; view: SeenView } | null = null

  tell(projectId: string, value: unknown): void {
    const view = viewOf(value)
    if (view) this.held = { projectId, view }
  }

  of(projectId: string): SeenView | null {
    return this.held?.projectId === projectId ? this.held.view : null
  }

  forget(projectId: string): void {
    if (this.held?.projectId === projectId) this.held = null
  }
}

/** The window gave no answer: it took too long, or was closed. */
export class NoAnswer extends Error {}

const waiting = new Map<number, (answer: unknown) => void>()
let nextId = 1

/**
 * Asks the window to do something it alone can, and waits for what it answers (torno's request pattern). Rejects with
 * the window's own words, when it does not answer in time, and when it is closed meanwhile.
 */
export function askWindow<T>(win: BrowserWindow, kind: 'look', request: unknown, timeoutMs = 10_000): Promise<T> {
  if (win.isDestroyed()) return Promise.reject(new NoAnswer('the window is closed'))
  return new Promise<T>((resolve, reject) => {
    const id = nextId++
    const end = () => {
      waiting.delete(id)
      clearTimeout(timer)
      win.removeListener('closed', closed)
    }
    const closed = () => {
      end()
      reject(new NoAnswer('the window was closed'))
    }
    const timer = setTimeout(() => {
      end()
      reject(new NoAnswer(`the window did not answer within ${Math.round(timeoutMs / 1000)} s`))
    }, timeoutMs)
    waiting.set(id, (answer) => {
      end()
      const error = isRecord(answer) && typeof answer.error === 'string' ? answer.error : null
      if (error !== null) reject(new Error(error))
      else resolve(answer as T)
    })
    win.once('closed', closed)
    win.webContents.send('view:ask', { id, kind, req: request })
  })
}

/** The window's answer to question `id`. One that is late, repeated or of no question is dropped. */
export function takeAnswer(id: unknown, answer: unknown): void {
  if (typeof id === 'number') waiting.get(id)?.(answer)
}
