// shared-from-torno.json: the list of the files pino copied from torno, held to its own rules.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')

interface Entry { pino: string; torno: string; commit: string; mode: string; change?: string }
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

  it("keeps torno's paths: pino path is the torno path, with torno in a file name read as pino", () => {
    for (const f of manifest()) expect(f.pino).toBe(f.torno.replace(/torno(?=[^/]*$)/g, 'pino'))
  })

  it('names only files that are tracked in pino', () => {
    const tracked = new Set(execFileSync('git', ['-C', repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0'))
    expect(manifest().map((f) => f.pino).filter((p) => !tracked.has(p))).toEqual([])
  })
})
