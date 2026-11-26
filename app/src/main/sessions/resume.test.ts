import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { storeConversation, storedConversation } from './resume'

const CONVERSATION = '6c9664ef-90c4-4c7f-b6d5-180948ac85ee'

let root: string
let project: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'pino-resume-')))
  project = join(root, 'copy')
  mkdirSync(project)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the conversation on file', () => {
  it('is the one put there, under .pino', async () => {
    expect(storedConversation(project)).toBeNull()
    await storeConversation(project, CONVERSATION)
    expect(storedConversation(project)).toBe(CONVERSATION)
    expect(readdirSync(project)).toEqual(['.pino'])
  })

  it("is not read through a .pino that is a link: it is another folder's, and cannot be resumed here", async () => {
    // A copied project whose `.pino` still leads to the original's.
    const original = join(root, 'original')
    mkdirSync(original)
    await storeConversation(original, CONVERSATION)
    symlinkSync(join(original, '.pino'), join(project, '.pino'))
    expect(storedConversation(project)).toBeNull()
  })

  it('is none where a file stands in the place of .pino', () => {
    writeFileSync(join(project, '.pino'), '')
    expect(storedConversation(project)).toBeNull()
  })
})
