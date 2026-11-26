// The hidden-window rule (.claude/rules/e2e-hidden-window.md), held by reading the specs: the person is working on
// this desktop, and no spec may put a window on it, take the focus or touch their clipboard.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const app = resolve(__dirname, '..')
const e2e = join(app, 'e2e')

const sources = (): string[] =>
  readdirSync(e2e, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.startsWith('.results'))
    .map((f) => `e2e/${f}`)
const read = (file: string): string => readFileSync(join(app, file), 'utf8')
const specsNaming = (pattern: RegExp): string[] => sources().filter((f) => pattern.test(read(f)))

describe('the specs', () => {
  it('are there to be held', () => {
    expect(sources()).toContain('e2e/boot.spec.ts')
  })

  it('every spec launches Electron through e2e/launch.ts', () => {
    expect(specsNaming(/_electron|electron\.launch/).filter((f) => f !== 'e2e/launch.ts')).toEqual([])
  })

  it('launch.ts sets PINO_TEST=1 and never passes an ozone platform', () => {
    expect(existsSync(join(e2e, 'launch.ts'))).toBe(true)
    const src = read('e2e/launch.ts')
    expect(src).toContain("PINO_TEST: '1'")
    expect(src).not.toMatch(/ozone/)
  })

  it("launch.ts gives every run a home of its own, and no run the real claude", () => {
    const src = read('e2e/launch.ts')
    for (const name of ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']) expect(src).toContain(`${name}:`)
    expect(src).toContain("PINO_AGENT_CMD: opts.agent ? `node ${FAKE_AGENT}` : NO_AGENT")
  })

  it('no spec takes a screenshot or touches the clipboard', () => {
    expect(specsNaming(/\.screenshot\(|clipboard/)).toEqual([])
  })
})
