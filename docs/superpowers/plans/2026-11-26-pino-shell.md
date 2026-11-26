# pino stage 2: the app shell, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pino app that starts with `scripts/pino`, opens a project folder into torno's window grid with a solder-mask green accent, and runs a Claude Code chat in the dock against the stand-in agent, on copied torno plumbing that is listed and checked for drift.

**Architecture:** torno's general modules are copied at mirrored paths (`app/src/{main,preload,renderer,shared}`), each listed in `shared-from-torno.json` as as-is or adapted. Every app-specific name comes from one constant (`app/src/shared/app.ts`). The CAD-heavy hubs of torno (`main/index.ts`, `ipc.ts`, `shared/bridge.ts`, `state/store.ts`, `App.tsx`, `SessionPane.tsx`) are not copied: pino writes small ones of its own in their shape. torno's session manager is cut down behind a `SessionDomain` seam, so the engine stage adds the prompt context and the Stop answer without touching the plumbing.

**Tech Stack:** pnpm 10.28.2 workspace, Node 22.12+, Electron 44, electron-vite 5, TypeScript 7, React 19, zustand 5, @modelcontextprotocol/sdk 1.32, zod 4, vitest 5, Playwright 1.64, POSIX sh launcher, bash + jq + perl guard hook.

**Spec:** `docs/superpowers/specs/2026-11-26-pino-design.md` (sections 2, 3, 4.2, 5.9, 5.10, 7). torno source, read-only: the torno checkout beside pino (`../torno` from the repo root) at commit `597befd755fbffb7af5740f21d64892db0abbd63` (`TORNO_COMMIT` below). Every torno path in this plan is relative to that checkout.

**Where to work:** branch `shell` in a worktree at `.worktrees/shell` (superpowers:using-git-worktrees). The four spike worktrees already in `.worktrees/` are not touched. The branch is pushed and a PR opened against `main` of the private `luisg0nc/pino` only after the leak audit (Task 16); Luis chose one PR per stage (2026-11-26). The director merges after the whole-branch review.
- CI has no torno checkout: `tornoSync.test.ts` and anything that reads `../torno` skip with a clear message when that folder is missing, and run locally when it is there.

## Global Constraints

- Copy now, extract later. A copied torno file lives at the same relative path as in torno. The one exception is a torno file whose own name says torno: its pino path is the torno path with `torno` replaced by `pino` (`scripts/torno` becomes `scripts/pino`).
- Every copied file is an entry of `shared-from-torno.json`: `pino` path, `torno` path, `commit` (TORNO_COMMIT, 40 hex), `mode` `"as-is"` (byte-identical to torno at that commit) or `"adapted"` (with `change`, one line saying what changed). A later edit of an as-is file makes it adapted in the same commit.
- The plan names what to copy. Copy the file from torno, then make only the adaptation the task names. Do not retype torno code from memory.
- `scripts/torno-sync` (node, no dependencies) reports drift both ways. It and every test never write into torno: no install, no test run, no checkout, no git state change there. Reads are `git rev-parse`, `git cat-file`, `git show` only.
- One app prefix, from `app/src/shared/app.ts` only: name `pino`, env `PINO_*`, header `X-Pino-Session`, folder `.pino`, config `~/.config/pino/config.json`, bridge `window.pino`, test hooks `window.__pinoTest` and `globalThis.__pinoMain`, MCP server `pino` (tools `mcp__pino__<tool>`). Files that cannot import it (`scripts/pino`, `app/test/fake-agent.mjs`) hold the name in one variable, and a test holds it equal to `APP.name`.
- Code says "project", never "object": no `objectId`, `ObjectInfo` or `objectOf` (held by `app/src/names.test.ts`).
- pino never writes inside a project folder except under `<project>/.pino/`, through `ownFolder` (Task 4). Stage 2 has no exceptions.
- The HTTP server binds `127.0.0.1` only. Every request carries its session's token in `X-Pino-Session`. The token is only in the agent's environment (`PINO_SESSION`), never in an argument, a file or a log.
- Accent, light: `--accent #17663A`, `--accent-wash #E0EEE4`, `--on-accent #FFFFFF`, `--dye #17663A`, `--scribe #7DB892`, `--on-dye #F1F8F3`, `--on-dye-muted #C4E0CC`, `--diff-added-wash #E0EEE4`.
- Accent, dark: `--accent #5CC489`, `--accent-wash #1F3A2A`, `--on-accent #0B1F13`, `--dye #123D25`, `--scribe #4C9A6A`, `--on-dye #E6F4EA`, `--on-dye-muted #A8D4B5`, `--diff-added-wash #1F3A2A`.
- Marks: `--agent-mark` is Claude Code's orange, `#D97757` in dark, and `#C0502B` in light (the same hue and saturation darkened to the first shade that passes: 4.75:1 under white `--on-mark`, 4.51:1 on the panel). `--user-mark` is a placeholder violet, `#865AD3` light and `#A173EF` dark, "chosen in the design mocks". All other torno colour values are unchanged. All these pass torno's contrast ratios unchanged (checked at plan time).
- Type: Instrument Sans 400/500/600 and Martian Mono 300/400/500 from `@fontsource/*` 5.3.0, latin, bundled. Family names are written only in `shared/fonts.ts` and `renderer/styles/tokens.css`.
- Logo and first-screen drawing are placeholders: the word `pino` in Instrument Sans 600, lowercase, until the mocks stage. The window and desktop icon is a placeholder too.
- Linux only. macOS code paths are dropped, not ported (no `darwin` branches, no traffic lights, no app menu: `Menu.setApplicationMenu(null)`).
- Tests never run the real `claude` CLI: they set `PINO_AGENT_CMD="node <abs>/app/test/fake-agent.mjs"`. Every Electron launch sets `PINO_TEST=1` (window `show: false`, profile in a temp folder), never `--ozone-platform=headless`, never `page.screenshot()`, never the clipboard. Tests never steal focus, never touch the person's home (`HOME`/`XDG_*` are temp folders where a script could write), and kill only processes they started, by pid.
- English only. Sentence case UI text. No em dashes in docs or UI copy.
- Commits: plain messages, no Co-Authored-By trailer, no "Generated with" footer. `.claude/settings.json` sets attribution off.
- pnpm (never npm), Node `>=22.12` (`engines`), electron-vite, TypeScript strict, vitest, Playwright. Dependencies are the subset of torno's `app/package.json` named in Task 1, at torno's versions. No new runtime dependency without a reason in the commit message.

## Review Focus

1. **A project folder whose path has spaces, unicode or a leading dash**, given to `scripts/pino` or picked in the dialog: it opens and its session runs in it. The project id is a hash, so no path reaches a URL. Tests: Task 8 (`project.test.ts`), Task 15 (`launcher.test.ts`).
2. **A project that carries its own Claude Code settings** (`.claude/settings.json` or `.mcp.json`, as a cloned board repo may): pino asks before the first chat there instead of letting headless Claude Code load its hooks silently. Tests: Task 7 (`manager.test.ts`), Task 14 (`chat.spec.ts`).
3. **`.pino` is a symlink or a file** (a copied or cloned project): pino writes nothing through it, the session still runs, and the window says why once. Tests: Task 4 (`own.test.ts`), Task 14 (`chat.spec.ts`).
4. **The window is closed or the project closed while Claude is mid-turn**: the agent and its process group end, its token is revoked, and nothing is written after. Tests: Task 7 (`manager.test.ts`), Task 14 (`chat.spec.ts`).
5. **`claude` is not on PATH** (a desktop launch with a thin PATH, or no Claude Code installed): the dock says so in plain words and the app keeps working. Tests: Task 7 (`manager.test.ts`), Task 14 (`chat.spec.ts`).

---

## File structure after stage 2

```
CLAUDE.md  LICENSE  NOTICE  README.md  package.json  pnpm-workspace.yaml  pnpm-lock.yaml  .gitignore
shared-from-torno.json                 manifest of copied files
scripts/pino  pino.desktop.in  pino.svg  torno-sync
.claude/settings.json  hooks/guard-bash.sh  hooks/guard-bash.test.sh  rules/*.md
.github/workflows/ci.yml
app/package.json  tsconfig.json  vitest.config.ts  electron.vite.config.ts  playwright.config.ts
app/src/
  names.test.ts  manifest.test.ts  tornoSync.test.ts  rules.test.ts  launcher.test.ts  e2e.test.ts
  shared/   app.ts  project.ts  bridge.ts  chat.ts  keys.ts  fonts.ts  contrast.ts
  main/     index.ts  ipc.ts  project.ts  prompt.ts  http.ts  own.ts  atomic.ts  ignored.ts  recent.ts
            frame.ts  quit.ts  loginPath.ts  testProfile.ts  trust.ts  turncost.test.ts
  main/mcp/ server.ts  tools.ts  schemas.ts
  main/sessions/ adapter.ts claude.ts agentEnv.ts transport.ts stream.ts signals.ts status.ts permissions.ts
            models.ts choice.ts resume.ts inside.ts reach.ts transcript.ts chatlog.ts manager.ts domain.ts
  preload/  index.ts
  renderer/ index.html  main.tsx  env.d.ts  App.tsx  state/store.ts  state/chat.ts
            ui/ Welcome  Logo  plate/Plate  TitleBar  WindowControls  FolderMenu  Chevron  useMenu  openFolder
                Popover  popoverPlace  numbered  typing  RouteCard  ViewPane  StatusLine  SessionDock
                QuestionCard  chat/*
            styles/ tokens.css app.css + the copied sheets + route.css views.css
app/test/fake-agent.mjs  app/test/fixtures/*
app/e2e/  launch.ts  helpers.ts  terminal.ts  boot.spec.ts  welcome.spec.ts  themes.spec.ts  chat.spec.ts  mcp.spec.ts
```

New pino files (not in the manifest): `shared/app.ts`, `shared/project.ts`, `shared/bridge.ts`, `main/index.ts`, `main/ipc.ts`, `main/project.ts`, `main/prompt.ts`, `main/mcp/tools.ts`, `main/mcp/schemas.ts`, `main/sessions/domain.ts`, `preload/index.ts`, `renderer/App.tsx`, `renderer/state/store.ts`, `ui/RouteCard.tsx`, `ui/ViewPane.tsx`, `ui/StatusLine.tsx`, `ui/SessionDock.tsx`, `styles/route.css`, `styles/views.css`, `e2e/launch.ts`, every spec, and the root docs. They follow torno's patterns and the rules files.

