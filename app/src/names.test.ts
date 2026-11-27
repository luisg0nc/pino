// Two naming rules, held by reading the code: nothing copied still calls itself by the name of the app it came from,
// and what pino opens is a "project" in identifiers, never an "object". Comments may say where a thing came from.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const ROOTS = ['app/src', 'app/e2e', 'app/test', 'scripts', '.github', '.claude/hooks']
/** Recorded streams: what an agent once said, not code. */
const LEFT_OUT = 'app/test/fixtures/'

/** The files that compare pino with torno, or must name it to guard against it. */
const MAY_NAME_TORNO = [
  'scripts/torno-sync',
  'app/src/tornoSync.test.ts',
  'app/src/manifest.test.ts',
  'app/src/names.test.ts',
  // The landing page links torno as pino's sibling, and its test holds the link.
  'app/src/site.test.ts',
  'app/src/shared/app.ts',
  '.claude/hooks/guard-bash.sh',
  '.claude/hooks/guard-bash.test.sh'
]

type Style = 'js' | 'hash' | 'markup'

function styleOf(file: string, text: string): Style {
  if (['.ts', '.tsx', '.mjs', '.js', '.cjs', '.css'].includes(extname(file))) return 'js'
  if (['.html', '.svg'].includes(extname(file))) return 'markup'
  return /^#!.*\bnode\b/.test(text) ? 'js' : 'hash'
}

/**
 * The text without its comments, line numbers kept. Only a comment that opens its own line is taken out (and a JSX
 * one after a brace): `//` and `/*` inside a string, as in an address or a glob, are code.
 */
function stripped(text: string, style: Style): string {
  const blank = (found: string): string => found.replace(/[^\n]/g, '')
  if (style === 'markup') return text.replace(/<!--[\s\S]*?-->/g, blank)
  if (style === 'hash') return text.replace(/^[ \t]*#.*$/gm, '')
  return text.replace(/(?<=^[ \t]*|\{)\/\*[\s\S]*?\*\//gm, blank).replace(/^[ \t]*\/\/.*$/gm, '')
}

function files(): string[] {
  const listed = execFileSync('git', ['-C', repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...ROOTS], { encoding: 'utf8' })
  return listed.split('\0').filter((f) => f && !f.startsWith(LEFT_OUT) && existsSync(join(repo, f)))
}

function offenders(pattern: RegExp, allowed: string[] = []): string[] {
  return files()
    .filter((f) => !allowed.includes(f))
    .flatMap((f) => {
      const text = readFileSync(join(repo, f), 'utf8')
      return stripped(text, styleOf(f, text))
        .split('\n')
        .flatMap((line, i) => (pattern.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : []))
    })
}

describe('names', () => {
  it('reads code and leaves comments out', () => {
    const js = "// torno\n/* torno\n torno */\nconst glob = 'src/**/*.ts' // kept\nconst url = 'http://torno'\n"
    expect(stripped(js, 'js').split('\n')).toEqual(['', '', '', "const glob = 'src/**/*.ts' // kept", "const url = 'http://torno'", ''])
    expect(stripped('# torno\necho torno\n', 'hash')).toBe('\necho torno\n')
  })

  it('names torno nowhere in code, outside the files that compare with it', () => {
    expect(offenders(/torno/i, MAY_NAME_TORNO)).toEqual([])
  })

  it('says project, never object, in identifiers', () => {
    expect(offenders(/\b(objectId|objectIds|ObjectInfo|objectOf)\b/, ['app/src/names.test.ts'])).toEqual([])
  })
})
