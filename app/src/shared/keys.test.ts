import { expect, it } from 'vitest'
import { cheatSheet, CONTEXTS, domKey, hint, KEYS, keyClashes, keyName, pressed, pressOf, typed, which, type KeyRow } from './keys'

it('has no two rows on one key in one scope', () => {
  expect(keyClashes()).toEqual([])
})

it('lists each row in the sheet under where it is listened to, and says what it does in sentence case', () => {
  const sheet = cheatSheet()
  expect(sheet.map((g) => g.context)).toEqual(CONTEXTS.map((c) => c.name).filter((name) => KEYS.some((r) => r.context === name && !r.hidden)))
  for (const group of sheet) expect([group.context, group.rows.length > 0, group.when.length > 0]).toEqual([group.context, true, true])
  expect(sheet.flatMap((g) => g.rows).map((r) => r.id).sort()).toEqual(KEYS.filter((r) => !r.hidden).map((r) => r.id).sort())
  for (const row of KEYS) expect([row.id, /^[A-Z]/.test(row.does), row.keys.length > 0]).toEqual([row.id, true, true])
  expect(new Set(KEYS.map((row) => row.id)).size).toBe(KEYS.length)
})

const extra = (keys: string[], scope: KeyRow['scope']): KeyRow => ({ id: 'menu.close', keys, does: 'Something else', context: 'In a field, a menu or a sheet', scope })

it('finds a key given twice in one scope, and one heard everywhere that something else has too', () => {
  expect(keyClashes([extra(['Z'], 'menu'), extra(['Z'], 'menu')])).toEqual(['Z (menu)'])
  // A key of two scopes that are never live together is each one's own.
  expect(keyClashes([extra(['Z'], 'menu'), extra(['Z'], 'field')])).toEqual([])
  expect(keyClashes([extra(['?'], 'window'), extra(['?'], 'menu')])).toEqual(['? (window, menu)'])
  expect(keyClashes([extra(['Ctrl+Shift+E'], 'global'), extra(['Ctrl+Shift+E'], 'field')])).toEqual(['Ctrl+Shift+E (global, field)'])
})

it('names a key press as the table does', () => {
  expect(keyName({ key: 'v' })).toBe('V')
  expect(keyName({ key: 'V', shiftKey: true })).toBe('V')
  expect(keyName({ key: '?', shiftKey: true })).toBe('?')
  expect(keyName({ key: 'Escape' })).toBe('Esc')
  expect(keyName({ key: 'ArrowLeft', shiftKey: true })).toBe('Shift+Left')
  expect(keyName({ key: 'Enter', shiftKey: true })).toBe('Shift+Enter')
  // A chord is named by the key's place, whatever character the layout and the modifiers make of it.
  expect(keyName({ key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+E')
  expect(keyName({ key: '`', code: 'Backquote', ctrlKey: true })).toBe('Ctrl+`')
  expect(keyName({ key: 'F12' })).toBe('F12')
  expect(keyName(pressOf({ key: 'c', code: 'KeyC', control: true, shift: false, alt: false, meta: false }))).toBe('Ctrl+C')
  expect(domKey('Esc')).toBe('Escape')
  expect(domKey('Left')).toBe('ArrowLeft')
  expect(domKey('Enter')).toBe('Enter')
})

it('says which key of a row was pressed', () => {
  expect(which({ key: 'ArrowDown' }, 'menu.next')).toBe(0)
  expect(which({ key: 'ArrowRight' }, 'menu.next')).toBe(1)
  expect(which({ key: 'x' }, 'menu.next')).toBe(-1)
  expect(which({ key: 'End' }, 'menu.ends')).toBe(1)
  expect(pressed({ key: 'Escape' }, 'menu.close')).toBe(true)
  // Shift with a key is that key where Shift with it has no row of its own; a chord is never anything but itself.
  expect(pressed({ key: 'Tab', shiftKey: true }, 'menu.close')).toBe(true)
  expect(pressed({ key: 'Escape', ctrlKey: true }, 'menu.close')).toBe(false)
  expect(hint('menu.close')).toBe('Esc')
})

it('knows what typing would take', () => {
  for (const key of ['V', '?', 'Esc', 'Enter', 'Shift+Enter', 'Left', 'Ctrl+C', 'Ctrl+R']) expect([key, typed(key)]).toEqual([key, true])
  for (const key of ['Ctrl+Shift+E', 'F6', 'Ctrl+`', 'F12']) expect([key, typed(key)]).toEqual([key, false])
})