---

### Task 1: Repo scaffold, manifest and drift report

> **Note from the build:** torno is found by `scripts/torno-sync` and its test as `$PINO_TORNO_DIR`, else `torno` beside the main checkout (the parent of the git common dir): from a worktree, `../torno` from the repo root points elsewhere. `tornoSync.test.ts` also holds every as-is copy against the real torno, and skips with a message where there is none. The guard test also lost torno's grep case that named a person.

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `NOTICE`, `README.md`, `CLAUDE.md`, `shared-from-torno.json`, `scripts/torno-sync`
- Copy as-is: `LICENSE`, `app/tsconfig.json`
- Copy adapted: `app/vitest.config.ts`, `.claude/hooks/guard-bash.sh`, `.claude/hooks/guard-bash.test.sh`
- Create: `.claude/settings.json`, `app/package.json`
- Test: `app/src/tornoSync.test.ts`, `app/src/manifest.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the manifest format every later task appends to; `node scripts/torno-sync [--torno <dir>] [--pino <dir>] [--json]` (exit 0 clean, 1 drift, 2 error); `pnpm test` running `app/src/**/*.test.ts`.

Decisions:
- Root `package.json`: `name: "pino"`, `private: true`, `version: "0.0.0"`, `license: "Apache-2.0"`, `packageManager: "pnpm@10.28.2"`, `engines: { "node": ">=22.12" }`, scripts `start: scripts/pino`, `dev`, `build`, `test`, `test:e2e` forwarding with `pnpm -C app`, as torno's root does.
- `pnpm-workspace.yaml`: `packages: [app]`, `onlyBuiltDependencies: [electron, esbuild]` (no node-pty: no terminal view in stage 2).
- `app/package.json`: `name: "pino-app"`, `productName: "pino"`, `main: "./out/main/index.js"`, scripts `dev: electron-vite dev`, `build: electron-vite build`, `typecheck: tsc --noEmit`, `test: vitest run`, `test:e2e: electron-vite build && playwright test`. Dependencies at torno's versions: `@fontsource/instrument-sans 5.3.0`, `@fontsource/martian-mono 5.3.0`, `@modelcontextprotocol/sdk ^1.32.1`, `zod ^4.6.7`. Dev: `@playwright/test ^1.64.0`, `@types/node ^26.6.4`, `@types/react ^19.3.0`, `@types/react-dom ^19.3.0`, `@vitejs/plugin-react ^5.2.0`, `electron ^44.10.2`, `electron-vite ^5.0.0`, `react ^19.3.0`, `react-dom ^19.3.0`, `typescript ^7.0.2`, `vite ^7.3.7`, `vitest ^5.0.3`, `zustand ^5.0.15`. Left out on purpose: chokidar, node-pty, three, xterm, marked, electron-builder.
- `app/vitest.config.ts` adapted: one mode, `include: ['src/**/*.test.ts']`, `testTimeout: 10_000`; drop the kernel mode, `TORNO_KEEP_BUILDS` and the evals exclude.
- `.gitignore`: `node_modules/`, `out/`, `dist/`, `app/e2e/.results/`, `.worktrees/`, `.claude/worktrees/`, `.claude/settings.local.json`, `.superpowers/`, `*.prof`.
- `NOTICE`: "pino. Copyright 2026 the pino authors." then "This product includes software from torno (https://github.com/luisg0nc/torno), Copyright the torno authors, licensed under the Apache License, Version 2.0. The files are listed in shared-from-torno.json." No personal names.
- `README.md` stub: one line of what pino is, "Stage 2: the app shell. No engine yet.", how to run (`scripts/pino [folder]`), license. Finished in Task 16.
- `CLAUDE.md`: what pino is (two sentences, link the spec); layout of `app/`; the test commands (`pnpm test`, `pnpm test:e2e`, `pnpm -C app typecheck`, `bash .claude/hooks/guard-bash.test.sh`, one file with `pnpm -C app exec vitest run <file>`); "Global invariants" holding every Global Constraint above, one bullet each; "Never run a real agent CLI from tests" (torno's section with `PINO_AGENT_CMD`); "Copied from torno" (manifest rules, `scripts/torno-sync`, as-is versus adapted); "Commits" (plain messages, no trailer); "Rules by area" (filled as rules land).
- `.claude/settings.json`: `{ "attribution": { "commit": "", "pr": "", "sessionUrl": false }, "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/guard-bash.sh", "timeout": 5 } ] } ] } }`.
- `guard-bash.sh` adapted: keep the heredoc stripping, `P`, `E`, `bare` and rule 2 (the real `claude`, `claude --version` aside) and rule 4 (broad kills). Drop rule 1 (uv sync) and rule 3 (evals): they come back with the kernel and the evals. Rule 2's second check reads `PINO_AGENT_CMD`. Messages say pino. The pkill name list holds both `pino(-app)?` and `torno(-app)?`, since both run on this desktop.
- `guard-bash.test.sh` adapted: drop the uv sync and eval cases; `TORNO_AGENT_CMD` cases become `PINO_AGENT_CMD`; add `check 2 'pkill pino'`, `check 2 'pkill torno'`, `check 0 'kill 12345'`.
- `shared-from-torno.json`:

```json
{
  "torno": "https://github.com/luisg0nc/torno",
  "files": [
    { "pino": "LICENSE", "torno": "LICENSE", "commit": "597befd755fbffb7af5740f21d64892db0abbd63", "mode": "as-is" },
    { "pino": "app/vitest.config.ts", "torno": "app/vitest.config.ts", "commit": "597befd7…", "mode": "adapted", "change": "one mode, no kernel or evals" }
  ]
}
```

- `scripts/torno-sync`: CommonJS (`#!/usr/bin/env node`, `require` only, no extension). Default `--pino` is the folder above the script, default `--torno` is `<pino>/../torno`. For each entry: `pinoChanged` (as-is only) is pino's bytes against `git show <commit>:<torno path>`; `tornoChanged` is `git show <commit>:<path>` against `git show HEAD:<path>`; `tornoRemoved` when HEAD has no such path. Text output, one line each: `pino-changed <pino path>`, `torno-changed <torno path> <commit7>..<head7>  (git -C <torno> diff <commit7> HEAD -- <path>)`, `torno-removed <torno path>`, then `<n> files, <k> drifted`. `--json` prints `{ head, entries: [{ pino, torno, mode, commit, pinoChanged, tornoChanged, tornoRemoved }] }`. Exit 2 with one plain line on stderr when torno is not a git repo, the manifest does not parse, or a commit is unknown.

- [x] **Step 1: Write the failing tests**

`app/src/tornoSync.test.ts` builds, in a temp folder, a fake torno repo (`git -c user.name=t -c user.email=t@example.invalid`, files `a.ts`, `b.ts`, `c.ts`, commit X, then edit `b.ts` and delete `c.ts`, commit Y) and a fake pino root with a manifest and copies. It runs `node <repo>/scripts/torno-sync --torno <t> --pino <p> --json`.

```ts
it('reports nothing for an as-is copy that matches, upstream unmoved', () => { /* entry a.ts at X */ expect(r.status).toBe(0); expect(e('a.ts')).toMatchObject({ pinoChanged: false, tornoChanged: false }) })
it('says pino changed an as-is copy', () => { /* edit pino a.ts */ expect(e('a.ts').pinoChanged).toBe(true); expect(r.status).toBe(1) })
it('does not call an adapted copy changed for differing from torno', () => { expect(e('a2.ts')).toMatchObject({ mode: 'adapted', pinoChanged: false }) })
it('says torno changed a file since the recorded commit, as-is or adapted', () => { expect(e('b.ts').tornoChanged).toBe(true) })
it('says a file torno removed', () => { expect(e('c.ts').tornoRemoved).toBe(true) })
it('exits 2 with a plain reason when torno is missing or a commit is unknown', () => { expect(r.status).toBe(2); expect(r.stderr).toMatch(/not a git repository|unknown commit/) })
it('never writes into torno', () => { /* git status --porcelain, rev-parse HEAD, and every file's mtime under <t> equal before and after */ })
```

`app/src/manifest.test.ts`:

```ts
it('lists each copied file once, with a torno path, a full commit and a mode', () => { /* commit /^[0-9a-f]{40}$/, mode in ['as-is','adapted'], adapted has a non-empty change, pino paths unique */ })
it('keeps torno\'s paths: pino path is the torno path, with torno in a file name read as pino', () => { expect(f.pino).toBe(f.torno.replace(/torno(?=[^/]*$)/g, 'pino')) })
it('names only files that are tracked in pino', () => { /* git ls-files --cached --others --exclude-standard contains every pino path */ })
```

- [x] **Step 2: Run them to verify they fail**

Run: `pnpm install && pnpm -C app exec vitest run src/tornoSync.test.ts src/manifest.test.ts`
Expected: FAIL, script and manifest missing.

- [x] **Step 3: Write the scaffold files, the manifest and `scripts/torno-sync` as decided above, copy `LICENSE` and `app/tsconfig.json` as-is, adapt `vitest.config.ts` and the guard hook and its test**

- [x] **Step 4: Run the tests and the guard cases**

Run: `pnpm test && bash .claude/hooks/guard-bash.test.sh && node scripts/torno-sync`
Expected: vitest PASS; guard test prints no FAIL line and exits 0; torno-sync prints `<n> files, 0 drifted` and exits 0 (it reads the real torno, read-only).

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "Scaffold pino: workspace, docs, guard hook, torno manifest and drift report"
```

---

### Task 2: App prefix and the local HTTP server

> **Note from the build:** The names test takes out only comments that open their own line (and JSX ones), so a `//` in an address or a `/*` in a glob is never read as a comment and cannot hide code.

**Files:**
- Create: `app/src/shared/app.ts`, `app/src/shared/app.test.ts`, `app/src/names.test.ts`
- Copy adapted: `app/src/main/http.ts` (header from `APP.header`; comments say `/mcp/<project id>`), `app/src/main/http.test.ts` (object becomes project in words and fixtures)
- Modify: `shared-from-torno.json`

