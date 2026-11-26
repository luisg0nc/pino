import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRIEF_REFUSAL, deniedAnswer, refusalOf } from './reach'

describe('refusalOf', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pino-reach-')))
  const dir = join(root, 'a')
  mkdirSync(join(dir, 'sub'), { recursive: true })
  mkdirSync(join(root, 'b'))
  mkdirSync(join(root, 'common'))
  symlinkSync(join(root, 'b'), join(dir, 'link'))

  it("lets the project's own files through, for every tool that writes", () => {
    for (const name of ['Write', 'Edit', 'MultiEdit']) {
      expect(refusalOf(dir, name, { file_path: join(dir, 'board.py') })).toBeUndefined()
      expect(refusalOf(dir, name, { file_path: join(dir, 'sub', 'new.py') })).toBeUndefined()
    }
    expect(refusalOf(dir, 'NotebookEdit', { notebook_path: join(dir, 'n.ipynb') })).toBeUndefined()
  })
  it('refuses a write of brief.md, by any path to it, and names add_card', () => {
    for (const [tool, key] of [['Write', 'file_path'], ['Edit', 'file_path'], ['MultiEdit', 'file_path'], ['NotebookEdit', 'notebook_path']]) {
      expect(refusalOf(dir, tool, { [key]: 'brief.md' })).toBe(BRIEF_REFUSAL(tool))
    }
    expect(refusalOf(dir, 'Write', { file_path: join(dir, 'sub', '..', 'brief.md') })).toBe(BRIEF_REFUSAL('Write'))
    writeFileSync(join(dir, 'brief.md'), '# a\n')
    symlinkSync(join(dir, 'brief.md'), join(dir, 'words.md'))
    expect(refusalOf(dir, 'Edit', { file_path: 'words.md' })).toBe(BRIEF_REFUSAL('Edit'))
    expect(BRIEF_REFUSAL('Edit')).toContain('add_card')
    expect(refusalOf(dir, 'Write', { file_path: join(dir, 'reference', 'brief.md') })).toBeUndefined()
    expect(refusalOf(dir, 'Read', { file_path: 'brief.md' })).toBeUndefined()
  })
  it('refuses a write through a dangling link that resolves to a brief.md not there yet', () => {
    const bare = join(root, 'bare')
    mkdirSync(join(bare, 'sub'), { recursive: true })
    // A relative link, a chain of two, one from a folder below, and one by way of a linked folder.
    symlinkSync('brief.md', join(bare, 'words.md'))
    symlinkSync('words.md', join(bare, 'chain.md'))
    symlinkSync('../brief.md', join(bare, 'sub', 'up.md'))
    symlinkSync(bare, join(bare, 'sub', 'here'))
    symlinkSync(join(bare, 'brief.md'), join(root, 'b', 'whole.md'))
    symlinkSync(join(root, 'b', 'whole.md'), join(bare, 'round.md'))
    for (const path of ['words.md', 'chain.md', 'sub/up.md', 'sub/here/words.md', 'round.md']) {
      for (const tool of ['Write', 'Edit']) expect([path, refusalOf(bare, tool, { file_path: path })]).toEqual([path, BRIEF_REFUSAL(tool)])
    }
    // A dangling link to another file is not the brief's; one that goes round in a circle ends the looking.
    symlinkSync('notes.md', join(bare, 'other.md'))
    symlinkSync('loop-b.md', join(bare, 'loop-a.md'))
    symlinkSync('loop-a.md', join(bare, 'loop-b.md'))
    expect(refusalOf(bare, 'Write', { file_path: 'other.md' })).toBeUndefined()
    expect(refusalOf(bare, 'Write', { file_path: 'loop-a.md' })).toBeUndefined()
  })
  it('refuses a write through a dangling link that lands under .pino/ or outside the project', () => {
    const bare = join(root, 'dangling')
    mkdirSync(join(bare, 'sub'), { recursive: true })
    // Under .pino/, which is not there yet either, straight and by a chain.
    symlinkSync('.pino/session.json', join(bare, 'notes.json'))
    symlinkSync('../notes.json', join(bare, 'sub', 'chain.json'))
    for (const path of ['notes.json', 'sub/chain.json']) expect([path, refusalOf(bare, 'Write', { file_path: path })]).toEqual([path, expect.stringContaining('Write may not write under .pino/')])
    // Beside the project, by a relative link, a whole one, and a chain that comes back in on the way.
    symlinkSync('../b/new.py', join(bare, 'beside.py'))
    symlinkSync(join(root, 'fresh', 'new.py'), join(bare, 'sub', 'away.py'))
    symlinkSync('sub/away.py', join(bare, 'round.py'))
    for (const path of ['beside.py', 'sub/away.py', 'round.py']) expect([path, refusalOf(bare, 'Edit', { file_path: path })]).toEqual([path, expect.stringContaining(`works on the project in ${bare}`)])
    // One that stays in the project is the project's own, also when it is reached from outside it.
    symlinkSync('sub/later.py', join(bare, 'later.py'))
    symlinkSync(join(bare, 'sub', 'later.py'), join(root, 'b', 'into.py'))
    expect(refusalOf(bare, 'Write', { file_path: 'later.py' })).toBeUndefined()
    expect(refusalOf(bare, 'Write', { file_path: join(root, 'b', 'into.py') })).toBeUndefined()
  })
  it('refuses anything outside the project folder, a folder beside it among them, and says why', () => {
    for (const file of [join(root, 'b', 'board.py'), join(root, 'top.py'), join(root, 'common', 'shared.py'), join(root, 'fresh', 'board.py'), join(dir, '..', 'b', 'x.py'), join(dir, 'link', 'x.py')]) {
      expect(refusalOf(dir, 'Write', { file_path: file })).toContain(`works on the project in ${dir}`)
    }
    expect(refusalOf(dir, 'NotebookEdit', { notebook_path: join(root, 'b', 'n.ipynb') })).toContain('NotebookEdit')
  })
  it('refuses a write under .pino/ of the project, and lets a Read be', () => {
    expect(refusalOf(dir, 'Write', { file_path: join(dir, '.pino', 'session.json') })).toContain('Write may not write under .pino/')
    expect(refusalOf(dir, 'Edit', { file_path: '.pino/chat/x.jsonl' })).toContain('Edit may not write under .pino/')
    expect(refusalOf(dir, 'Read', { file_path: join(dir, '.pino', 'session.json') })).toBeUndefined()
    expect(refusalOf(dir, 'Write', { file_path: join(dir, 'pino', 'x.py') })).toBeUndefined()
  })
  it('leaves other tools and inputs it cannot read to the CLI', () => {
    expect(refusalOf(dir, 'Bash', { command: 'echo > ../b/x' })).toBeUndefined()
    expect(refusalOf(dir, 'Read', { file_path: join(root, 'b', 'board.py') })).toBeUndefined()
    expect(refusalOf(dir, 'Write', {})).toBeUndefined()
    expect(refusalOf(dir, 'Write', null)).toBeUndefined()
  })
  it('answers as the CLI reads a refusal', () => {
    expect(deniedAnswer('no')).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } })
  })
})
