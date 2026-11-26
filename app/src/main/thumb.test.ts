import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { saveThumbnail, THUMB_MAX_BYTES, thumbnailOnFile, thumbnailRefusal } from './thumb'

const made: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pino-thumb-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

let dir: string
beforeEach(() => (dir = temp()))

/** The eight bytes a PNG starts with, and its first chunk's name: what a thumbnail is told by. */
const HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]
const bigPng = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length)
  bytes.set(HEAD)
  return bytes
}
const PNG = bigPng(64)

it('keeps a PNG under .pino with its build, ignored by git, and reads it back', async () => {
  await saveThumbnail(dir, PNG, { hash: 'aaaaaaaaaaaa' }, new Date('2026-11-26T10:00:00Z'))
  expect(new Uint8Array((await thumbnailOnFile(dir))!)).toEqual(PNG)
  expect(JSON.parse(readFileSync(join(dir, '.pino', 'thumb.json'), 'utf8'))).toEqual({ hash: 'aaaaaaaaaaaa', at: '2026-11-26T10:00:00.000Z' })
  expect(readFileSync(join(dir, '.pino', '.gitignore'), 'utf8')).toMatch(/^thumb\.png$/m)
  expect(readFileSync(join(dir, '.pino', '.gitignore'), 'utf8')).toMatch(/^thumb\.json$/m)
})

it('refuses what is not a PNG or is over 512 KB', () => {
  expect(thumbnailRefusal(PNG)).toBeNull()
  expect(thumbnailRefusal(new Uint8Array([1, 2, 3]))).toBe('A thumbnail is a PNG; this is not one.')
  expect(thumbnailRefusal('png' as unknown as Uint8Array)).toBe('A thumbnail is a PNG; this is not one.')
  expect(thumbnailRefusal(bigPng(THUMB_MAX_BYTES))).toBeNull()
  expect(thumbnailRefusal(bigPng(512 * 1024 + 1))).toBe('A thumbnail is at most 512 KB.')
})

it('reads nothing where there is no picture, or what is there is not one', async () => {
  expect(await thumbnailOnFile(dir)).toBeNull()
  mkdirSync(join(dir, '.pino'))
  writeFileSync(join(dir, '.pino', 'thumb.png'), 'not a picture')
  expect(await thumbnailOnFile(dir)).toBeNull()
  writeFileSync(join(dir, '.pino', 'thumb.png'), bigPng(THUMB_MAX_BYTES + 1))
  expect(await thumbnailOnFile(dir)).toBeNull()
})

it('reads no thumbnail through a link', async () => {
  const outside = temp()
  writeFileSync(join(outside, 'thumb.png'), PNG)
  mkdirSync(join(dir, '.pino'))
  symlinkSync(join(outside, 'thumb.png'), join(dir, '.pino', 'thumb.png'))
  expect(await thumbnailOnFile(dir)).toBeNull()
  // Nor through a .pino that is a link.
  const linked = temp()
  symlinkSync(outside, join(linked, '.pino'))
  expect(await thumbnailOnFile(linked)).toBeNull()
})

it('writes nothing through a .pino that is a link', async () => {
  const outside = temp()
  symlinkSync(outside, join(dir, '.pino'))
  await expect(saveThumbnail(dir, PNG, { hash: 'aaaaaaaaaaaa' }, new Date())).rejects.toThrow('is a link')
  expect(() => readFileSync(join(outside, 'thumb.png'))).toThrow()
})
