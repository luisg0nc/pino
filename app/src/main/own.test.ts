import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureIgnored } from './ignored'
import { FOLDER, onNotOwn, ownFolder, whyNotOwn, writeOwn } from './own'

let root: string
let project: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'pino-own-'))
  project = join(root, 'boards', 'lid')
  outside = join(root, 'outside')
  mkdirSync(project, { recursive: true })
  mkdirSync(outside)
})
afterEach(() => {
  onNotOwn(null)
  rmSync(root, { recursive: true, force: true })
})

describe('ownFolder', () => {
  it('answers with the folder when there is none yet, and when it is a real folder', async () => {
    expect(await ownFolder(project)).toBe(join(project, FOLDER))
    expect(existsSync(join(project, FOLDER))).toBe(false)
    mkdirSync(join(project, FOLDER))
    expect(await ownFolder(project)).toBe(join(project, FOLDER))
  })

  it('refuses a link in its place, and a file, with a plain reason', async () => {
    symlinkSync('..', join(project, FOLDER))
    await expect(ownFolder(project)).rejects.toThrow(`${join(project, FOLDER)} is a link, not a folder of pino's own inside the project: pino writes nothing there. Put a real folder in its place.`)
    rmSync(join(project, FOLDER))
    writeFileSync(join(project, FOLDER), '')
    await expect(ownFolder(project)).rejects.toThrow(`${join(project, FOLDER)} is a file, not a folder: pino writes nothing there. Remove it.`)
  })

  it('tells of a folder once, whoever was refused there and however often', async () => {
    const told: Array<[string, string]> = []
    onNotOwn((dir, message) => told.push([dir, message]))
    symlinkSync('..', join(project, FOLDER))
    await expect(writeOwn(project, 'a.json', '{}')).rejects.toThrow('is a link')
    await expect(writeOwn(project, 'b.json', '{}')).rejects.toThrow('is a link')
    await expect(ownFolder(project)).rejects.toThrow('is a link')
    expect(told).toEqual([[project, expect.stringContaining('is a link')]])
  })

  it('is the one rule: a linked .pino is refused in the same words, and the window is told', async () => {
    const told: string[] = []
    onNotOwn((_dir, message) => told.push(message))
    symlinkSync('..', join(project, FOLDER))
    await expect(ownFolder(project, 'chat')).rejects.toThrow("is a link, not a folder of pino's own inside the project")
    await expect(ensureIgnored(project, ['chat/'])).rejects.toThrow('is a link')
    expect(told).toHaveLength(1)
  })

  it('writes nothing where a linked .pino leads, and the project keeps no new file', async () => {
    symlinkSync(outside, join(project, '.pino'))
    await expect(writeOwn(project, 'session.json', '{}')).rejects.toThrow(/is a link/)
    expect(readdirSync(outside)).toEqual([])
    expect(readdirSync(project)).toEqual(['.pino'])
  })

  it('holds a folder under .pino to the same rule, and tells of it by itself', async () => {
    const told: Array<string | null> = []
    onNotOwn((_dir, _message, inside) => told.push(inside))
    mkdirSync(join(project, FOLDER))
    symlinkSync(outside, join(project, FOLDER, 'chat'))
    await expect(ownFolder(project, 'chat')).rejects.toThrow('deletes nothing through it. Take the link away.')
    // `.pino` itself is still pino's own.
    await writeOwn(project, 'session.json', '{}')
    expect(readFileSync(join(project, FOLDER, 'session.json'), 'utf8')).toBe('{}')
    expect(readdirSync(outside)).toEqual([])
    expect(told).toEqual(['chat'])
  })
})

describe("asking quietly whether a folder is pino's own", () => {
  it('says why not, and uses up nothing the window is to be told', async () => {
    const heard: string[] = []
    onNotOwn((_dir, message) => heard.push(message))
    symlinkSync(outside, join(project, FOLDER))
    expect(await whyNotOwn(project, 'build')).toContain('.pino is a link')
    expect(heard).toEqual([])
    await expect(ownFolder(project)).rejects.toThrow('is a link')
    expect(heard).toHaveLength(1)
  })

  it('says nothing of a folder that is, or is not there yet', async () => {
    expect(await whyNotOwn(project, 'build')).toBeNull()
    mkdirSync(join(project, FOLDER, 'build'), { recursive: true })
    expect(await whyNotOwn(project, 'build')).toBeNull()
  })
})
