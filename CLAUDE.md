# pino

A Linux desktop workbench where Claude Code designs printed circuit boards from a Python board file, a sibling of
torno (the build123d CAD workbench). The design is `docs/superpowers/specs/2026-11-26-pino-design.md`; the build
stages are in `docs/superpowers/plans/`. Stage 2, the app shell, has no engine: nothing is built or drawn yet.

- `app/`: the Electron app (pnpm, TypeScript, electron-vite). `src/main` is the shell, the sessions, and the HTTP
  server with the MCP tool and the hooks. `src/renderer` is the UI (`ui/`), the store (`state/`) and the stylesheets
  (`styles/`). `src/shared` holds the types and the pure rules both sides use, so that each is one rule and neither
  side has a copy of its own; `shared/bridge.ts` is everything the renderer may ask of main. `test/fake-agent.mjs`
  is the stand-in for Claude Code, and `e2e/` the specs.
- `scripts/pino` is the launcher; `scripts/torno-sync` the drift report on the copied files.

## Tests

Run from the repository root.

```sh
pnpm test                               # unit tests: app/src/**/*.test.ts (vitest)
pnpm test:e2e                           # builds the app, then drives it in a hidden window: app/e2e/*.spec.ts
pnpm -C app typecheck
bash .claude/hooks/guard-bash.test.sh   # the Bash guard's cases
```

One file: `pnpm -C app exec vitest run <file>`, for example `src/manifest.test.ts`.

While iterating run the focused test; run all four before a commit.

## Global invariants

- Copy now, extract later. A copied torno file lives at the same relative path as in torno; where torno's own file
  name says torno, pino's says pino (`scripts/torno` is `scripts/pino`).
- Every copied file is listed in `shared-from-torno.json` as `as-is` or `adapted`. A later edit of an as-is file makes
  it adapted in the same commit.
- Copy the file from torno, then adapt it. Never retype torno code from memory.
- torno is only ever read: no install, no test run, no checkout and no git state change there.
- One app prefix, from `app/src/shared/app.ts` only: name `pino`, env `PINO_*`, header `X-Pino-Session`, folder
  `.pino`, config `~/.config/pino/config.json`, bridge `window.pino`, test hooks `window.__pinoTest` and
  `globalThis.__pinoMain`, MCP server `pino` (tools `mcp__pino__<tool>`). A file that cannot import it holds the name
  in one variable, and a test holds that equal to `APP.name`.
- Code says "project", never "object" (`app/src/names.test.ts`).
- Never write inside a project folder except under `<project>/.pino/`, through `ownFolder`. This stage has no
  exceptions.
- The HTTP server binds `127.0.0.1` only. Every request carries its session's token in `X-Pino-Session`. The token is
  only in the agent's environment (`PINO_SESSION`), never in an argument, a file or a log.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `backgroundThrottling: false`.
- Accent: solder-mask green. The colour values are in `app/src/renderer/styles/tokens.css` and are held by
  `app/src/shared/contrast.test.ts`.
- Type: Instrument Sans and Martian Mono from `@fontsource`, latin, bundled. Family names are written only in
  `shared/fonts.ts` and `renderer/styles/tokens.css`.
- The logo, the first screen's drawing and the icon are placeholders until the design mocks.
- Linux only. No macOS code paths.
- Tests never run the real `claude`: they set `PINO_AGENT_CMD` to the stand-in.
- Tests never open a visible window: every Electron launch sets `PINO_TEST=1` (hidden window, temp profile), never
  `--ozone-platform=headless`, never `page.screenshot()`, never the clipboard. Tests never steal focus, never touch
  the person's home, and kill only processes they started, by pid.
- English only. Sentence case UI text. No em dashes in docs or UI copy.
- pnpm, never npm. Node 22.12 or later. No new runtime dependency without a reason in the commit message.

## Never run a real agent CLI from tests

Tests set `PINO_AGENT_CMD` to the stand-in, `node app/test/fake-agent.mjs`. No test runs `claude`: it spends the
person's subscription and depends on their login and settings. A check against the real CLI is done by hand.
`.claude/settings.json` runs `.claude/hooks/guard-bash.sh` before every Bash command. It refuses the real `claude`
(`claude --version` aside), and `killall`, `pkill` of a bare program name or of a whole user, and `kill -1`.

## Copied from torno

`shared-from-torno.json` lists each copy: its pino path, its torno path, the torno commit, and `as-is`
(byte-identical to torno at that commit) or `adapted` (with one line saying what changed).
`node scripts/torno-sync` reports drift both ways and never writes into torno. It reads the checkout in
`PINO_TORNO_DIR`, else `torno` beside pino's main checkout. `app/src/tornoSync.test.ts` and
`app/src/manifest.test.ts` hold the rules.

## Commits

Plain messages that describe the change. No Co-Authored-By trailer and no "Generated with" footer
(`.claude/settings.json` turns attribution off).

## Rules by area

The detail is in `.claude/rules/*.md`. Claude Code loads a rule when a file its `paths:` names is read or edited;
read one by hand before work its globs miss. Paths in a rule are written from `app/` (`src/main/...`), or short under
`app/src/` (`main/`, `shared/`) and under `app/src/renderer/` (`ui/`, `state/`, `styles/`).
