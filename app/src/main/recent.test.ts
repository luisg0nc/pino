import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { MAX_RECENT, configOf, listed, recentWith, recentWithout } from './recent'

const made: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pino-recent-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('keeps the folders opened last, the newest first, each once, eight at most', () => {
  expect(recentWith([], '/a')).toEqual(['/a'])
  expect(recentWith(['/a', '/b'], '/b')).toEqual(['/b', '/a'])
  const nine = Array.from({ length: 9 }, (_, i) => `/f${i}`).reduce<string[]>((list, root) => recentWith(list, root), [])
  expect(nine).toHaveLength(MAX_RECENT)
  expect(MAX_RECENT).toBe(8)
  expect(nine[0]).toBe('/f8')
  expect(nine).not.toContain('/f0')
  expect(recentWithout(['/a', '/b'], '/a')).toEqual(['/b'])
  expect(recentWithout(['/a'], '/x')).toEqual(['/a'])
})

it('reads a config file, and nothing from what is not one', () => {
  expect(configOf({ project: '/w/a', workspace: '/w', workspaces: ['/w'] }, '/h')).toEqual({ workspace: '/w', project: '/w/a', workspaces: ['/w'] })
  expect(configOf(null, '/h')).toEqual({ workspaces: [] })
  expect(configOf('text', '/h')).toEqual({ workspaces: [] })
  expect(configOf({ project: 4, workspace: 'relative', workspaces: 'no', recent: 'no' }, '/h')).toEqual({ workspaces: [] })
})

it('turns the recent project folders into recent workspaces, once', () => {
  expect(configOf({ project: '/w/a', recent: ['/w/a', '/w/b', '/x/c'] }, '/h')).toEqual({ workspace: '/w', project: '/w/a', workspaces: ['/w', '/x'] })
  expect(configOf({ workspace: '/w', project: '/w/a', workspaces: [], recent: ['/x/c'] }, '/h')).toEqual({ workspace: '/w', project: '/w/a', workspaces: [] })
})

it('never makes the home or the root a workspace', () => {
  expect(configOf({ project: '/h/blinky', recent: ['/h/blinky', '/top'] }, '/h')).toEqual({ project: '/h/blinky', workspaces: [] })
  expect(configOf({ workspace: '/h', workspaces: ['/', '/h/', '/h/boards'] }, '/h')).toEqual({ workspaces: ['/h/boards'] })
})

it('keeps whole paths only, once each, eight at most', () => {
  expect(configOf({ workspaces: ['/a', 3, '', 'relative', '/b', '/a'] }, '/h').workspaces).toEqual(['/a', '/b'])
  expect(configOf({ workspaces: Array.from({ length: 10 }, (_, i) => `/f${i}`) }, '/h').workspaces).toHaveLength(8)
  expect(configOf({ recent: Array.from({ length: 10 }, (_, i) => `/f${i}/p`) }, '/h').workspaces).toHaveLength(8)
})

it('says which of them is no longer a folder', async () => {
  const dir = temp()
  mkdirSync(join(dir, 'here'))
  writeFileSync(join(dir, 'file'), '')
  expect(await listed([join(dir, 'here'), join(dir, 'gone'), join(dir, 'file')])).toEqual([
    { root: join(dir, 'here'), missing: false },
    { root: join(dir, 'gone'), missing: true },
    { root: join(dir, 'file'), missing: true }
  ])
})
