import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { clampDock, DOCK_DEFAULT, DOCK_KEY, DOCK_MIN, DOCK_NARROW, dockDefault, NARROW_WINDOW, readDock, VIEWPORT_MIN, windowStorage, writeDock } from './dock'

function memory(start: Record<string, string> = {}): Storage & { data: Record<string, string> } {
  const data = { ...start }
  return {
    data,
    get length() {
      return Object.keys(data).length
    },
    clear: () => Object.keys(data).forEach((key) => delete data[key]),
    key: (n: number) => Object.keys(data)[n] ?? null,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => void (data[key] = value),
    removeItem: (key: string) => void delete data[key]
  }
}

const refusing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  }
} as unknown as Storage

describe("the dock's width", () => {
  it('is 420, and 384 in a window of 1500 or less, as tokens.css says', () => {
    expect([DOCK_DEFAULT, DOCK_NARROW, NARROW_WINDOW]).toEqual([420, 384, 1500])
    expect(dockDefault(1920)).toBe(420)
    expect(dockDefault(1501)).toBe(420)
    expect(dockDefault(1500)).toBe(384)
    expect(dockDefault(1280)).toBe(384)
    const tokens = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8')
    expect(tokens).toContain(`--dock-w: ${DOCK_DEFAULT}px`)
    expect(tokens).toMatch(new RegExp(`@media \\(max-width: ${NARROW_WINDOW}px\\)[^}]*--dock-w: ${DOCK_NARROW}px`))
  })

  it("is kept in the window's storage, or nowhere where there is none", () => {
    expect(windowStorage()).toBeNull()
  })

  it('is read from the window storage, and null where there is nothing usable', () => {
    expect(readDock(refusing)).toBeNull()
    expect(readDock(null)).toBeNull()
    expect(readDock(memory())).toBeNull()
    expect(readDock(memory({ [DOCK_KEY]: 'abc' }))).toBeNull()
    expect(readDock(memory({ [DOCK_KEY]: 'Infinity' }))).toBeNull()
    expect(readDock(memory({ [DOCK_KEY]: '-5' }))).toBeNull()
    expect(readDock(memory({ [DOCK_KEY]: '500' }))).toBe(500)
  })

  it('is written under pino.dock, and a storage that refuses is let go', () => {
    const storage = memory()
    writeDock(storage, 512)
    expect(DOCK_KEY).toBe('pino.dock')
    expect(storage.data).toEqual({ 'pino.dock': '512' })
    expect(readDock(storage)).toBe(512)
    expect(() => writeDock(refusing, 500)).not.toThrow()
    expect(() => writeDock(null, 500)).not.toThrow()
  })

  it('is bounded below by its minimum and above by the room the view keeps beside the left', () => {
    expect(clampDock(2000, 1440, 348)).toBe(1440 - 348 - VIEWPORT_MIN)
    expect(clampDock(2000, 1440, 348)).toBe(672)
    expect(clampDock(100, 1440, 348)).toBe(DOCK_MIN)
    expect(clampDock(500.4, 1440, 348)).toBe(500)
    expect(clampDock(500, 600, 348)).toBe(DOCK_MIN)
  })
})
