import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TEMP_NEW, scanOrder, scanWorkspace } from './workspace'

const made: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pino-ws-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('scanWorkspace', () => {
  it('lists real subfolders only: hidden ones, files, links and pino-new folders are left out', async () => {
    const root = temp()
    mkdirSync(join(root, 'a'))
    writeFileSync(join(root, 'a', 'board.py'), '')
    mkdirSync(join(root, 'b'))
    writeFileSync(join(root, 'b', 'brief.md'), '# b\n')
    mkdirSync(join(root, 'empty'))
    mkdirSync(join(root, '.hidden'))
    mkdirSync(join(root, '.a.pino-new-0123456789ab'))
    writeFileSync(join(root, 'notes.txt'), '')
    symlinkSync(temp(), join(root, 'link'))
    const ws = await scanWorkspace(root)
    expect(ws.projects.map((p) => [p.name, p.board, p.brief, p.empty])).toEqual([
      ['a', true, false, false],
      ['b', false, true, false],
      ['empty', false, false, true]
    ])
    expect(ws.root).toBe(root)
    expect(ws.name).toBe(basename(root))
    expect(TEMP_NEW.test('.a.pino-new-0123456789ab')).toBe(true)
  })

  it('lists a folder named with spaces and non-ASCII letters', async () => {
    const root = temp()
    mkdirSync(join(root, 'placa ação'))
    mkdirSync(join(root, '_draft'))
    expect((await scanWorkspace(root)).projects.map((p) => [p.name, p.dir])).toEqual([
      ['_draft', join(root, '_draft')],
      ['placa ação', join(root, 'placa ação')]
    ])
  })

  it('a board.py that is a folder or a link out does not make a board', async () => {
    const root = temp()
    const out = temp()
    writeFileSync(join(out, 'board.py'), '')
    mkdirSync(join(root, 'folder', 'board.py'), { recursive: true })
    mkdirSync(join(root, 'linked'))
    symlinkSync(join(out, 'board.py'), join(root, 'linked', 'board.py'))
    expect((await scanWorkspace(root)).projects.map((p) => [p.name, p.board, p.empty])).toEqual([
      ['folder', false, true],
      ['linked', false, true]
    ])
  })

  it('rejects a root that is not a folder', async () => {
    await expect(scanWorkspace(join(temp(), 'missing'))).rejects.toThrow(/missing/)
  })
})

describe('scanOrder', () => {
  it('keeps scans that end in the order they began', () => {
    const begin = scanOrder()
    const first = begin()
    expect(first()).toBe(true)
    const second = begin()
    expect(second()).toBe(true)
  })

  it('drops a scan that ends after one begun later has been kept', () => {
    const begin = scanOrder()
    const older = begin()
    const newer = begin()
    expect(newer()).toBe(true)
    expect(older()).toBe(false)
    // And the next one is kept again.
    expect(begin()()).toBe(true)
  })

  it('keeps an older scan while the newer one has not ended, which then replaces it', () => {
    const begin = scanOrder()
    const older = begin()
    const newer = begin()
    expect(older()).toBe(true)
    expect(newer()).toBe(true)
  })
})
