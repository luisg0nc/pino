# Contributing to pino

Thanks for wanting to help. pino is new, so there's a lot to do, and an issue about something that confused you
is as useful as a pull request.

## Before you start

- **Bugs.** [Open an issue](https://github.com/luisg0nc/pino/issues/new/choose) with the bug form. It asks for
  your Linux desktop, the pino commit or release, what the first screen says pino needs, what you did and what
  happened, and a small `board.py` that shows the problem if you can share one.
- **Ideas and bigger changes.** Open an issue first, so we can agree on the shape of it before you spend time on
  code. pino is not a PCB editor: you don't place parts or draw tracks by hand. The board is the Python file, and
  changes that keep it that way fit best.
- **Linux only.** pino runs on Linux, and changes that add code for another system won't be merged.
- **Security.** Please don't open a public issue. [SECURITY.md](SECURITY.md) says how to report it privately and
  what pino's security model is. pino runs a local HTTP server for the agent's tools, guarded by a token for
  each session, so anything that gets around that matters.

## Behaving

Be kind and assume good faith. Criticise the code and the idea, never the person. That's the whole code of
conduct.

## Setting up

You need what the [README](README.md#requirements) lists: Linux, Node.js 22.12 or later, pnpm 10, uv, KiCad 10
with its libraries and, to try sessions by hand, Claude Code logged in.

```sh
git clone https://github.com/luisg0nc/pino.git
cd pino
pnpm install
pnpm dev                    # the app from the Vite dev server; F5 or Ctrl+R reloads the window
scripts/pino [folder]       # or build and run it as a user would
```

To try changes on a real board without touching your own, copy the reference board:
`mkdir -p /tmp/pino-dev && cp -r kernel/tests/fixtures/reference /tmp/pino-dev/ && scripts/pino /tmp/pino-dev`.

To check the packaging, `pnpm pack:check` builds the unpacked app and `pnpm dist:linux` the AppImage and the
`.tar.gz`, in `app/dist/`. `app/e2e/packaged.spec.ts` starts what they made; its header says how.

## Where things are

| Folder | What's in it |
|---|---|
| `app/src/main` | Electron's main process: the engine's client, the sessions, the HTTP server with the MCP tools and the hooks, builds, routing, marks |
| `app/src/renderer` | The UI (React): the Schematic, Board and 3D views and the tools that point at them |
| `app/src/shared` | Types and pure rules both sides use; `bridge.ts` is everything the window may ask of main |
| `app/e2e` | Playwright specs that drive the built app in a hidden window |
| `kernel/` | The engine, a Python package (uv): runs `board.py`, writes the KiCad project, runs the checks, routes and releases |
| `scripts/pino` | The launcher |
| `site/` | The landing page, pino.luisg.me |
| `docs/` | The [design](docs/superpowers/specs/2026-11-26-pino-design.md) and the plans it was built from |

**The root `CLAUDE.md` has the rules for all of pino, and `.claude/rules/` has the rules for each part of the
code**, one file per topic, each naming the files it covers in its `paths:` list. They're written for AI agents
(Claude Code loads a rule when it reads or edits one of those files), but they're the most complete description of
how pino is meant to behave, so read the root one and the rules for the files you're changing before you start. A
change that breaks one of their rules needs a good reason, and should change the rule too.

## The rules that matter most

The `CLAUDE.md` and the rules have the detail. These are the ones a change most often trips over:

- **pino never writes in a project folder** except under `<project>/.pino/`. The only exceptions are
  `fab/v<version>/` on a release and the one new folder that making a new project writes.
- **The same input gives the same files.** The engine writes the KiCad project byte for byte the same for the same
  `board.py`. At run time it uses the standard library only.
- **The HTTP server binds `127.0.0.1` only**, and every request needs the session's token. The token is never put
  in an argument, a file or a log.
- **UI text is English and in sentence case**, with no em dashes. Colours and spacing come from
  `app/src/renderer/styles/tokens.css`.
- **A file copied from torno** is listed in `shared-from-torno.json`. If you edit one listed `as-is`, mark it
  `adapted` in the same commit and say what changed.
- **pnpm, never npm**, and no new runtime dependency without a reason in the commit message.

## Tests

Run from the repository root:

```sh
pnpm test                               # app unit tests: app/src/**/*.test.ts (vitest)
pnpm test:e2e                           # builds the app, then drives it in a hidden window (Playwright)
pnpm -C app typecheck
bash .claude/hooks/guard-bash.test.sh   # the Bash guard's cases (needs jq and perl)
env -u DISPLAY -u WAYLAND_DISPLAY uv run --directory kernel pytest   # the engine
```

While you work, run just the test you're changing:

```sh
pnpm -C app exec vitest run src/manifest.test.ts
pnpm -C app exec playwright test e2e/chat.spec.ts      # after pnpm build
```

Run the first four before you open a pull request, and the engine's tests too if you changed `kernel/`. New
behaviour needs a test, and a bug fix needs a test that failed before it. A test of the engine or the app that
needs KiCad, uv or the router is skipped where it's missing.

Three things tests must never do:

- **Run a real `claude`.** It would spend your subscription and depend on your login and settings. Tests set
  `PINO_AGENT_CMD` to the stand-in, `node app/test/fake-agent.mjs`. Anything that needs the real CLI is checked
  by hand.
- **Reach the network.** Part lookups are answered from recorded jlcsearch answers. The one exception is the
  opt-in check of the packaged app, whose first run lets uv download what builds the engine.
- **Open a visible window.** Every launch of Electron sets `PINO_TEST=1`, which keeps the window hidden. Never
  pass `--ozone-platform=headless`, and never call `page.screenshot()`, which hangs on a hidden window.
  [`.claude/rules/e2e-hidden-window.md`](.claude/rules/e2e-hidden-window.md) says how to read state and pictures
  instead.

## Docs

- The [README](README.md) is the introduction, and [the engine's README](kernel/README.md) has the rules of the
  build, routing, parts and fab files.
- When a change alters what pino does, change the docs and the rule that says it in the same commit.

## Commits and pull requests

- Branch from `dev` and open the pull request against `dev`. `main` holds the last release; a release merges `dev`
  into it.
- One change per commit. The message is a sentence that says what changed, from the person's side when it's a
  behaviour: "Keep Marks within the column when the room shrinks", not "fix layout bug".
- Commits carry no `Co-Authored-By:` line and no "Generated with" line, whatever tool helped to write them.
- The pull request template asks what it changes and why, which tests you ran, what you checked by hand and, for a
  change to the window, a screenshot or a short recording. Tests can't take them, so take them yourself.

## Working with an AI agent

You're welcome to. pino is built that way, and the `CLAUDE.md` and the rules are there so an agent can follow the
rules. You're still responsible for what it writes: read the diff, run the tests, and check by hand what the tests
can't see.

## License

pino is licensed under the [Apache License, Version 2.0](LICENSE). By contributing, you agree that your
contributions are licensed under it too (section 5 of the license).
