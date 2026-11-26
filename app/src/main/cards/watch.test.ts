import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { watchBrief } from './watch'

let dir: string
let stop: () => void
let said: Array<{ brief: boolean; cards: boolean }>

const settle = (ms = 400): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const start = async (): Promise<void> => {
  stop = watchBrief(dir, (what) => said.push(what), 50)
  await settle(300)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pino-brief-watch-'))
  said = []
  stop = () => {}
})
afterEach(() => {
  stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('watching what the brief follows', () => {
  it('calls once per burst when brief.md or cards.json changes, and not for anything else', async () => {
    await start()
    writeFileSync(join(dir, 'brief.md'), '# a\n')
    await settle(20)
    writeFileSync(join(dir, 'brief.md'), '# a\nmore\n')
    await settle()
    expect(said).toEqual([{ brief: true, cards: false }])
    said.length = 0
    writeFileSync(join(dir, 'board.py'), 'x')
    await settle()
    expect(said).toEqual([])
  })

  it('says so when brief.md is removed', async () => {
    writeFileSync(join(dir, 'brief.md'), '# a\n')
    await start()
    unlinkSync(join(dir, 'brief.md'))
    await settle()
    expect(said).toEqual([{ brief: true, cards: false }])
  })

  it('says so when cards.json changes, also when .pino/brief was not there yet', async () => {
    await start()
    mkdirSync(join(dir, '.pino', 'brief'), { recursive: true })
    writeFileSync(join(dir, '.pino', 'brief', 'cards.json'), '{}')
    await settle()
    expect(said).toEqual([{ brief: false, cards: true }])
  })

  it('puts a burst in one report', async () => {
    mkdirSync(join(dir, '.pino', 'brief'), { recursive: true })
    await start()
    writeFileSync(join(dir, 'brief.md'), 'x')
    writeFileSync(join(dir, '.pino', 'brief', 'cards.json'), '{}')
    await settle()
    expect(said).toEqual([{ brief: true, cards: true }])
  })

  it('says nothing of anything else: the pictures, the marks and the files of what was seen and told', async () => {
    mkdirSync(join(dir, '.pino', 'brief'), { recursive: true })
    mkdirSync(join(dir, 'reference'))
    await start()
    writeFileSync(join(dir, 'reference', 'photo-1.jpg'), 'x')
    writeFileSync(join(dir, '.pino', 'thumb.png'), 'x')
    writeFileSync(join(dir, '.pino', 'brief', 'told.json'), '{}')
    writeFileSync(join(dir, '.pino', 'brief', 'seen.json'), '{}')
    writeFileSync(join(dir, '.pino', 'brief', 'cards.json.corrupt-2026-01-01T00-00-00-000Z'), 'x')
    await settle()
    expect(said).toEqual([])
  })

  it('says nothing once stopped', async () => {
    await start()
    stop()
    writeFileSync(join(dir, 'brief.md'), 'x')
    await settle()
    expect(said).toEqual([])
  })
})
