// The workflow, held to what the suites need. The file is read as text: there is no YAML library, and none is needed.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const yml = readFileSync(join(resolve(__dirname, '../..'), '.github/workflows/ci.yml'), 'utf8')
const jobs = [...yml.slice(yml.indexOf('\njobs:\n')).matchAll(/^ {2}([a-z0-9-]+):$/gm)].map((m) => m[1])

/** The script of the `changes` job, as the runner would get it: the block under its `run: |`. */
function changesScript(): string {
  const lines = yml.slice(yml.indexOf('        run: |\n') + '        run: |\n'.length).split('\n')
  const end = lines.findIndex((line) => line !== '' && !line.startsWith('          '))
  return lines.slice(0, end).map((line) => line.slice(10)).join('\n')
}

/** Whether a pull request that changed these files runs the suites. `git` is a stand-in that lists them. */
function isCode(files: string[]): string {
  const stub = `git() { printf '%s\\n' ${files.map((f) => `'${f}'`).join(' ')}; }\n`
  return execFileSync('bash', ['-c', stub + changesScript()], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', EVENT: 'pull_request', BASE_REF: 'main', GITHUB_OUTPUT: '/dev/null' } }).trim()
}

describe('the release workflow', () => {
  const release = readFileSync(join(resolve(__dirname, '../..'), '.github/workflows/release.yml'), 'utf8')

  it("runs on a v tag or by hand: pino's checks, then the Linux build, then a draft", () => {
    expect([...release.slice(release.indexOf('\njobs:\n')).matchAll(/^ {2}([a-z0-9-]+):$/gm)].map((m) => m[1])).toEqual(['checks', 'build', 'release'])
    expect(release).toContain("tags: ['v*']")
    expect(release).toContain('workflow_dispatch:')
    for (const run of ['pnpm -C app typecheck', 'pnpm test', 'bash .claude/hooks/guard-bash.test.sh', 'uv run --no-sync pytest', 'pnpm dist:linux']) expect(release).toContain(`run: ${run}`)
    // A run by hand makes no release, on a tag either.
    expect(release).toContain("if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')")
    // A tag that is not the app's version stops at the checks.
    expect(release).toContain(`run: test "$GITHUB_REF_NAME" = "v$(node -p "require('./app/package.json').version")"`)
    expect(release).toContain('gh release create "$TAG" --draft --verify-tag')
    for (const file of ['app/dist/*.AppImage', 'app/dist/*.tar.gz']) expect(release).toContain(file)
    expect(release).not.toMatch(/macos|dist:mac|demo\.mp4/i)
  })

  it('builds from the scripts that are there, and one version for the repository and the app', () => {
    const [root, app] = ['package.json', 'app/package.json'].map((file) => JSON.parse(readFileSync(join(resolve(__dirname, '../..'), file), 'utf8')) as { version: string; scripts: Record<string, string> })
    expect(root.version).toBe(app.version)
    for (const script of ['dist:linux', 'pack:check']) {
      expect(root.scripts[script]).toBe(`pnpm -C app ${script}`)
      expect(app.scripts[script]).toContain('electron-builder --linux')
    }
    // electron-builder would publish by itself on a tag, given a token: the draft job alone makes a release.
    expect(app.scripts['dist:linux']).toContain('--publish never')
  })
})

describe('the CI workflow', () => {
  it('runs the unit tests, the typecheck, the guard cases and the e2e suite, and no kernel job yet', () => {
    expect(jobs).toEqual(['changes', 'app', 'e2e'])
    expect(yml).toContain('pnpm install --frozen-lockfile')
    expect(yml).toContain('pnpm -C app typecheck')
    expect(yml).toContain('pnpm test')
    expect(yml).toContain('bash .claude/hooks/guard-bash.test.sh')
    expect(yml).toContain("PINO_TEST: '1'")
    expect(yml).toContain("xvfb-run -a -s '-screen 0 1920x1080x24' pnpm -C app exec playwright test")
    expect(yml).toContain('name: pino-e2e-results')
    expect(yml).not.toMatch(/claude(\s|$)|uv sync|ozone|shard/)
  })

  it('skips the suites only for a change of the docs, the licence, the notice or a note at the root', () => {
    expect(isCode(['docs/superpowers/plans/a.md', 'README.md', 'LICENSE', 'NOTICE'])).toBe('code=false')
    for (const code of ['CLAUDE.md', '.claude/rules/sessions.md', '.claude/settings.json', 'app/src/main/http.ts', 'app/README.md', 'package.json', 'scripts/pino', 'pnpm-workspace.yaml']) {
      expect([code, isCode(['README.md', code])]).toEqual([code, 'code=true'])
    }
  })
})