**Interfaces:**
- Consumes: Task 1 scaffold.
- Produces:
  - `APP = { name: 'pino', envPrefix: 'PINO_', header: 'X-Pino-Session', folder: '.pino', configDir: 'pino', bridge: 'pino', testHook: '__pinoTest', mainHook: '__pinoMain' } as const`
  - `envName(name: string): string`, `TOOL_PREFIX = 'mcp__pino__'`, `toolName(tool: string): string`
  - `SIBLING_PREFIXES: readonly string[] = ['TORNO_']`: the env prefixes of sibling apps whose session variables an agent must not inherit (the one place another app's name is code).
  - From `main/http.ts`, unchanged in shape: `HttpRouter { port; url(path); grant(paths): string; revoke(token); redact(text); route(prefix, h); close() }`, `startHttp(): Promise<HttpRouter>`, `SESSION_HEADER`, `REDACTED`, `sendJson`, `readBody`, `BodyTooLarge`.

`names.test.ts` reads `git ls-files --cached --others --exclude-standard` under `app/src`, `app/e2e`, `app/test` (not `app/test/fixtures/`), `scripts`, `.github`, `.claude/hooks`. It strips comments (`//` lines and `/* */` in ts/tsx/mjs/js/css, `#` lines in sh and yml) and checks the code that is left. Allowed to name torno: `scripts/torno-sync`, `app/src/tornoSync.test.ts`, `app/src/manifest.test.ts`, `app/src/names.test.ts`, `app/src/shared/app.ts`, `.claude/hooks/guard-bash.sh`, `.claude/hooks/guard-bash.test.sh`.

- [x] **Step 1: Write the failing tests**

```ts
// shared/app.test.ts
it('is pino, said once', () => {
  expect(APP).toEqual({ name: 'pino', envPrefix: 'PINO_', header: 'X-Pino-Session', folder: '.pino', configDir: 'pino', bridge: 'pino', testHook: '__pinoTest', mainHook: '__pinoMain' })
  expect([envName('TEST'), TOOL_PREFIX, toolName('project')]).toEqual(['PINO_TEST', 'mcp__pino__', 'mcp__pino__project'])
})
// names.test.ts
it('names torno nowhere in code, outside the files that compare with it', () => { expect(offenders(/torno/i)).toEqual([]) })
it('says project, never object, in identifiers', () => { expect(offenders(/\b(objectId|objectIds|ObjectInfo|objectOf)\b/)).toEqual([]) })
// http.test.ts: torno's cases, plus
it('reads the token from X-Pino-Session', () => { expect(SESSION_HEADER).toBe('X-Pino-Session') })
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/shared/app.test.ts src/names.test.ts src/main/http.test.ts`
Expected: FAIL, modules missing.

- [x] **Step 3: Write `shared/app.ts` and `names.test.ts`; copy `http.ts` and `http.test.ts` and make the named adaptation; add both to the manifest as adapted**

- [x] **Step 4: Run to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "Add the app prefix and torno's local HTTP server with per-session tokens"
```

---

### Task 3: MCP mount with one tool, and what a turn costs

**Files:**
- Copy adapted: `app/src/main/mcp/server.ts` (server name `APP.name`, version read from `app/package.json` at build, `registerTools` from pino's `./tools`, no `registerPrompts`, `SERVER_INSTRUCTIONS` from pino's `./schemas`, error words say project)
- Create: `app/src/shared/project.ts`, `app/src/main/mcp/tools.ts`, `app/src/main/mcp/schemas.ts`, `app/src/main/prompt.ts`, `app/src/main/mcp/server.test.ts`
- Copy adapted: `app/src/main/turncost.test.ts` (drop the picture and note cases; the tool list and the prompt ceiling stay)
- Modify: `shared-from-torno.json`

**Interfaces:**
- Consumes: `HttpRouter`, `readBody`, `BodyTooLarge` (Task 2), `APP`, `toolName` (Task 2).
- Produces:
  - `shared/project.ts`: `interface ProjectInfo { id: string; dir: string; name: string }`, `interface RecentFolder { root: string; missing: boolean }`
  - `mcp/tools.ts`: `interface ToolDeps { project(id: string): ProjectInfo | undefined }`, `registerTools(server: McpServer, deps: ToolDeps, projectId: string): void`
  - `mountMcp(http: HttpRouter, deps: ToolDeps): void` serving `POST /mcp/<projectId>`
  - `mcp/schemas.ts`: `SERVER_INSTRUCTIONS: string`
  - `prompt.ts`: `SYSTEM_PROMPT: string`, `systemPrompt(toolName: (tool: string) => string): string`

The one tool is `project`: no input (`inputSchema` empty object, unknown keys refused by zod `.strict()`), `_meta: { 'anthropic/alwaysLoad': true }`. It answers one text block: `Project <name> in <dir>. board.py: <present|absent>. brief.md: <present|absent>. pino has no engine yet: nothing is built or drawn.` An id with no open project is an `isError` result: `No project <id> is open in pino.` `SERVER_INSTRUCTIONS` is two sentences saying the server is pino's, for the open project, and that only `project` exists for now. `SYSTEM_PROMPT` says pino is a workbench where Claude designs printed circuit boards from `board.py`, that this build has no engine, and that Claude says so instead of pretending to build.

- [x] **Step 1: Write the failing tests**

`server.test.ts` starts `startHttp()`, mounts with a `ToolDeps` of one temp project, grants a token for `/mcp/<id>`, and talks with the SDK's `Client` over `StreamableHTTPClientTransport` with the header.

```ts
it('answers 404 without the project\'s token, and with a token of another project', ...)
it('answers 405 to GET, and 404 to a path that is not one project id', ...)
it('answers 413 to a body over 4 MiB', ...)
it('lists one tool, project, loaded up front', async () => { expect(tools.map((t) => t.name)).toEqual(['project']); expect(tools[0]._meta?.['anthropic/alwaysLoad']).toBe(true) })
it('calls project and gets the project\'s name and folder', async () => { expect(text).toContain(`Project ${name} in ${dir}.`); expect(text).toContain('board.py: absent') })
it('answers an id with no open project in words, as an error result', ...)
it('is served at the version of app/package.json', ...)
// turncost.test.ts
it('the tools loaded up front are [project], in at most 33,000 characters of name, description and schema', ...)
it('the text pino adds to the system prompt, with its server\'s instructions, is under 12,000 characters', () => { expect(SYSTEM_PROMPT.length + SERVER_INSTRUCTIONS.length).toBeLessThan(12_000) })
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/main/mcp/server.test.ts src/main/turncost.test.ts`
Expected: FAIL, modules missing.

- [x] **Step 3: Copy and adapt `server.ts` and `turncost.test.ts`; write `project.ts`, `tools.ts`, `schemas.ts`, `prompt.ts`**

- [x] **Step 4: Run to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "Mount pino's MCP server per project with one tool, and hold the turn's cost"
```

---

### Task 4: The `.pino/` write guard

> **Note from the build:** `atomic.test.ts`, `own.order.test.ts` and `rules.test.ts` are adapted, not as-is: the first two name torno's folder (the second cannot pass against `.pino`), and the third wants more than 40 rules.

**Files:**
- Copy adapted: `app/src/main/own.ts` (`FOLDER = APP.folder`; `ownTorno` renamed `ownFolder`; messages name `APP.name`), `app/src/main/ignored.ts` (names), `app/src/main/own.test.ts` (keep the generic cases; drop views, exports and scans), `app/src/main/ignored.test.ts` (names)
- Copy as-is: `app/src/main/atomic.ts`, `app/src/main/atomic.test.ts`, `app/src/main/own.order.test.ts`, `app/src/rules.test.ts`
- Copy adapted: `.claude/rules/workspace-writes.md` (pino writes only under `<project>/.pino/`; no exceptions in stage 2; paths are pino's)
- Modify: `shared-from-torno.json`, `CLAUDE.md` (Rules by area)

**Interfaces:**
- Consumes: `APP` (Task 2).
- Produces: `FOLDER`, `ownFolder(dir: string, ...inside: string[]): Promise<string>`, `writeOwn(dir: string, name: string, data: string | Uint8Array): Promise<void>`, `onNotOwn(cb: NotOwnListener | null): void`, `writeFileAtomic(path, data): Promise<void>`, `ensureIgnored(dir: string, lines: readonly string[]): Promise<void>`.

- [x] **Step 1: Copy the tests and adapt them as named**

Kept from torno's `own.test.ts`, in pino's words: "answers with the folder when there is none yet, and when it is a real folder", "refuses a link in its place, and a file, with a plain reason", "tells of a folder once, whoever was refused there and however often", "is the one rule: a linked .pino is refused in the same words, and the window is told". Add:

```ts
it('writes nothing where a linked .pino leads, and the project keeps no new file', async () => {
  symlinkSync(outside, join(project, '.pino'))
  await expect(writeOwn(project, 'session.json', '{}')).rejects.toThrow(/is a link/)
  expect(readdirSync(outside)).toEqual([])
})
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/main/own.test.ts src/main/own.order.test.ts src/main/atomic.test.ts src/main/ignored.test.ts src/rules.test.ts`
Expected: FAIL, modules missing.

- [x] **Step 3: Copy the modules and the rule, make the named adaptations, list them in the manifest**

- [x] **Step 4: Run to verify they pass**

Run: `pnpm test`
Expected: PASS (rules.test finds `workspace-writes.md` and every glob in it matches a tracked file).

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "Copy torno's write guard as the .pino folder guard"
```

---

### Task 5: Claude Code launch, stream and the stand-in agent

> **Note from the build:** `stream.test.ts`, `inside.test.ts` and `trust.test.ts` are adapted, not as-is: their temp folder names torno, which the names test refuses.
>
> **Note from the build:** `agentEnv.test.ts` builds the sibling variable name from `SIBLING_PREFIXES`, so the names allowlist stays as Task 2 lists it.
>
> **Note from the build:** `reach.ts` also resolves a relative path against the project folder: as copied, a relative write was read as one under `.pino/` and refused.

**Files:**
- Copy as-is: `app/src/main/sessions/transport.ts`, `stream.ts`, `stream.test.ts`, `signals.ts`, `permissions.ts`, `permissions.test.ts`, `inside.ts`, `inside.test.ts`, `app/src/main/trust.ts`, `app/src/main/trust.test.ts`, `app/test/fixtures/claude-stream.jsonl`, `claude-stream-asks.jsonl`, `RECORDING.md`
- Copy adapted:
  - `sessions/adapter.ts`: types from pino's `shared/bridge` and `shared/chat`; doc words say pino and project.
  - `sessions/claude.ts`: `TOKEN_VARIABLE = envName('SESSION')`; `toolName` and `--allowedTools ${TOOL_PREFIX}*` from `shared/app`; MCP server key `APP.name`; drop `reviewerAgents`, `reviewerModel`, `TORNO_PLUGIN` and `--plugin-dir` (no skills yet: `skills: false`); every hook gets the 5 s timeout (the longer PostToolUse and Stop timeouts come back with the build loop); keep `HEADLESS`, `TESTED_CLAUDE`, `--session-id`/`--resume`, `--mcp-config <file>`, `--settings`, `--append-system-prompt`, `--model=`, `--effort=`.
  - `sessions/claude.test.ts`: drop the reviewer and plugin cases.
  - `sessions/agentEnv.ts`: session variables `PINO_SESSION`, `PINO_PROJECT_ID`, `PINO_SESSION_ID`, plus `<prefix>SESSION`, `<prefix>OBJECT`, `<prefix>SESSION_ID` for each `SIBLING_PREFIXES` entry; own switches `PINO_TEST`, `PINO_AGENT_CMD`, `PINO_CONFIG`, `PINO_PROJECT`, `PINO_DEBUG`.
  - `sessions/agentEnv.test.ts`: names.
  - `sessions/status.ts`: drop `sessionOfWorkspace` (one project at a time).
  - `sessions/status.test.ts`: drop its cases.
  - `sessions/reach.ts`: refusal words say the project's folder; drop the workspace `common/` allowance.
  - `sessions/reach.test.ts`: to match.
  - `sessions/choice.ts`: keep `findCommand` only; `readChoice`/`writeChoice` go (chat is the only view).
  - `sessions/choice.test.ts`: `findCommand` cases only.
  - `sessions/resume.ts`: `ownFolder`, `FOLDER`; doc words.
  - `app/test/fake-agent.mjs`: `const APP = 'pino'` at the top; the MCP server key, the `mcp__${APP}__` prefix, the `env` line filter (`PINO`), the init's `mcp_servers` name and the plugin entry (`name`, `source: '<APP>@inline'`) come from it. No `torno` is left in its code (Task 2's names test reads it).
  - `.claude/rules/agent-launch-and-tokens.md`, `.claude/rules/e2e-stand-in-agent.md`: pino's names and paths, no evals, no plugin.
- Copy adapted: `app/src/shared/chat.ts` (the adaptation is written in Task 6)
- Create: `app/src/shared/bridge.ts` with only `AgentView` and `SessionStatus` for now (filled in Task 8).
- Modify: `app/src/shared/app.test.ts`, `shared-from-torno.json`, `CLAUDE.md`

**Interfaces:**
- Consumes: `SESSION_HEADER` (Task 2), `envName`, `TOOL_PREFIX`, `toolName`, `SIBLING_PREFIXES` (Task 2), `ownFolder`, `FOLDER`, `writeOwn` (Task 4).
- Produces:
  - `type AgentView = 'chat' | 'terminal'`, `type SessionStatus = 'starting' | 'idle' | 'working' | 'needs_input' | 'exited'`
  - `AgentAdapter`, `AgentLaunch`, `LaunchContext` (torno's shape), `claudeAdapter(agentCmd?: string): AgentAdapter`, `HOOK_EVENTS`, `TESTED_CLAUDE`
  - `AgentTransport`, `AgentMessage`, `AgentAsk`, `AskAnswer`, `PromptBlock`, `ClaudeStream`
  - `agentEnv(env)`, `withoutSession(env)`, `reduceStatus(prev, event, body?)`, `sessionRules(suggestions)`
  - `refusalOf(dir, name, input): string | undefined`, `deniedAnswer(reason)`, `isInsideFolder(dir, file)`, `realPathOrNearest(path)`
  - `findCommand(command, path?): string | null`
  - `storedConversation(dir): string | null`, `storeConversation(dir, id): Promise<void>`, `SESSION_FILE`, `UUID`
  - `Trust` (`constructor(file: string | null, home?)`, `pending(dir): Promise<string[]>`, `accept(dir): Promise<void>`), `projectSettings(dir, home?)`

`adapter.ts` imports `Effort` from `shared/chat.ts`, so this task copies `shared/chat.ts` with the adaptation Task 6 describes (it is types and pure rules, with no dependency on the transport). Task 6 owns its tests.

- [x] **Step 1: Copy the tests (as-is and adapted), and add**

```ts
// agentEnv.test.ts
it('gives the agent no session token of a sibling app that started pino', () => {
  expect(agentEnv({ TORNO_SESSION: 'x', PINO_SESSION: 'y', PATH: '/bin' })).toEqual({ PATH: '/bin' })
})
// claude.test.ts
it('names pino\'s server and tools, and keeps the token out of every argument and file', () => {
  const run = claudeAdapter().launch(ctx)
  expect(run.env).toEqual({ PINO_SESSION: ctx.token })
  expect(run.args.join(' ')).not.toContain(ctx.token)
  expect(run.files[0].text).toContain('"X-Pino-Session": "${PINO_SESSION}"')
  expect(run.args).toContain('mcp__pino__*')
  expect(run.args).not.toContain('--agents')
})
// app.test.ts
it('the stand-in agent names the app as shared/app.ts does', () => { expect(readFileSync(fake, 'utf8')).toMatch(/^const APP = 'pino'$/m) })
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/main/sessions src/main/trust.test.ts src/shared/app.test.ts`
Expected: FAIL, modules missing.

- [x] **Step 3: Copy the files and make the named adaptations, list them in the manifest**

- [x] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm -C app typecheck`
Expected: PASS. The as-is tests pass unchanged. If one fails only for a missing pino module, that test file becomes adapted, with the reason in `change`.

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "Copy torno's Claude Code launch, stream, trust and the stand-in agent"
```

---

### Task 6: Chat items, transcript, chat log and models

> **Note from the build:** `models.test.ts` is adapted, not as-is (its temp folder names torno).
>
> **Note from the build:** pino has no terminal view, so the failed-login note has no button and its words say to sign in from a terminal; the `action` field of a note is gone from `shared/chat.ts` and from `chatlog.ts`.
>
> **Note from the build:** The recordings stay as-is: `transcript.test.ts` reads the app name each was recorded with from its `init` and reads it as pino.
>
> **Note from the build:** The caption that named onboarding pictures is cut with its test: pino has no onboarding.
>
> **Note from the build:** `chatlog.ts` also loses `readPrompts` and `conversations`, which only torno's prompt list used.

**Files:**
- Copy adapted (`shared/chat.ts` was copied in Task 5 with this adaptation; this task checks it):
  - `app/src/shared/chat.ts`: drop the imports of `board`, `drawing`, `git`, `sanity` and the fields they type. User items lose `drawing`, `notes`, `board`. Context items keep `kind, id, forUser, forTool?, text, marks, instructions?`. `TORNO_TOOL_PREFIX` becomes `TOOL_PREFIX` from `shared/app`, and `isTornoTool` becomes `isAppTool`. The tool item field `torno: boolean` becomes `own: boolean`. Drop `pulledFromTorno` and the ref grammar (`refsIn` and its patterns): refs come back with marks in stage 4.
  - `app/src/main/sessions/transcript.ts`: cut the five seams. `userSent(content, queued, uuid?)` without notes or board, and without the `ATTACHMENT_HEAD` and `NOTE_HEAD` filters. `context(c)` takes `{ text; sentMarkIds; prompt?; instructions? }`. `toolContext` goes (it is the build under a tool card). `NO_HOOKS` and `RUNNING_BARE` name `envName('SESSION')`.
  - `app/src/main/sessions/transcript.test.ts`: delete each test whose subject is a removed field or `toolContext`, and keep the rest unchanged.
  - `app/src/main/sessions/chatlog.ts`: `ownFolder`, `.pino/chat/`.
  - `app/src/main/sessions/chatlog.test.ts`: names.
  - `app/src/main/sessions/models.ts`: kept in pino's user data.
- Copy as-is: `app/src/main/sessions/models.test.ts`
- Copy adapted: `.claude/rules/chat-transcript.md`
- Modify: `shared-from-torno.json`

**Interfaces:**
- Consumes: Task 5 transport types and `shared/chat.ts`, `ownFolder`, `writeFileAtomic`, `ensureIgnored`.
- Produces: `ChatItem`, `ChatImage`, `ChatMeta`, `ChatHistory`, `ChatCommand`, `ChatModel`, `ChatAnswer`, `Effort`, `Mode`, `EFFORTS`, `MODES`, `MODE_NOTE`, `MAX_ITEMS`, `isEffort`, `isMode`, `isAppTool`, `toolLabel`, `shownPath`, `agentChoiceOf`; `Transcript` (torno's options and methods minus `toolContext`); `appendItems`, `readLog`, `lastConversation`, `trimLog`; `KnownModels`, `modelsOf`.

- [x] **Step 1: Copy and trim the tests as named, and add**

```ts
// transcript.test.ts
it('marks a tool of pino\'s own by its prefix', () => {
  t.message(toolUse('mcp__pino__project'))
  expect(lastTool().own).toBe(true)
  t.message(toolUse('Bash'))
  expect(lastTool().own).toBe(false)
})
// chatlog.test.ts
it('keeps the log under .pino/chat and nowhere else in the project', async () => {
  await appendItems(project, id, items)
  expect(walk(project).filter((p) => !p.startsWith('.pino/'))).toEqual([])
})
```

- [x] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/main/sessions/transcript.test.ts src/main/sessions/chatlog.test.ts src/main/sessions/models.test.ts`
Expected: FAIL.

- [x] **Step 3: Copy and adapt as named**

- [x] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm -C app typecheck`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "Copy torno's chat items, transcript, chat log and models, without the CAD seams"
```

---

### Task 7: Session manager with a domain seam

**Files:**
- Create: `app/src/main/sessions/domain.ts`, `app/src/main/sessions/manager.test.ts`
- Copy adapted: `app/src/main/sessions/manager.ts` (cut down, see below), `.claude/rules/sessions.md`
- Modify: `shared-from-torno.json`

**Interfaces:**
- Consumes: everything Task 5 and Task 6 produce; `HttpRouter` (Task 2); `ProjectInfo` (Task 3); `FOLDER` (Task 4).
- Produces:

```ts
// domain.ts
export interface SessionDomain {
  /** Added to a prompt through its UserPromptSubmit hook (additionalContext); '' adds nothing. */
  promptContext(project: ProjectInfo, prompt: string): Promise<string>
  /** The Stop hook's answer: null lets the turn end; a block sends the agent on with the reason. */
  stopAnswer(project: ProjectInfo): Promise<{ decision: 'block'; reason: string } | null>
}
export const NO_DOMAIN: SessionDomain // '' and null

// manager.ts
export type StartResult =
  | { sessionId: string; status: SessionStatus }
  | { refused: string; question?: { kind: 'trust'; files: string[] } }
export class Sessions {
  constructor(deps: { http: HttpRouter; adapter: AgentAdapter; configDir: string; env: Record<string, string | undefined>; domain: SessionDomain; trust: Trust; models: KnownModels; systemPrompt: string; debug?: (line: string) => void })
  start(project: ProjectInfo, opts?: { resume?: boolean; model?: string; effort?: Effort }): Promise<StartResult>
  current(projectId: string): { sessionId: string; status: SessionStatus } | null
  resumable(project: ProjectInfo): boolean
  send(sessionId: string, prompt: { text: string }): Promise<void>
  answer(sessionId: string, requestId: string, answer: ChatAnswer): void
  interrupt(sessionId: string): Promise<void>
  setModel(sessionId: string, model: string): Promise<void>
  setEffort(sessionId: string, effort: Effort): Promise<void>
  setMode(sessionId: string, mode: Mode): Promise<void>
  history(sessionId: string): ChatHistory | undefined
  stop(sessionId: string): Promise<void>
  stopAll(): Promise<void>
  on(event: 'status' | 'item' | 'meta' | 'capabilities', cb: (m: unknown) => void): () => void  // typed per event as torno's Events
}
```

Cut from torno's `manager.ts`: node-pty and the terminal view (`write`, `resize`, `insert`, `onData`), builds and edits (`built`, `causeOf`, `nextBuild`, `afterEdit`, `notLookedAt`, `buildStarts`/`buildEnds`), `sanity`, `verdicts`, snapshots, `changesOf`, `undoTurn`, `noteGoBack`, notes, board and drawings in prompts, `listPrompts`, `holdAsk`, and the turn's Bash bookkeeping that served the build cause. The prompt context becomes `domain.promptContext`, and the Stop answer becomes `domain.stopAnswer`.

Kept: one session per project; a token granted for `/mcp/<projectId>` and `/hooks/<sessionId>`, revoked at exit; the MCP config file written in `configDir` and removed at exit; `agentEnv`; `findCommand` before start (refused: `Claude Code was not found on PATH. Install it, or start pino from a terminal where claude runs.`); `Trust.pending` before the first chat (refused with the trust question); `refusalOf` on PreToolUse; `reduceStatus`; the transcript; `appendItems` (redacted) to `.pino/chat/`; `storeConversation` and resume; and stop (end, SIGTERM to the group after 2 s, SIGKILL after 4 s).

- [ ] **Step 1: Write the failing tests**

`manager.test.ts` uses a real `startHttp()`, `claudeAdapter('node <abs>/test/fake-agent.mjs')`, a temp project, a temp `configDir` and a `Trust(null, tempHome)`. It never spawns the real CLI.

```ts
it('starts Claude Code in the project folder, the token in its environment only', ...)    // init fake_argv lacks the token; cwd is the project
it('a prompt is answered, and the status goes working then idle', ...)                     // send 'say hello'; item text 'hello'
it('calls pino\'s one tool through the real MCP server', ...)                              // 'tool mcp__pino__project {}' gives a tool item whose result has the project name
it('adds the domain\'s context to a prompt and takes its Stop answer', ...)                // promptContext 'CTX' shows in hook_response; a block makes the stand-in post Stop again
it('refuses a Write outside the project folder, and nothing is written there', ...)        // 'write ../outside.txt x'
it('asks before the first chat in a folder with Claude Code settings of its own', ...)     // .claude/settings.json gives { refused, question: { kind: 'trust' } }; after trust.accept it starts
it('says in plain words that Claude Code was not found, and starts nothing', ...)          // adapter for '/nonexistent/claude'
it('stop ends the agent mid-turn, revokes its token and writes nothing after', ...)        // 'slow 30', stop: pid gone in 5 s, MCP 404, .pino/chat mtime unchanged 1 s later
it('writes only under .pino: the chat log, the session file and .pino/.gitignore', ...)    // tree before and after; every new path starts with '.pino/'
it('resumes the stored conversation with --resume', ...)
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/main/sessions/manager.test.ts`
Expected: FAIL, `Sessions` missing.

- [ ] **Step 3: Write `domain.ts`; copy `manager.ts`, cut it as listed, wire the seam; copy and adapt the rule**

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm -C app typecheck`
Expected: PASS, with no stand-in left running (`pgrep -f fake-agent.mjs` shows none in the temp folders).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Cut torno's session manager to its plumbing behind a SessionDomain seam"
```

---

### Task 8: Electron main, preload, bridge and opening a project

**Files:**
- Copy as-is: `app/electron.vite.config.ts`, `app/src/main/quit.ts`, `app/src/main/quit.test.ts`, `app/src/renderer/ui/openFolder.ts`, `app/src/renderer/ui/openFolder.test.ts`
- Copy adapted:
  - `app/src/main/recent.ts`: `Config { project?: string; recent: string[] }`, `RecentFolder` from `shared/project`.
  - `app/src/main/recent.test.ts`: to match.
  - `app/src/main/frame.ts`: Linux only. `frameOptions(dark)` returns `{ titleBarStyle: 'hidden' }`. `drawsControls()` goes, because the window always draws its controls. Drop `MUTED`; keep `SURFACE`, `MIN_WINDOW`, `TITLE_BAR_HEIGHT`.
  - `app/src/main/window.test.ts`: Linux cases only.
  - `app/src/main/loginPath.ts`: marker `__PINO_PATH__`; comments.
  - `app/src/main/loginPath.test.ts`: to match.
  - `app/src/main/testProfile.ts`: prefix `${APP.name}-test-`.
  - `app/src/main/testProfile.test.ts`: to match.
  - `app/src/renderer/index.html`: title `pino`; same CSP.
  - `app/src/renderer/main.tsx`: the six font imports, `tokens.css`, `app.css`, `App`. The stylesheets come in Task 10, so import them there if this task runs first.
- Create: `app/src/main/index.ts`, `app/src/main/ipc.ts`, `app/src/main/project.ts`, `app/src/main/project.test.ts`, `app/src/preload/index.ts`, `app/src/renderer/env.d.ts`, `app/src/renderer/App.tsx` (placeholder: `<main data-region="viewport">pino</main>`)
- Modify: `app/src/shared/bridge.ts`, `shared-from-torno.json`

**Interfaces:**
- Consumes: Tasks 2 to 7.
- Produces:
  - `main/project.ts`: `projectIdOf(realDir: string): string` (`'p'` plus the first 12 hex of sha256 of the real path) and `openProject(dir: string): Promise<ProjectInfo>`. It resolves the real path. A missing path, a file or an unreadable folder is rejected with `Error('<name> is not a folder pino can open: <reason>')`.
  - `shared/bridge.ts` `PinoBridge`, exposed as `window.pino`:

```ts
project: { pick(): Promise<ProjectInfo | null>; open(dir: string): Promise<ProjectInfo>; current(): Promise<ProjectInfo | null>; recent(): Promise<RecentFolder[]>; close(): Promise<void> }
window: { minimize(): void; toggleMaximize(): void; close(): void; onMaximized(cb: (max: boolean) => void): () => void }
session: { current(projectId: string): Promise<{ running: { sessionId: string; status: SessionStatus } | null; resumable: boolean }>;
           start(projectId: string, opts?: { resume?: boolean }): Promise<StartResult>; trust(projectId: string): Promise<void>;
           stop(sessionId: string): Promise<void>; onStatus(cb: (m: { sessionId: string; status: SessionStatus }) => void): () => void }
chat: { history(sessionId: string): Promise<ChatHistory>; lastConversation(projectId: string): Promise<{ items: ChatItem[]; at: string | null } | null>;
        send(sessionId: string, prompt: { text: string }): Promise<void>; answer(sessionId: string, requestId: string, answer: ChatAnswer): void;
        interrupt(sessionId: string): Promise<void>; setModel(sessionId: string, model: string): Promise<void>; setMode(sessionId: string, mode: Mode): Promise<void>;
        setEffort(sessionId: string, effort: Effort): Promise<void>; models(): Promise<ChatModel[]>;
        onItem(cb): () => void; onMeta(cb): () => void; onCapabilities(cb): () => void }   // payloads as torno's bridge
notices: { onNotice(cb: (m: { text: string }) => void): () => void }
```

- `main/index.ts` environment switches, said in a comment block as torno's: `PINO_TEST=1` (hidden window, temp profile, no single-instance lock, test hooks), `PINO_PROJECT=<path>` (project to open at start), `PINO_CONFIG=<path>` (config file; none under test unless given), `PINO_AGENT_CMD=<cmd>` (the stand-in), `PINO_DEBUG=1`. It calls `app.setName(APP.name)` and `setDesktopName('pino.desktop')`. The window is 1440 by 900, `show: false`, and shown on `ready-to-show` only outside test. It has `contextIsolation: true`, `nodeIntegration: false`, `backgroundThrottling: false`, `backgroundColor` from `SURFACE`, and `disable-frame-rate-limit` under test. It calls `Menu.setApplicationMenu(null)` and `applyLoginPath()` before the first session. Then `startHttp`, `mountMcp` with `ToolDeps.project` (the open project or undefined), `Sessions` with `NO_DOMAIN`, `systemPrompt(toolName)`, `Trust(<userData>/trusted.json)` and `KnownModels(<userData>/models.json)`. `onNotOwn` sends a notice to the window. `before-quit` runs `stopAll` through `quitGate(3000)`. `project.close` and opening another project stop the current session first.
- `globalThis.__pinoMain` (test only): `pickFolder: string | null`, `picks: number`, `mcpFor(projectId): { url: string; token: string }`, `configPath(): string | null`.

- [ ] **Step 1: Copy the tests named above, and write `project.test.ts`**

```ts
it('opens a real folder by its real path, with a stable id', async () => { expect(p).toEqual({ id: projectIdOf(real), dir: real, name: basename(real) }) })
it('gives a folder the same id through a link or a trailing slash', ...)
it('opens a folder whose name has spaces, unicode or a leading dash', async () => { for (const n of ['my board', 'placa-ção', '-dash']) await expect(openProject(join(tmp, n))).resolves.toMatchObject({ name: n }) })
it('refuses a file and a missing path in plain words', async () => { await expect(openProject(file)).rejects.toThrow(/is not a folder pino can open/) })
it('makes ids that are one URL segment', () => { expect(projectIdOf('/a b/ç')).toMatch(/^p[0-9a-f]{12}$/) })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/main/project.test.ts src/main/recent.test.ts src/main/window.test.ts src/main/loginPath.test.ts src/main/testProfile.test.ts src/main/quit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Copy and adapt the modules; write `project.ts`, `bridge.ts`, `ipc.ts`, `preload/index.ts`, `index.ts`, the placeholder `App.tsx`**

- [ ] **Step 4: Run to verify they pass, and that it builds**

Run: `pnpm test && pnpm -C app typecheck && pnpm -C app build`
Expected: PASS; `app/out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html` exist.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add pino's Electron main, preload and bridge, and project opening"
```

---

### Task 9: The e2e harness in a hidden window

**Files:**
- Copy adapted:
  - `app/playwright.config.ts`: drop `TORNO_KEEP_BUILDS` and the evals ignore; keep one worker, CI retries and timeouts, `outputDir: './e2e/.results'`.
  - `app/e2e/terminal.ts`: keep `cwdOf` and `agentsIn`; Linux `/proc` only; drop `inTerminal`.
  - `.claude/rules/e2e-hidden-window.md`: pino's hooks and names. Drop the kernel, scans, export, look and terminal bullets.
- Create: `app/e2e/launch.ts`, `app/e2e/boot.spec.ts`, `app/src/e2e.test.ts`
- Modify: `shared-from-torno.json`, `CLAUDE.md`

**Interfaces:**
- Consumes: the built app (Task 8), `__pinoMain` hooks.
- Produces:
  - `launch(opts?: { project?: string; agent?: boolean; env?: Record<string, string> }): Promise<{ app: ElectronApplication; page: Page; config: string }>`. It always sets `PINO_TEST=1` and `PINO_CONFIG` to a fresh temp file. With `agent` it sets `PINO_AGENT_CMD=node <abs>/test/fake-agent.mjs`. It waits for `[data-region]`.
  - `tempProject(name?: string): string` makes a temp project under `realpathSync(tmpdir())`.
  - `agentsIn(dir)`, `cwdOf(pid)`.

- [ ] **Step 1: Write the failing tests**

```ts
// app/src/e2e.test.ts: the hidden-window rule, held by reading the specs
it('every spec launches Electron through e2e/launch.ts', () => { expect(specsNaming(/_electron|electron\.launch/).filter((f) => f !== 'e2e/launch.ts')).toEqual([]) })
it('launch.ts sets PINO_TEST=1 and never passes an ozone platform', () => { expect(src).toContain("PINO_TEST: '1'"); expect(src).not.toMatch(/ozone/) })
it('no spec takes a screenshot or touches the clipboard', () => { expect(specsNaming(/\.screenshot\(|clipboard/)).toEqual([]) })
// app/e2e/boot.spec.ts
test('starts with its window hidden', async () => { expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false) })
test('keeps its profile in a temp folder, not under the person\'s config', async () => { expect(await app.evaluate(({ app }) => app.getPath('userData'))).toMatch(/\/pino-test-\d+-/) })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/e2e.test.ts && pnpm test:e2e`
Expected: FAIL, harness missing.

- [ ] **Step 3: Copy and adapt the config, `terminal.ts` and the rule; write `launch.ts` and `boot.spec.ts`**

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm test:e2e`
Expected: PASS, and no window appears on the desktop.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add the hidden-window e2e harness"
```

---

### Task 10: Design tokens, fonts, contrast and style tests

**Files:**
- Copy adapted:
  - `app/src/renderer/styles/tokens.css`: the accent, dye, diff-added and mark values of Global Constraints. Drop the CAD and terminal groups: `--scan-plain`, `--deviation-*`, `--drawing-ink`, `--part-*`, `--part-reference`, `--set-*`, `--layer-*`, `--ansi-*`, `--term-*`, `--band`, `--band-edge`. The comments say solder mask where they said layout blue.
  - `app/src/renderer/styles/app.css`: the list of pino's sheets, in torno's cascade order: `layout, titlebar, session, chat, chat-prompt, chat-slip, chat-foot, controls, status, card, plate, welcome`, then pino's `route, views`.
  - `app/src/renderer/styles/titlebar.css`: drop the macOS traffic-light rules.
  - `app/src/shared/fonts.ts`: comment only.
  - `app/src/shared/fonts.test.ts`: the allowed set is `shared/fonts.ts` and `renderer/styles/tokens.css`; drop the IBM Plex case.
  - `app/src/shared/contrast.test.ts`, as below.
  - `app/src/renderer/styles/styles.test.ts`, as below.
  - `.claude/rules/styles-themes.md`
- Copy as-is: `app/src/shared/contrast.ts`, `styles/layout.css`, `session.css`, `chat.css`, `chat-prompt.css`, `chat-slip.css`, `chat-foot.css`, `controls.css`, `status.css`, `card.css`, `plate.css`, `welcome.css`
- Create: `app/src/renderer/styles/route.css`, `app/src/renderer/styles/views.css` (empty headers for Task 12)
- Modify: `app/src/renderer/main.tsx`, `shared-from-torno.json`, `CLAUDE.md`

`contrast.test.ts` adapted:
- Keep every per-theme ratio test of the kept tokens, with torno's thresholds unchanged: text on raise and washes; on-accent, on-dye, scribe, on-mark; the hatch; route and hairline; dye equal to the accent in light; ink, muted and accent on the grounds; verdicts; marks apart from verdicts; the accent wash; scroll thumb; field edge; axes; dark warn `#CBAA6A`; marks and verdicts on the ground.
- Drop the cases for dropped tokens: part casing, drawing ink, terminal selection, sets, layers, and the ansi loop inside "reads wherever a colour is text".
- One hue line changes in "reads an edit as a diff": the added wash stays the accent wash, and it is held 60 degrees from `--user-mark`, `--agent-mark` and `--fail` but not from `--ok`, since pino's accent is green.
- The cross-file test keeps only the `frame.ts` `SURFACE` line, the redesign values and the type sizes.

`styles.test.ts` adapted:
- Keep "app.css is the list", the rule reader, "animates nothing without end", "dims no text by opacity", "uses radii from the tokens", "has one shadow" and "says what it does for less motion".
- Drop the palette-shadow legacy, the card and dock sizes, and the macOS title bar cases.

- [ ] **Step 1: Copy the tests, adapt them as named, and add**

```ts
// contrast.test.ts
it('has pino\'s colours: solder-mask green, Claude Code\'s orange for Claude\'s marks, a placeholder violet for the person\'s', () => {
  expect([light['--accent'], light['--dye'], light['--agent-mark'], light['--user-mark']]).toEqual(['#17663A', '#17663A', '#C0502B', '#865AD3'])
  expect([night['--accent'], night['--dye'], night['--agent-mark'], night['--user-mark']]).toEqual(['#5CC489', '#123D25', '#D97757', '#A173EF'])
})
// styles.test.ts
it('reads only custom properties that tokens.css or the sheet itself defines', () => { expect(undefinedVars()).toEqual([]) })
it('has no blue of torno\'s accent left in a sheet', () => { expect(sheetsMatching(/#1D46B8|#7C9BF7/i)).toEqual([]) })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/shared src/renderer/styles`
Expected: FAIL, sheets missing.

- [ ] **Step 3: Copy the sheets and modules, adapt as named, list them in the manifest**

If a copied sheet reads a dropped token, delete those rules from it and mark it adapted.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm -C app build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Copy torno's design tokens and sheets with a solder-mask green accent"
```

---

### Task 11: First screen and title bar

**Files:**
- Copy adapted:
  - `app/src/renderer/ui/Welcome.tsx`: drop `Readiness` and the example; one way in, "Open folder"; the recent list (`RecentFolder`, a missing one shown as missing and not clickable); the error line through `openProblem`.
  - `ui/plate/Plate.tsx`: children on the dye with no drawing.
  - `ui/Logo.tsx`: the placeholder wordmark `<span className="logo-word">pino</span>`, with a comment that the mark comes from the mocks.
  - `ui/TitleBar.tsx`: logo, project crumb with `FolderMenu`, `WindowControls`; drop session signs, the page key and the dock toggle.
  - `ui/WindowControls.tsx`: `window.pino.window`, always drawn.
  - `ui/FolderMenu.tsx`: `RecentFolder` from `shared/project`; items: the recent projects, "Open folder…", "Close project".
  - `.claude/rules/first-screen.md`
- Copy as-is: `ui/Chevron.tsx`, `ui/useMenu.ts`
- Create: `app/src/renderer/state/store.ts`, `app/e2e/welcome.spec.ts`, `app/e2e/themes.spec.ts`
- Modify: `app/src/renderer/App.tsx`, `shared-from-torno.json`, `CLAUDE.md`

**Interfaces:**
- Consumes: `PinoBridge` (Task 8), tokens and sheets (Task 10).
- Produces:

```ts
// state/store.ts (zustand vanilla store plus a hook, as torno's)
export type ViewTab = 'schematic' | 'board' | '3d'
export interface PinoState { page: 'first' | 'project'; project: ProjectInfo | null; recent: RecentFolder[]; tab: ViewTab; notice: string | null; problem: string | null }
export const store: StoreApi<PinoState>
export const actions: { openProject(p: ProjectInfo): void; closeProject(): void; setRecent(r: RecentFolder[]): void; setTab(t: ViewTab): void; notice(text: string | null): void; problem(text: string | null): void }
export function useStore<T>(pick: (s: PinoState) => T): T
// window.__pinoTest (PINO_TEST only): { state(): PinoState }
```

- [ ] **Step 1: Write the failing specs**

```ts
// welcome.spec.ts
test('with no project, the window is the first screen on the green dye, with the name and Open folder', async () => {
  await expect(page.locator('[data-region="viewport"] .plate')).toBeVisible()
  await expect(page.locator('.logo-word')).toHaveText('pino')
  await expect(page.locator('.welcome-ways').getByRole('button')).toHaveText(['Open folder'])
})
test('Open folder asks the dialog\'s stand-in and opens the project it answers', ...)   // __pinoMain.pickFolder = dir; picks becomes 1; state().page === 'project'
test('a project opened is listed next time, and a missing one is shown as missing', ...) // relaunch with the same PINO_CONFIG
test('a folder that cannot be opened is said under the ways in, and the first screen stays', ...)
// themes.spec.ts
test('the accent is solder-mask green in light and in dark', async () => {
  await page.emulateMedia({ colorScheme: 'light' }); expect(await token('--accent')).toBe('#17663A')
  await page.emulateMedia({ colorScheme: 'dark' }); expect(await token('--accent')).toBe('#5CC489')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:e2e`
Expected: FAIL, no first screen.

- [ ] **Step 3: Copy and adapt the components and the rule; write `store.ts`; make `App.tsx` show the first screen or the project page**

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add the first screen and title bar in torno's language, with pino's placeholder wordmark"
```

---

### Task 12: The project grid: route card, view tabs, status line

**Files:**
- Copy adapted: `app/src/shared/keys.ts`. Keep the mechanics (`KeyPress`, `pressOf`, `keyName`, `domKey`, `which`, `pressed`, `hint`, `typed`, `keyClashes`, `cheatSheet`). Keep only the scopes `global`, `window`, `composer`, `ask`, `field`, `menu`, `sheet`, and only the rows pino uses (this task adds `view.prev` and `view.next` for Left and Right on a focused tab; Task 13 adds the chat rows). Drop the tool, view, gizmo and scan tables.
- Copy adapted: `app/src/shared/keys.test.ts` (the clash and key-name cases)
- Create: `app/src/renderer/ui/RouteCard.tsx`, `ui/ViewPane.tsx`, `ui/StatusLine.tsx`, `ui/SessionDock.tsx` (frame only: the header row and an empty body for Task 14)
- Modify: `App.tsx`, `styles/route.css`, `styles/views.css`, `app/e2e/boot.spec.ts`, `shared-from-torno.json`

**Interfaces:**
- Consumes: `store`, `actions` (Task 11); the shell grid of `layout.css`.
- Produces: regions `data-region="title" | "left" | "viewport" | "session" | "status"`. The tablist is `role="tablist"` labelled "Views", with tabs "Schematic", "Board" and "3D" (`aria-selected`) and one `role="tabpanel"` at a time. `SessionDock({ project }: { project: ProjectInfo })` is filled in Task 14.

Copy, exact:
- Route card: the project name as the heading, then a "Brief" section with "No brief yet." and, muted, "Tell Claude what the board is for. It keeps the brief in brief.md."
- Each view tab's empty panel sits on the dye: "Nothing to draw yet." and "Claude writes board.py. pino draws the schematic, the board and the 3D view here on every save."
- Status line: the project folder name in `num`, then "No build yet", then the session's status word at the right (`Idle`, `Working`, `Needs you`, `Starting`, `Ended`, or `No session`).

- [ ] **Step 1: Write the failing specs and tests**

```ts
// boot.spec.ts
test('with a project, the window is the grid: title, route card with an empty Brief, three views, the dock and the status line', async () => {
  for (const r of ['title', 'left', 'viewport', 'session', 'status']) await expect(page.locator(`[data-region="${r}"]`)).toBeVisible()
  await expect(page.locator('[data-region="left"]')).toContainText('No brief yet.')
  await expect(page.getByRole('tablist', { name: 'Views' }).getByRole('tab')).toHaveText(['Schematic', 'Board', '3D'])
  await expect(page.locator('[data-region="status"]')).toContainText('No build yet')
})
test('a view is chosen with a click and with the arrow keys, and only its panel is shown', ...)
test('Close project goes back to the first screen', ...)
// keys.test.ts
it('has no two rows on one key in one scope', () => { expect(keyClashes()).toEqual([]) })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/shared/keys.test.ts && pnpm test:e2e`
Expected: FAIL.

- [ ] **Step 3: Copy and adapt `keys.ts`; write the four components and their sheets**

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm test:e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Add the project grid: route card with an empty Brief, three empty views, status line"
```

---

### Task 13: Chat pieces

**Files:**
- Copy as-is: `app/src/renderer/ui/Popover.tsx`, `ui/popoverPlace.ts`, `ui/popoverPlace.test.ts`, `ui/numbered.tsx`, `ui/numbered.test.ts`, `ui/typing.ts`, and in `ui/chat/`: `Diff.tsx`, `Diff.test.ts`, `lineDiff.ts`, `lineDiff.test.ts`, `fold.ts`, `fold.test.ts`, `taskList.ts`, `taskList.test.ts`, `Tasks.tsx`, `ask.ts`, `ask.test.ts`, `place.ts`, `typing.ts`, `typing.test.ts`, `ago.ts`, `ago.test.ts`, `modelWords.ts`, `AskTakeover.tsx`
- Copy adapted:
  - `app/src/renderer/state/chat.ts`: drop `prepareImage`, `noteTool` and `referenceUrl`; `window.pino`.
  - `state/chat.test.ts`: to match.
  - `ui/chat/markdown.tsx`: no `RefChip` or sets; a ref is plain text until marks.
  - `ui/chat/markdown.test.ts`: drop the chip cases.
  - `ui/chat/ToolCard.tsx`: no point-again, see-in-view, sets, `RefChip`, `RefText` or `Pictures`; a result is text, an edit is a `Diff`.
  - `ui/chat/toolcard.test.ts`: to match.
  - `ui/chat/AskCard.tsx`: `TOOL_PREFIX`; `window.pino`.
  - `ui/chat/ModelMenu.tsx`, `EffortMenu.tsx`, `ModeMenu.tsx`: `window.pino`.
  - `app/src/shared/keys.ts`: add the rows `chat.send`, `chat.newline`, `chat.stop`, `chat.complete`, `chat.allow`, `field.keep`, `field.leave`, `sheet.close`, as torno's.
- Modify: `shared-from-torno.json`

**Interfaces:**
- Consumes: `ChatItem` and friends (Task 6), `PinoBridge.chat` (Task 8), `pressed`, `which`, `hint` (Task 12).
- Produces: `chatStore`, `useChat(sessionId)`, `chatActions`, `connectChat(): () => void`, `Markdown`, `ToolCard`, `AskCard`, `AskSession`, `ModelButton`, `Popover`, `foldRuns`, `TasksCard`, with torno's props minus the dropped ones.

- [ ] **Step 1: Copy the tests (as-is and adapted)**

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/renderer`
Expected: FAIL, modules missing.

- [ ] **Step 3: Copy the modules and adapt as named**

As-is files must pass unchanged. One that needs an edit becomes adapted, with the reason in `change`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm -C app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Copy torno's chat pieces: store, markdown, diffs, tool and ask cards, model menus"
```

---

### Task 14: The session dock, end to end

**Files:**
- Copy adapted:
  - `app/src/renderer/ui/chat/ChatPane.tsx`: drop the builds strip, in-sight, Prompts only, earlier conversations, history join and offers; keep the item list, ask cards, the composer and scrolling.
  - `ui/chat/Items.tsx`: drop `BuildLine`, `DrawnOverLine`, board lines, `Pictures`, set tags, `RefChip`, history join, `SaveLine`, `PromptHead`, `headKind`, `turnSummary`, `TurnEnd` and struck prompts; keep user, assistant, thinking, tool, ask, notice and task items.
  - `ui/chat/Composer.tsx`: keep the text box, Enter to send, Shift+Enter for a newline, Esc to stop, the queued state and interrupt; drop board, drawing, review, set tags, onboarding, dimensions, suggestions, waiting notes, ref chips and slash completion.
  - `ui/chat/StartChat.tsx`: "New session", and "Resume" with the last conversation when `resumable`.
  - `ui/QuestionCard.tsx`: the trust question.
  - `app/e2e/helpers.ts`: keep only `fromMore`, `newSession`, `inModelMenu`, `closeModelMenu`, `moreItems`.
  - `.claude/rules/chat-pane.md`
- Modify: `ui/SessionDock.tsx` (header with name, status word `role="status"`, `ModelButton`, More menu with "New session" and "Stop"; body `StartChat` or `ChatPane`; a refusal shown in the dock, the trust question as `QuestionCard`), `App.tsx` (notices from `window.pino.notices`), `shared-from-torno.json`, `CLAUDE.md`
- Create: `app/e2e/chat.spec.ts`, `app/e2e/mcp.spec.ts`

**Interfaces:**
- Consumes: Task 7 `Sessions` through the bridge, Task 13 pieces, `launch`, `tempProject`, `agentsIn` (Task 9).
- Produces: the dock selectors the specs use: `[data-region="session"]`, `.chat`, `[data-chat-composer]`, `.chat-turn`, `.session-status`.

Copy, exact: the trust question reads "This folder has Claude Code settings of its own" with the files listed in `num`, and the buttons "Trust and start" and "Not now". Not found: the refusal text from Task 7. A notice from `onNotOwn` is shown once in the status line.

- [ ] **Step 1: Write the failing specs**

```ts
// chat.spec.ts (launch({ project, agent: true }))
test('a new session is a chat in the dock: a prompt is answered and the status goes Working then Idle', ...)   // say('say hello')
test('Claude calls pino\'s one tool through the real MCP server, and its card shows the answer', ...)          // say('tool mcp__pino__project {}')
test('a permission is asked in the dock and answered there', ...)                                             // 'ask Write {...}': Allow writes, Deny does not
test('Stop ends a long turn, and the session takes the next prompt', ...)                                    // 'slow 20', Esc
test('a folder with Claude Code settings of its own asks before the first chat', ...)                         // .claude/settings.json in the project
test('Claude Code missing from PATH is said in the dock, and the window keeps working', ...)                 // env PINO_AGENT_CMD=/nonexistent/claude
test('a .pino that is a link: nothing is written through it, the window says so once, the chat still runs', ...)
test('nothing is written in the project outside .pino', ...)                                                // tree before and after a turn
test('closing the window ends the session: no stand-in is left running in the folder', async () => {
  await app.close(); await expect.poll(() => agentsIn(realProject), { timeout: 10_000 }).toEqual([])
})
// mcp.spec.ts
test('the MCP address answers 404 without the token, 403 to a request from a web page, and lists project with it', ...) // __pinoMain.mcpFor(id); Origin header gives 403
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test:e2e`
Expected: FAIL.

- [ ] **Step 3: Copy and adapt the components, helpers and rule; fill `SessionDock`**

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && pnpm test:e2e`
Expected: PASS. Afterwards, `pgrep -af fake-agent.mjs` lists nothing under the test temp folders.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Run a Claude Code chat in the session dock, end to end against the stand-in"
```

---

### Task 15: Launcher and desktop entry

**Files:**
- Copy adapted:
  - `scripts/pino` (from `scripts/torno`). Set `app_name=pino` once near the top, and use it for messages, the log folder and the entry name. The variables are `PINO_OZONE`, `PINO_NOTIFY`, `PINO_PROJECT` (the one argument, a folder) and `PINO_TEST`. Drop `darwin` and every macOS branch. The required tools are `node` and `pnpm` (no `uv` until the kernel). The source hash covers `app/src app/package.json app/electron.vite.config.ts app/tsconfig.json pnpm-lock.yaml`, without `app/scripts` and without `out/viewer/viewer.js`. Usage words say folder or project, not workspace.
  - `scripts/pino.desktop.in`: `Name=pino`, `GenericName=PCB workbench`, `Comment=Design printed circuit boards with Claude Code`, `Categories=Development;Electronics;Engineering;`, `StartupWMClass=pino`.
  - `app/src/launcher.test.ts`: keep print-command, refusing headless, print-desktop escaping, usage, folder with command, desktop errors as notice or log, rebuild on content not time, the stamp with sha256sum or shasum, and no stamp of a failed build. Drop the darwin skips, the four icon-drawing cases and `pngRead`. The viewer case becomes "builds again when the build's config changes". The fake repository loses `build-viewer.mjs`, `out/viewer` and `bin/uv`.
  - `.claude/rules/launcher-and-packaging.md`: Linux only, no packaging yet.
- Create: `scripts/pino.svg` (placeholder icon: a 64 by 64 tile with `rx` 14, filled `#17663A`, with a centred `#F1F8F3` ring of r 12 and stroke 6, like a pad; a comment marks it a placeholder until the mocks)
- Modify: `app/src/main/index.ts` (window `icon` is `scripts/pino.svg` resolved from the app folder, only when it exists), `shared-from-torno.json`, `CLAUDE.md`

**Interfaces:**
- Consumes: the built app, `PINO_PROJECT` (Task 8).
- Produces: `scripts/pino [folder]`, `--print-command`, `--print-desktop`, `--install-desktop`, `--uninstall-desktop`.

- [ ] **Step 1: Copy and adapt the test, and add**

```ts
it('names the app as shared/app.ts does', () => { expect(readFileSync(script, 'utf8')).toMatch(new RegExp(`^app_name=${APP.name}$`, 'm')) })
it('passes a folder with spaces, unicode or a leading dash to the app as PINO_PROJECT', () => {
  for (const n of ['my board', 'placa-ção', '-dash']) expect(run(['--print-command', '--', dir(n)]).stdout).toContain(`PINO_PROJECT=${real(n)}`)
})
it('has no macOS branch', () => { expect(readFileSync(script, 'utf8')).not.toMatch(/Darwin|darwin|macOS/) })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C app exec vitest run src/launcher.test.ts`
Expected: FAIL, the script is missing.

- [ ] **Step 3: Copy and adapt the script, entry and rule; draw the placeholder icon**

`run()` keeps torno's temp `HOME` and `XDG_DATA_HOME`. No test runs the launcher against the person's home or starts the real app.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm test && sh scripts/pino --print-command /tmp`
Expected: PASS; the printed command starts with `PINO_PROJECT=/tmp` and nothing is started.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Copy torno's launcher as scripts/pino, Linux only, with a placeholder icon"
```

---

### Task 16: CI, README and the closing checks

**Files:**
- Copy adapted: `.github/workflows/ci.yml`
  - Job `changes`: torno's, with the non-code list `docs/*|LICENSE|NOTICE|*.md` at the root (`CLAUDE.md` and `.claude/**` count as code).
  - Job `app`, "App (unit, typecheck, guard)": `pnpm install --frozen-lockfile`, `pnpm -C app typecheck`, `pnpm test`, `bash .claude/hooks/guard-bash.test.sh`.
  - Job `e2e`, one job with no shards: xvfb, `pnpm -C app build`, then `xvfb-run -a -s '-screen 0 1920x1080x24' pnpm -C app exec playwright test` with `PINO_TEST: '1'`. Results are uploaded on failure as `pino-e2e-results`.
  - Drop the `kernel`, `integration` and `linux-package` jobs, uv and software GL. Node 22 via `actions/setup-node@v4`, pnpm via `pnpm/action-setup@v4`, as torno's.
- Modify: `README.md`, `CLAUDE.md`, `shared-from-torno.json`
- Test: `app/src/ci.test.ts`

**Interfaces:**
- Consumes: every suite above.
- Produces: green CI on the branch; the finished README.

- [ ] **Step 1: Write the failing test**

```ts
it('runs the unit tests, the typecheck, the guard cases and the e2e suite, and no kernel job yet', () => {
  expect(jobs).toEqual(['changes', 'app', 'e2e'])
  expect(yml).toContain('pnpm -C app typecheck'); expect(yml).toContain('bash .claude/hooks/guard-bash.test.sh'); expect(yml).toContain("PINO_TEST: '1'")
  expect(yml).not.toMatch(/claude(\s|$)|uv sync|ozone/)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C app exec vitest run src/ci.test.ts`
Expected: FAIL.

- [ ] **Step 3: Copy and adapt the workflow; finish the README**

The README says what pino is in two plain sentences, that stage 2 is the shell with no engine, the requirements (Linux, Node 22.12+, pnpm, Claude Code signed in), how to run (`scripts/pino [folder]`, `--install-desktop`), the tests, that parts come from torno (`shared-from-torno.json`, `scripts/torno-sync`), and the license (Apache-2.0, see NOTICE). Run the humanizer skill on it.

- [ ] **Step 4: Run every suite and the drift report**

Run: `pnpm -C app typecheck && pnpm test && pnpm test:e2e && bash .claude/hooks/guard-bash.test.sh && node scripts/torno-sync`
Expected: all PASS. torno-sync exits 0, or exits 1 listing only `torno-changed` lines if torno moved since the plan (report them; do not port them in this stage).

- [ ] **Step 5: Leak audit before anything leaves the machine**

Run, and read every hit:

```bash
git grep -nE "/home/|/Users/|@gmail|192\.168\.|10\.[0-9]+\.[0-9]+\.|BEGIN (RSA|OPENSSH)|token=" $(git rev-list main..HEAD)
```

Then search the same commits for the user name, the machine names and the e-mail kept in Luis's knowledge base. Do not write them into this repo. Expected: no personal path, host, address or secret.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Add CI for unit, typecheck, guard and e2e; finish the README"
```

---

## Self-review

- **Spec coverage.**
  - 4.2 A (copy, manifest, sync): Tasks 1, 2 and every copy step.
  - 5.9 (torno's language, green accent held to the contrast tests, dye on the first screen and empty states): Tasks 10, 11, 12.
  - 5.10 (mirrored `app/src` layout; the HTTP server and tokens; the MCP mount; launch and stream; the write guard; tokens and fonts; contrast and style tests; launcher and `.desktop`; the fake agent and e2e helpers; the guard hook; CI minus the kernel): Tasks 2 to 10, 15, 16.
  - Section 3 invariants (writes only in `.pino`, token only in the environment, no real `claude`, no visible window): Global Constraints, Tasks 4, 5, 7, 9, 14.
  - Cost ceilings from section 2: Task 3.
  - Left for later stages on purpose: the Brief page and fab limits, onboarding, picker, key sheet, build history strip, readiness checks, the terminal view, the second door (`door.ts`), skills (`--plugin-dir`), the reviewer subagent, packaging.
- **Seams cut.**
  - `manager.ts`: a `SessionDomain` interface with a stub.
  - `transcript.ts` and `shared/chat.ts`: the fields are deleted.
  - `tools.ts`, `bridge.ts`, `index.ts`, `ipc.ts`, `store.ts`, `App.tsx`, `SessionPane.tsx`: not copied; pino writes small ones.
  - Chat UI: the CAD imports are deleted, with ref chips back in stage 4.
  - `contrast.test.ts`: the CAD token groups are dropped with their tests.
- **Type names checked across tasks:** `ProjectInfo`, `RecentFolder`, `StartResult`, `SessionDomain`, `NO_DOMAIN`, `ownFolder`, `isAppTool`, `TOOL_PREFIX`, `envName`, `PinoBridge`, `ViewTab`, `launch`, `tempProject`, `agentsIn`.
- **Open calls for Luis**, also in the final report:
  - The diff "added" wash keeps the accent wash and drops one hue check against `--ok`, since green accent and green verdict now share a hue.
  - The person's mark is a placeholder violet.
  - Stage 2 has no terminal view.
