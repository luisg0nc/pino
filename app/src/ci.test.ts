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
