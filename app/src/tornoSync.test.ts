// scripts/torno-sync, the drift report between pino's copies and torno. Every test but the last builds a torno of
// its own in a temp folder; the last reads the real checkout beside pino, and is skipped where there is none.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const script = join(repo, 'scripts/torno-sync')

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The person's own git settings (signing, hooks) are no part of a fake repository. */
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { env: gitEnv, encoding: 'utf8' })

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

function temp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pino-sync-')))
  made.push(dir)
  return dir
}

type Entry = { pino: string; torno: string; commit: string; mode: 'as-is' | 'adapted'; change?: string }
const manifest = (root: string, files: Entry[]): void => put(root, 'shared-from-torno.json', JSON.stringify({ torno: 'https://example.invalid/t', files }))

/** torno at X has a.ts, b.ts and c.ts; at Y b.ts is edited and c.ts is gone. pino copied them at X. */
function fixture(root = temp()) {
  const torno = join(root, 'torno')
  const pino = join(root, 'pino')
  mkdirSync(torno)
  mkdirSync(pino)
  git(torno, 'init', '-q')
  for (const n of ['a.ts', 'b.ts', 'c.ts']) put(torno, n, `// ${n}\n`)
  git(torno, 'add', '-A')
  git(torno, 'commit', '-qm', 'X')
  const x = git(torno, 'rev-parse', 'HEAD').trim()
  put(torno, 'b.ts', '// b.ts, edited\n')
  unlinkSync(join(torno, 'c.ts'))
  git(torno, 'add', '-A')
  git(torno, 'commit', '-qm', 'Y')
  const entry = (path: string, from = path, mode: Entry['mode'] = 'as-is'): Entry => ({ pino: path, torno: from, commit: x, mode, ...(mode === 'adapted' ? { change: 'names' } : {}) })
  put(pino, 'a.ts', '// a.ts\n')
  put(pino, 'a2.ts', '// pino\'s own words\n')
  put(pino, 'b.ts', '// b.ts\n')
  put(pino, 'c.ts', '// c.ts\n')
  const files = [entry('a.ts'), entry('a2.ts', 'a.ts', 'adapted'), entry('b.ts'), entry('c.ts')]
  manifest(pino, files)
  return { root, torno, pino, x, entry, files }
}

