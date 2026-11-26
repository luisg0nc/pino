// shared-from-torno.json: the list of the files pino copied from torno, held to its own rules.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')

interface Entry { pino: string; torno: string; commit: string; mode: string; change?: string; moved?: string }
const manifest = (): Entry[] => (JSON.parse(readFileSync(join(repo, 'shared-from-torno.json'), 'utf8')) as { files: Entry[] }).files

describe('shared-from-torno.json', () => {
  it('lists each copied file once, with a torno path, a full commit and a mode', () => {
    const files = manifest()
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      expect(f.torno, f.pino).toBeTruthy()
      expect(f.commit, f.pino).toMatch(/^[0-9a-f]{40}$/)
      expect(['as-is', 'adapted'], f.pino).toContain(f.mode)
      if (f.mode === 'adapted') expect(f.change?.trim(), f.pino).toBeTruthy()
      else expect(f.change, f.pino).toBeUndefined()
    }
    const paths = files.map((f) => f.pino)
    expect(paths.filter((p, i) => paths.indexOf(p) !== i)).toEqual([])
  })

  it("keeps torno's paths, or says in moved which pino rule renamed a copy", () => {
    for (const f of manifest()) {
      if (f.moved === undefined) expect(f.pino).toBe(f.torno.replace(/torno(?=[^/]*$)/g, 'pino'))
      else expect([f.pino, f.moved.trim().length > 0, f.moved.includes('\n'), f.pino !== f.torno]).toEqual([f.pino, true, false, true])
    }
  })

  it("says that torno's thumbnails moved, and why", () => {
    expect(manifest().find((f) => f.pino === 'app/src/main/thumb.ts')).toMatchObject({ torno: 'app/src/main/show/cards.ts', moved: "torno's show/cards.ts is the page's cards; in pino cards are the Brief's" })
  })

  it('names only files that are tracked in pino', () => {
    const tracked = new Set(execFileSync('git', ['-C', repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0'))
    expect(manifest().map((f) => f.pino).filter((p) => !tracked.has(p))).toEqual([])
  })
})
