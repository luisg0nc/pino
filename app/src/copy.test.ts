// What a person or Claude reads from pino has no em dash: the UI's words, the system prompt, the tools' text, the
// check rows and the exact references.

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const src = resolve(__dirname)
const under = (folder: string, ends: RegExp): string[] =>
  readdirSync(join(src, folder), { recursive: true, encoding: 'utf8' })
    .filter((f) => ends.test(f) && !f.endsWith('.test.ts'))
    .map((f) => join(folder, f))

const FILES = [...under('renderer', /\.tsx$/), 'main/prompt.ts', ...under('main/mcp', /\.ts$/), 'main/domain.ts', 'shared/checks.ts', 'shared/board/refs.ts', 'shared/board/measure.ts', 'shared/marks.ts', 'shared/view.ts']

it('has no em dash in UI copy, prompts or tool text', () => {
  const found = FILES.filter((file) => {
    try {
      return readFileSync(join(src, file), 'utf8').includes('—')
    } catch {
      return false // a file a later stage adds
    }
  })
  expect(found).toEqual([])
})

it('reads the files it is held to', () => {
  expect(FILES).toContain('renderer/ui/RouteCard.tsx')
  expect(FILES).toContain('main/mcp/tools.ts')
})
