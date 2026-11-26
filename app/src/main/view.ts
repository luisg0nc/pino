// What the person has on screen, as the window says it: the tab, how the board is looked at and what is selected.
// What comes from the window is not taken at its word.

import type { Target } from '../shared/board/refs'
import { isRecord } from '../shared/build'
import type { BoardLook, Selection, ViewTab } from '../shared/view'

export interface SeenView {
  tab: ViewTab
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
  if (!isRecord(value) || !TABS.includes(value.tab as ViewTab) || !isRecord(value.look)) return null
  const { active, pours, ratsnest, silk, netColours } = value.look
  if (!line(active) || ![pours, ratsnest, silk, netColours].every((v) => typeof v === 'boolean')) return null
  const look = { active, pours, ratsnest, silk, netColours } as BoardLook
  return { tab: value.tab as ViewTab, look, selection: selectionOf(value.selection) }
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
