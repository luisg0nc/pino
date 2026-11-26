import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CardsFile } from '../../shared/cards'
import { linkOf, listReferences, MAX_REFERENCE_BYTES, readReference } from './references'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pino-references-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const put = (name: string, text = 'x'): void => {
  mkdirSync(join(dir, 'reference'), { recursive: true })
  writeFileSync(join(dir, 'reference', name), text)
}

describe('the files of reference/', () => {
  it('lists the plain files that are a photo, a doodle or a PDF, by name', async () => {
    expect(await listReferences(dir)).toEqual([])
    for (const name of ['photo-2.jpg', 'photo-1.png', 'doodle-1.png', 'datasheet.pdf', 'notes.txt', 'photo.png', 'photo-1.step', '.hidden.pdf']) put(name)
    writeFileSync(join(dir, 'outside.pdf'), 'x')
    symlinkSync(join(dir, 'outside.pdf'), join(dir, 'reference', 'link.pdf'))
    mkdirSync(join(dir, 'reference', 'photo-3.png'))
    expect(await listReferences(dir)).toEqual(['datasheet.pdf', 'doodle-1.png', 'photo-1.png', 'photo-2.jpg'])
  })

  it('lists nothing through a reference/ that is a link', async () => {
    mkdirSync(join(dir, 'elsewhere'))
    writeFileSync(join(dir, 'elsewhere', 'photo-1.png'), 'x')
    symlinkSync(join(dir, 'elsewhere'), join(dir, 'reference'))
    expect(await listReferences(dir)).toEqual([])
    expect(await readReference(dir, 'photo-1.png')).toBeNull()
  })

  it('reads a photo or a doodle of the list with its type, and nothing else', async () => {
    put('photo-1.JPG', 'jpeg')
    put('doodle-1.png', 'png')
    put('datasheet.pdf')
    writeFileSync(join(dir, 'photo-9.png'), 'x')
    expect(await readReference(dir, 'photo-1.JPG')).toEqual({ mediaType: 'image/jpeg', bytes: new Uint8Array(Buffer.from('jpeg')) })
    expect((await readReference(dir, 'doodle-1.png'))?.mediaType).toBe('image/png')
    for (const file of ['datasheet.pdf', '../photo-9.png', 'photo-9.png', 'reference/photo-1.JPG']) expect([file, await readReference(dir, file)]).toEqual([file, null])
  })

  it('reads no picture over 25 MB', async () => {
    put('photo-1.png')
    truncateSync(join(dir, 'reference', 'photo-1.png'), MAX_REFERENCE_BYTES + 1)
    expect(await readReference(dir, 'photo-1.png')).toBeNull()
  })
})

describe('the link main opens', () => {
  const file: CardsFile = { next: 3, cards: [{ id: 'C1', kind: 'link', by: 'person', text: 'https://a.dev/x\nsee also http://b.dev' }, { id: 'C2', kind: 'note', by: 'agent', text: 'file:///etc/passwd and javascript:alert(1)' }] }
  const brief = 'Look at https://c.dev/one, then (https://c.dev/two).'

  it("is one of main's own card, or of brief.md, by its place", () => {
    expect(linkOf(file, brief, 'C1')).toBe('https://a.dev/x')
    expect(linkOf(file, brief, 'C1', 1)).toBe('http://b.dev')
    expect(linkOf(file, brief, 'brief', 1)).toBe('https://c.dev/two')
  })

  it('is nothing for another scheme, a place with no link, or a card that is not there', () => {
    expect(linkOf(file, brief, 'C2')).toBeNull()
    expect(linkOf(file, brief, 'C1', 7)).toBeNull()
    expect(linkOf(file, brief, 'C9')).toBeNull()
    expect(linkOf(file, undefined, 'brief')).toBeNull()
    expect(linkOf(file, 'https://', 'brief')).toBeNull()
  })
})
