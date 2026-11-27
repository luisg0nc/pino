import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatItem, TurnBuilds, TurnUsage } from '../../shared/chat'
import { appendItems } from './chatlog'
import { listUsage } from './usage'

const A = '6c9664ef-90c4-4c7f-b6d5-180948ac85ee'
const B = 'b3a2c1d0-1111-4222-8333-444455556666'
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pino-usage-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const user = (id: string, at: number, images = 0): ChatItem => ({ kind: 'user', id, text: `say ${id}`, images: Array.from({ length: images }, (_, i) => ({ id: `${id}-${i}`, mediaType: 'image/png' })), state: 'sent', at })
const look = (id: string, images: number): ChatItem => ({ kind: 'tool', id, toolUseId: id, name: 'mcp__pino__look', own: true, input: {}, state: 'done', images: Array.from({ length: images }, (_, i) => ({ id: `${id}-${i}`, mediaType: 'image/png' })) })
const usage = (over: Partial<TurnUsage> = {}): TurnUsage => ({ input: 2, output: 50, cacheRead: 1000, cacheCreation: 100, requests: 3, costUsd: 0.4, sessionCostUsd: 9, ...over })
const turn = (id: string, u?: TurnUsage, builds?: TurnBuilds): ChatItem => ({ kind: 'turn', id, ok: true, stopped: false, seconds: 5, pulled: {}, ...(u ? { usage: u } : {}), ...(builds ? { builds } : {}) })

describe('listUsage', () => {
  it('gives each prompt of every conversation what its turn used and did, numbered as the prompts are', async () => {
    await appendItems(dir, A, [user('a1', 1000, 1), look('t1', 2), turn('e1', usage({ costUsd: 0.5 }), { count: 1, to: 4 })])
    await appendItems(dir, B, [user('b1', 2000), turn('e2', usage({ costUsd: 0.1 }))])
    const { rows } = await listUsage(dir)
    expect(rows.map((r) => [r.number, r.id, r.conversation, r.turns])).toEqual([
      [1, 'a1', A, ['e1']],
      [2, 'b1', B, ['e2']]
    ])
    expect(rows[0].usage).toEqual({ input: 2, output: 50, cacheRead: 1000, cacheCreation: 100, requests: 3, costUsd: 0.5 })
    expect(rows[0].facts).toEqual({ pictures: { you: 1, look: 2 }, builds: { count: 1, to: 4 } })
  })

  it('sums two turns that answered one prompt', async () => {
    await appendItems(dir, A, [user('a1', 1000), turn('e1', usage({ costUsd: 0.5 })), turn('e2', usage({ costUsd: 0.25 }))])
    const [row] = (await listUsage(dir)).rows
    expect(row.turns).toEqual(['e1', 'e2'])
    expect(row.usage).toMatchObject({ requests: 6, costUsd: 0.75 })
  })

  it('marks the first turn of a resumed conversation, whose cost is not known, and keeps its tokens', async () => {
    await appendItems(dir, A, [user('a1', 1000), turn('e1', usage()), user('a2', 2000), turn('e2', usage({ costUsd: undefined }))])
    const rows = (await listUsage(dir)).rows
    expect(rows[1]).toMatchObject({ resumed: true, usage: { cacheRead: 1000 } })
    expect(rows[1].usage).not.toHaveProperty('costUsd')
    expect(rows[0]).not.toHaveProperty('resumed')
  })

  it('leaves a prompt whose turn is not over, or that the CLI counted nothing for, without usage', async () => {
    await appendItems(dir, A, [user('a1', 1000), turn('e1'), user('a2', 2000)])
    const rows = (await listUsage(dir)).rows
    expect(rows.map((r) => r.usage)).toEqual([undefined, undefined])
    expect(rows[0].turns).toEqual(['e1'])
  })

  it('reads a line written again for one item once', async () => {
    await appendItems(dir, A, [user('a1', 1000), look('t1', 1), look('t1', 1), turn('e1', usage())])
    expect((await listUsage(dir)).rows[0].facts.pictures).toEqual({ look: 1 })
  })

  it('does not call a turn kept with no cost and no running total a resumed one', async () => {
    await appendItems(dir, A, [user('a1', 1000), turn('e1', usage({ costUsd: undefined, sessionCostUsd: undefined }))])
    const [row] = (await listUsage(dir)).rows
    expect(row.usage).toMatchObject({ cacheRead: 1000 })
    expect(row).not.toHaveProperty('resumed')
  })

  it('keeps apart two conversations that hold a prompt of the same id', async () => {
    await appendItems(dir, A, [user('same', 1000), turn('e1', usage({ costUsd: 1 }))])
    await appendItems(dir, B, [user('same', 2000), turn('e2', usage({ costUsd: 2 }))])
    expect((await listUsage(dir)).rows.map((r) => r.usage?.costUsd)).toEqual([1, 2])
  })

  it("gives the median cost of the project's prompts whose cost is known", async () => {
    await appendItems(dir, A, [user('a1', 1000), turn('e1', usage({ costUsd: 1 })), user('a2', 2000), turn('e2', usage({ costUsd: 5 })), user('a3', 3000), turn('e3', usage({ costUsd: 2 })), user('a4', 4000), turn('e4', usage({ costUsd: undefined }))])
    expect((await listUsage(dir)).median).toBe(2)
  })
})