function run(args: string[], extraEnv: Record<string, string> = {}, bin = script) {
  const env: NodeJS.ProcessEnv = { ...gitEnv, ...extraEnv }
  if (!('PINO_TORNO_DIR' in extraEnv)) delete env.PINO_TORNO_DIR
  const r = spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function report(torno: string, pino: string) {
  const r = run(['--torno', torno, '--pino', pino, '--json'])
  const json = JSON.parse(r.stdout) as { head: string; entries: Array<{ pino: string; mode: string; pinoChanged: boolean; tornoChanged: boolean; tornoRemoved: boolean }> }
  return { ...r, json, e: (path: string) => json.entries.find((x) => x.pino === path)! }
}

describe('torno-sync', () => {
  it('reports nothing for an as-is copy that matches, upstream unmoved', () => {
    const f = fixture()
    manifest(f.pino, [f.entry('a.ts')])
    const r = report(f.torno, f.pino)
    expect(r.status).toBe(0)
    expect(r.e('a.ts')).toMatchObject({ pinoChanged: false, tornoChanged: false, tornoRemoved: false })
    expect(r.json.head).toBe(git(f.torno, 'rev-parse', 'HEAD').trim())
  })

  it('says pino changed an as-is copy', () => {
    const f = fixture()
    manifest(f.pino, [f.entry('a.ts')])
    put(f.pino, 'a.ts', '// a.ts, edited in pino\n')
    const r = report(f.torno, f.pino)
    expect(r.e('a.ts').pinoChanged).toBe(true)
    expect(r.status).toBe(1)
  })

  it('says pino changed an as-is copy that is gone', () => {
    const f = fixture()
    manifest(f.pino, [f.entry('a.ts')])
    unlinkSync(join(f.pino, 'a.ts'))
    expect(report(f.torno, f.pino).e('a.ts').pinoChanged).toBe(true)
  })

  it('does not call an adapted copy changed for differing from torno', () => {
    const f = fixture()
    expect(report(f.torno, f.pino).e('a2.ts')).toMatchObject({ mode: 'adapted', pinoChanged: false })
  })

  it('says torno changed a file since the recorded commit, as-is or adapted', () => {
    const f = fixture()
    put(f.pino, 'b2.ts', '// adapted\n')
    manifest(f.pino, [f.entry('b.ts'), f.entry('b2.ts', 'b.ts', 'adapted')])
    const r = report(f.torno, f.pino)
    expect(r.e('b.ts').tornoChanged).toBe(true)
    expect(r.e('b2.ts').tornoChanged).toBe(true)
    expect(r.status).toBe(1)
  })

  it('says a file torno removed', () => {
    const f = fixture()
    expect(report(f.torno, f.pino).e('c.ts')).toMatchObject({ tornoRemoved: true, tornoChanged: false })
  })

  it('prints one line per drifted file, with the diff command, and a count', () => {
    const f = fixture()
    put(f.pino, 'a.ts', '// edited\n')
    const head = git(f.torno, 'rev-parse', 'HEAD').trim()
    const r = run(['--torno', f.torno, '--pino', f.pino])
    expect(r.stdout.trimEnd().split('\n')).toEqual([
      'pino-changed a.ts',
      `torno-changed b.ts ${f.x.slice(0, 7)}..${head.slice(0, 7)}  (git -C ${f.torno} diff ${f.x.slice(0, 7)} HEAD -- b.ts)`,
      'torno-removed c.ts',
      '4 files, 3 drifted'
    ])
    expect(r.status).toBe(1)
  })

  it('exits 2 with a plain reason when torno is missing or a commit is unknown', () => {
    const f = fixture()
    const missing = run(['--torno', join(f.root, 'nowhere'), '--pino', f.pino])
    expect(missing.status).toBe(2)
    expect(missing.stderr).toMatch(/not a git repository/)
    manifest(f.pino, [{ ...f.entry('a.ts'), commit: '0'.repeat(40) }])
    const unknown = run(['--torno', f.torno, '--pino', f.pino])
    expect(unknown.status).toBe(2)
    expect(unknown.stderr).toMatch(/unknown commit/)
    expect(unknown.stderr.trimEnd().split('\n')).toHaveLength(1)
  })

  it('exits 2 when the manifest does not parse, or names a file torno never had at that commit', () => {
    const f = fixture()
    put(f.pino, 'shared-from-torno.json', '{ not json')
    expect(run(['--torno', f.torno, '--pino', f.pino])).toMatchObject({ status: 2, stderr: expect.stringMatching(/shared-from-torno\.json/) })
    manifest(f.pino, [f.entry('a.ts', 'never.ts')])
    expect(run(['--torno', f.torno, '--pino', f.pino])).toMatchObject({ status: 2, stderr: expect.stringMatching(/never\.ts is not in torno/) })
  })

  it('finds torno beside the main checkout, also when run from a worktree, and PINO_TORNO_DIR comes first', () => {
    const f = fixture()
    mkdirSync(join(f.pino, 'scripts'))
    copyFileSync(script, join(f.pino, 'scripts/torno-sync'))
    chmodSync(join(f.pino, 'scripts/torno-sync'), 0o755)
    manifest(f.pino, [f.entry('a.ts')])
    git(f.pino, 'init', '-q')
    git(f.pino, 'add', '-A')
    git(f.pino, 'commit', '-qm', 'pino')
    git(f.pino, 'worktree', 'add', '-q', '-b', 'side', join(f.pino, '.worktrees/side'))
    const bin = join(f.pino, '.worktrees/side/scripts/torno-sync')
    expect(run([], {}, bin)).toMatchObject({ status: 0, stdout: '1 files, 0 drifted\n' })
    const elsewhere = join(f.root, 'elsewhere')
    const other = run([], { PINO_TORNO_DIR: elsewhere }, bin)
    expect(other).toMatchObject({ status: 2, stderr: expect.stringContaining(`${elsewhere} is not a git repository`) })
  })

  it('never writes into torno', () => {
    const f = fixture()
    const stamps = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .sort()
        .map((p) => `${p} ${statSync(join(dir, p)).mtimeMs}`)
    const state = () => [git(f.torno, 'status', '--porcelain'), git(f.torno, 'rev-parse', 'HEAD')]
    const before = state()
    const was = stamps(f.torno)
    expect(run(['--torno', f.torno, '--pino', f.pino]).status).toBe(1) // it did run, and found the drift
    expect(run(['--torno', f.torno, '--pino', f.pino, '--json']).status).toBe(1)
    expect(stamps(f.torno)).toEqual(was)
    expect(state()).toEqual(before)
  })
})

/** The one rule for where torno is: PINO_TORNO_DIR, else beside the main checkout (also from a worktree). */
function realTorno(): string {
  if (process.env.PINO_TORNO_DIR) return resolve(process.env.PINO_TORNO_DIR)
  const common = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
  return join(dirname(dirname(common)), 'torno')
}

const torno = realTorno()
const here = existsSync(join(torno, '.git'))
if (!here) console.warn('tornoSync: no torno checkout beside pino (set PINO_TORNO_DIR): the real drift check is skipped')

describe.skipIf(!here)('pino against the real torno', () => {
  it('every as-is copy is byte-identical to torno at its recorded commit', () => {
    const r = run(['--torno', torno, '--pino', repo, '--json'])
    expect(r.stderr).toBe('')
    const json = JSON.parse(r.stdout) as { entries: Array<{ pino: string; pinoChanged: boolean }> }
    expect(json.entries.filter((e) => e.pinoChanged).map((e) => e.pino)).toEqual([])
  })
})
