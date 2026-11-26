# pino

pino is a Linux desktop workbench where Claude Code designs printed circuit boards from a Python file, while you
describe the board and point at what to change. It is a sibling of
[torno](https://github.com/luisg0nc/torno), the same kind of workbench for CAD parts. It is early work.

## What it does now

- Every time `board.py` is saved, pino's engine builds it and runs KiCad's checks and its own.
- Three views draw the build: the schematic, the board layer by layer, and a 3D model. Click a part, pad or net to
  get its exact reference.
- Mark what you mean on the board: point at something, draw an arrow to where it should go, sketch a route, or
  outline an area. Your marks go to Claude with your next message, as exact lines.
- Claude can look at the views, measure, read the checks and the nets, and point back at the board.
- Routing in the background is wired in the app, and needs an engine that routes. The engine here does not yet.

It does not look up parts or export fabrication files yet.

## Requirements

- Linux
- Node 22.12 or later, and pnpm
- [uv](https://docs.astral.sh/uv/), which runs the engine on Python 3.12 or later
- KiCad 10, with its symbol, footprint and 3D model libraries
- [Claude Code](https://claude.com/claude-code), signed in

## Run

```sh
scripts/pino [folder]
```

A project is one folder with a `board.py` in it. `kernel/tests/fixtures/reference/` holds one to try. pino installs its dependencies and builds itself on the first run, which also downloads
Electron, and builds again when its sources change. With no folder it opens the one you had open last.

To add pino to your applications menu:

```sh
scripts/pino --install-desktop    # --uninstall-desktop removes it
```

The chat runs Claude Code in the project's folder, with your own login and settings. pino itself writes only into
`.pino/` inside that folder. If a folder brings Claude Code settings of its own, pino asks before the first chat
there.

## Tests

```sh
pnpm install
pnpm test                               # unit tests
pnpm test:e2e                           # builds the app and drives it in a hidden window
pnpm -C app typecheck
bash .claude/hooks/guard-bash.test.sh   # needs jq and perl
uv run --directory kernel pytest        # the engine
```

No test runs the real Claude Code. They use a stand-in, `app/test/fake-agent.mjs`. The app's tests also use a
stand-in engine, `app/test/fake-kernel.mjs`; one end-to-end test runs the real one when uv and KiCad are there.

## Parts from torno

Much of the plumbing and the look comes from torno. `shared-from-torno.json` lists each copied file, the torno commit
it came from, and whether pino changed it. `node scripts/torno-sync` reports where the two have moved apart. It reads
a torno checkout next to pino, or the one in `PINO_TORNO_DIR`.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
