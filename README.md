<p align="center">
  <img src="scripts/pino.svg" alt="The pino logo: a chip seen from above, with pin 1 in green" width="96" height="96">
</p>

<h1 align="center">pino</h1>

<p align="center">
  A desktop workbench for making circuit boards with an AI coding agent.<br>
  You point at the board. The agent writes the board in Python. pino builds it every time you save.
</p>

<p align="center">
  <a href="https://github.com/luisg0nc/pino/actions/workflows/ci.yml"><img src="https://github.com/luisg0nc/pino/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/luisg0nc/pino/actions/workflows/kernel.yml"><img src="https://github.com/luisg0nc/pino/actions/workflows/kernel.yml/badge.svg" alt="Kernel"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0 licence"></a>
</p>

<p align="center">
  <a href="https://pino.luisg.me/">pino.luisg.me</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="kernel/README.md">The engine</a> ·
  <a href="#contributing">Contributing</a>
</p>

> [!NOTE]
> pino is new and early. It is developed on Linux (Arch, Wayland), 100% using Claude Code, and runs on Linux only.
> Expect rough edges, and please [open an issue](https://github.com/luisg0nc/pino/issues) when you find one. Before
> you order a board, check every part in JLC's placement preview.

## Why pino

Coding agents can write a circuit board as code. Two things get in the way. The agent can't see the board it made,
and it's hard for you to tell it *which* track is wrong, or where a part should go. Pointing at a board is easy in
real life and slow to put into words.

pino fixes both. It runs [Claude Code](https://docs.anthropic.com/en/docs/claude-code) next to a live view of the
board, its schematic and a 3D model. You point at a part, draw an arrow to where it should go or sketch the way a
track should run, and the agent gets exactly what you pointed at: the part's reference, the pad, the net, your note.
The agent also gets tools to look at the board, measure it, read the checks and route it, so it can check its own
work before it hands it back.

pino is not a PCB editor. You don't place parts or draw tracks by hand. The board is a Python file, `board.py`, and
pino builds it into a KiCad 10 project and shows it. pino is a sibling of
[torno](https://github.com/luisg0nc/torno), the same kind of workbench for CAD parts, and shares much of its code.

## Features

- **Live builds.** Every save of `board.py` builds the schematic and the board as a KiCad 10 project and runs KiCad's
  electrical and design rule checks and pino's own. The files are the same bytes every time for the same input.
- **Point, don't describe.** Point, draw an arrow (move this here), a stroke (route this way) or a region (keep this
  clear, or put these here), each with a note. The agent gets your marks with your next message as exact references,
  never as vague words.
- **Three views.** The Schematic is KiCad's sheet, redrawn. The Board shows the layers as a technical drawing, with
  net colours as a switch. 3D is a live model of the board, parts and all, or a bare board. A part you select stays
  selected across the three.
- **The agent sees what you see.** The agent gets MCP tools of its own: `look` (a picture of a view, marks
  included), `measure`, `check`, `nets`, `trace`, `ratsnest`, `diff` between builds, `parts`, `point` to mark the
  board back at you, and the routing tools.
- **Routing in the background.** [KiCadRoutingTools](https://github.com/drandyhaas/KiCadRoutingTools) routes the
  board while you work, then the design rule check runs again. What the router leaves, the agent finishes with
  `route_net`, `nudge` and `keep`.
- **Parts you can order.** Name a part by its LCSC number and pino looks it up on
  [jlcsearch](https://github.com/tscircuit/jlcsearch): stock, price, and whether JLC calls it basic or extended. An
  extended part says why in `board.py`.
- **Fab files.** `release` writes Gerbers, drill files, a BOM and a placement file in JLC's columns, with a README
  that says what to upload and what to check in JLC's preview. Each release is a version, `fab/v1.0.0/`.
- **Every build kept.** The builds strip at the top of the session has a picture of each build. Press one to see
  that build in the views.
- **Local.** pino itself uploads nothing. The only requests it makes are part lookups on jlcsearch, which carry pino's
  version and nothing about you. The agent is your own `claude`, under your own login, and pino leaves its settings
  alone. In your folders, pino writes only under `<project>/.pino/` and, when you release, `<project>/fab/`.

## What goes well, and what does not

pino is made for two and four layer boards of up to about a hundred parts, made at JLC. On the reference board, an
ESP32-C6 on USB-C power with 21 parts, the router routes all 14 nets and the design rule check comes back clean in
about 20 seconds. On a dense four layer board (Watchy, a 50-net watch) it routes 45 of 50 nets, and the agent has to
finish the rest.

It needs more from you for a board that must fit an enclosure you can only measure roughly, and for radio and
high-speed layout. pino routes a USB pair as a pair and keeps a module's antenna area clear, but it checks no
impedance. Whatever the board, give the agent part numbers, sizes from the datasheet and a mark on the board in place
of a description.

## How it works

A **project** is a folder with a `board.py` in it, next to an outline of the board:

```
blinky/
├── board.py
└── outline.json
```

`board.py` names the parts, wires them into nets, and says roughly where they go:

```python
from pino import Board

b = Board("blinky", layers=2, outline="outline.json")

mcu = b.block("mcu", "MCU")
u1 = mcu.path("U1", "RF_Module:ESP32-C6-MINI-1", lcsc="C5736265", why="the ESP32-C6 module, with 4 MB of flash")
c1 = mcu.shunt("C1", "Device:C", "100nF", footprint="Capacitor_SMD:C_0402_1005Metric", lcsc="C1525")
r1 = mcu.path("R1", "Device:R", "1k", footprint="Resistor_SMD:R_0402_1005Metric", lcsc="C11702")
d1 = mcu.shunt("D1", "Device:LED", "green", footprint="LED_SMD:LED_0603_1608Metric", lcsc="C72043",
               why="a green 0603 LED; there is no basic one")

b.supply("+3V3", u1["3V3"], c1[1], external=True)
b.net("LED", u1["IO8"], r1[1])
b.net("LED_A", r1[2], d1["A"])
b.gnd(u1["GND"], c1[2], d1["K"], external=True)
b.nc_rest(u1)

b.place(u1, edge="top", center=True)
b.zone("GND", layer="B.Cu")
```

Symbols, footprints and 3D models come from KiCad's own libraries. pino writes the KiCad files itself, so the same
`board.py` always gives the same files. Positions are in millimetres from the middle of the outline, with y up.

The app is Electron. The engine is a Python package (`kernel/`) that runs `board.py`, writes the KiCad project, runs
kicad-cli for the checks and the views, and routes in the background. Each project gets its own Claude Code session,
in the project's folder, connected to pino's MCP server on `127.0.0.1`. The [engine's README](kernel/README.md) has
the full rules: the build, routing, parts, fab files and design rules.

## Getting started

### Requirements

- Linux
- Node.js 22.12 or later, and pnpm 10
- [uv](https://docs.astral.sh/uv/), which runs the engine on Python 3.12 or later
- [KiCad 10](https://www.kicad.org/), with its symbol, footprint and 3D model libraries
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude`) on your `PATH`, logged in

pino checks all of this on its first screen and says what's missing. The first route installs the router into a
cache in your home folder, once.

### Install

```sh
git clone https://github.com/luisg0nc/pino.git
cd pino
pnpm install
```

### Run

```sh
scripts/pino ~/boards           # open a folder of boards
scripts/pino ~/boards/blinky    # open one board in it
scripts/pino                    # what you had open last, or the first screen
```

pino keeps your boards in one folder, each board in a subfolder of its own. On the first run it offers `~/boards`.

The launcher builds the app on the first run, which also downloads Electron, and builds again when the sources
change, so `git pull` and run it again. `scripts/pino --install-desktop` adds pino to your applications menu, and
`--uninstall-desktop` removes it.

If a folder brings Claude Code settings of its own, pino asks before the first chat there.

### Your first five minutes

Copy `kernel/tests/fixtures/reference/`, the reference board, into your folder of boards and open the copy. Click a part on the Board, then the same part on the
Schematic. Point at the LEDs and ask the agent to move them to the other edge. Watch it edit `board.py`, the build
that follows, and the routing. When the checks pass, press **Fab files…** in the status line to see what a release
would hold.

## Working with Claude Code in pino

A few habits that save time.

- **Point, don't describe.** Point at the part and write the note. The agent gets the reference and your words, not
  "the resistor near the top".
- **Give part numbers.** Name parts by their LCSC numbers, or ask the agent to find basic parts first. A part it
  guesses may be an extended part that costs more, or one JLC can't place.
- **Say where things go before the details.** The outline, the connectors on their edges, and the big parts first.
  The router does better on a board whose parts sit in sensible places.
- **Let the router go first.** Ask the agent to finish only what the router left, and draw a stroke for any track that
  has to run a certain way.
- **Release from a clean build.** pino refuses a release with failing checks or an unrouted net. Read the release's
  README, then check every part's position and rotation in JLC's preview before you pay.

## Documentation

- **[The engine](kernel/README.md)**: how to run it, the serve protocol, routing, parts, fab files, design rules
  and the build folder.
- **[The design](docs/superpowers/specs/2026-11-26-pino-design.md)**: why pino is built the way it is, and the
  [design picks](docs/superpowers/specs/2026-11-26-pino-design-picks.md) for its look.
- **[The roadmap](docs/superpowers/plans/2026-11-26-pino-roadmap.md)**: the stages and where each one stands.

## Contributing

Issues and pull requests are welcome. pino is young, so for anything bigger than a fix, please open an issue first
to talk it over. [CLAUDE.md](CLAUDE.md) covers where things are and the rules the code holds to, with the detail by
area in `.claude/rules/`.

The tests, from the repository root:

```sh
pnpm test                               # unit tests
pnpm test:e2e                           # builds the app and drives it in a hidden window
pnpm -C app typecheck
bash .claude/hooks/guard-bash.test.sh   # needs jq and perl
env -u DISPLAY -u WAYLAND_DISPLAY uv run --directory kernel pytest   # the engine
```

No test runs the real Claude Code or reaches the network. The app's tests use a stand-in agent and a stand-in
engine, and the engine's tests use recorded jlcsearch answers.

Much of the plumbing and the look comes from torno. `shared-from-torno.json` lists each copied file, the torno commit
it came from, and whether pino changed it. `node scripts/torno-sync` reports where the two have moved apart.

## License

Copyright 2026 the pino authors.

Licensed under the [Apache License, Version 2.0](LICENSE). The engine ports some code from
[pcb-kit](https://github.com/somebox/pcb-kit) and runs KiCadRoutingTools, both under the MIT licence; see
[NOTICE](NOTICE) and [kernel/NOTICE](kernel/NOTICE).
