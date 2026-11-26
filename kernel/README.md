# pino kernel

The engine behind pino. It runs a project's `board.py`, writes a KiCad 10 project from it (schematic, placed
board, rules), runs the fast checks and reports one build result as JSON. Routing runs apart, in the background,
on a finished build (see Routing).

Python 3.12 or later, standard library only at run time. Tests use pytest and jsonschema.

## Run it

```sh
uv run --directory kernel pino-kernel build <project folder>
uv run --directory kernel pino-kernel version
uv run --directory kernel pino-kernel serve
uv run --directory kernel pino-kernel route <project folder>
uv run --directory kernel pino-kernel router status
```

`build` prints the result on stdout and exits 0 when the verdict is `ok`, 1 for `errors` and 2 for `failed`.
Options: `--timeout S` (how long board.py may run, 30 s by default), `--render` (also a top render of the board),
`--no-kicad` (skip every kicad-cli step) and `--no-cache` (build again even when this input was built before).

`version` prints `{"kernel", "schema", "kicad_cli", "libraries"}`.

## Serve protocol

`serve` reads one JSON request per line on stdin and writes one JSON object per line on stdout, flushed. Logs go
to stderr.

```json
{"id": 1, "op": "ping"}
{"id": 2, "op": "build", "project": "/path/to/project", "options": {"timeout": 30, "render": false, "kicad": true, "cache": true}}
{"id": 3, "op": "route", "project": "/path/to/project", "options": {"build": null, "timeout": 900, "step_timeout": 300, "install": true, "cache": true}}
{"id": 4, "op": "route_status", "project": "/path/to/project"}
{"id": 5, "op": "route_cancel", "job": 3}
{"id": 6, "op": "shutdown"}
```

Ordered ops are answered in request order: `ping` gives `{"id": 1, "ok": true, "pong": {"kernel": "0.2.0",
"schema": "pino.build/1", "serve": 2, "route_schema": "pino.route/1"}}`, `build` gives `{"id": 2, "ok": true,
"result": {...}}`, `route_status` gives `{"id": 4, "ok": true, "status": {...}}` (the `routing` field of the latest
build) and `shutdown` gives `{"id": 6, "ok": true}`.

A job op (`route`) runs in its own child process and does not hold up the ordered ops. Its progress comes back as
`{"id": 3, "event": {...}}` lines and its end as one `{"id": 3, "ok": true, "result": {...}}`. `route_cancel` is
answered at once, out of order, with `{"id": 5, "ok": true, "cancelled": true}` (`false` when no such job runs).
`shutdown` and the end of input cancel running jobs and wait up to 10 s for them.

A line that is not JSON, or an unknown op, gets `{"id": <id or null>, "ok": false, "error": "..."}` and the loop
goes on. Each build still runs board.py in a fresh child process.

## Routing

pino routes with KiCadRoutingTools (MIT), pinned to tag v0.17.7 (commit `bc48cce8ac60`). pino does not ship it.
The first route fetches it into the user cache, `<cache>/krt/bc48cce8ac60/`, where `<cache>` is `PINO_CACHE_DIR`,
else `$XDG_CACHE_HOME/pino`, else `~/.cache/pino`. That folder gets its own Python 3.12 venv (numpy, scipy,
shapely) and the release's prebuilt router core, checked against a pinned sha256. Nothing is built from source.
`pino-kernel router install` does the same step on its own, and `pino-kernel router status` reports what is there.
`PINO_KRT_DIR` and `PINO_KRT_PYTHON` point pino at a checkout you made yourself. Any other version is refused.

`pino-kernel route <project>` routes the latest build. The chain runs one router script per step, each in its own
process group with no display:

1. planes (fill-zone nets, on boards of 4 or more layers; on 2 layers the zone net is routed as tracks)
2. fanout of each four-sided fine-pitch part (QFN, DFN, QFP)
3. each `diff_pair` (a pair the router cannot couple goes on to the next step single-ended)
4. every other net with two or more pads
5. plane repair
6. the `route_hint` lines of `board.py`, in order

pino passes the board's own floors as the router's fab overrides, never lets the router rewrite the rules, and
runs DRC with its own `board.kicad_pro` and `board.kicad_dru`. The router does not keep a hole clearance larger
than its copper clearance, so pino grows its vias until their holes keep it. It also puts router keep-outs round
unplated holes and round copper a footprint draws with no net (an antenna, say). The grid is 0.05 mm when a part
has pads 0.5 mm apart or closer, else 0.1 mm.

After the chain, pino takes only the copper back into its own board, gives it UUIDs hashed from its geometry,
refills the zones, removes stubs, duplicates and dead ends, and runs DRC with schematic parity. Then come its own
checks: floating copper, stubs, loops, pours that reach one pad, tracks thinner than their class, and pairs off
their gap or not coupled. The route lands in `.pino/routes/<key>/` (`board.kicad_pcb`, `filled/`, `copper.json`,
`drc.json`, `plan.json`, `key.json`, `route.json`, `log.txt`). The key is a hash of what the copper depends on:
nets by pad, placement, footprints, outline, zones, kept copper, rules, routing instructions, and the router and
kernel versions. A value change keeps the key; moving a part does not. The fast build reports routing as `none`,
`running`, `current` or `stale` (with the reasons), and stale copper is never reused. One route runs per project.
Routes are cached by key, can be cancelled (SIGTERM, or `route_cancel` in serve) and stop after 300 s per step and
900 s in all.

Claude finishes a route with three trial tools. Each works in `.pino/trials/<n>/` and returns `board.py` lines; pino
never edits `board.py` itself.

- `route-net`: one net again, in a region, on given layers, along a corridor, moving the nets in `rip`. Returns a
  `route_hint` line that replays what it found.
- `nudge`: a part moved or turned, with its courtyard and fit checks and the ratsnest score. With `--route` it also
  routes the whole board. Returns a `place` line and the line it replaces.
- `keep`: a net's routed copper as `keep_route` lines, by pins, with `via(x, y, to=layer)` steps. The board writer
  then writes that copper locked, and the router leaves it alone.

In serve these are `route_net` and `nudge` with `route` (job ops, streamed), and `keep` and `nudge` (ordered).

Measured on this machine (KiCad 10.0.6, a 64-core desktop):

- Reference board (2 layers, 22 parts): the router routes 14 of 14 nets in about 20 s, DRC clean, with nothing to
  finish. GND as a B.Cu plane also gives 14 of 14, in 32 s, so tracks stay the default on 2 layers. The USB pair
  ends up single-ended (a `pair_uncoupled` warning).
- Watchy (4 layers, 86 parts, MIT, fetched by the tests): the router routes 45 of 50 nets (0.90) in about 52 s.
  5 nets are left near the QFN and the accelerometer, and 7 DRC errors are new. 4 of those come from the antenna
  footprint, whose two pads sit inside its own no-net copper, and the hand-routed original has them too. The strict
  pass mark is not met on this board, and its test is marked as an expected failure with these numbers.

## Libraries and kicad-cli

The engine reads KiCad's symbol, footprint and 3D model libraries itself. For each kind it takes
`PINO_KICAD_SYMBOL_DIR`, `PINO_KICAD_FOOTPRINT_DIR` or `PINO_KICAD_3DMODEL_DIR` when set (a wrong one is reported,
not replaced), else `KICAD10_*_DIR`, else the first of `/usr/share/kicad`, `/usr/local/share/kicad` and Flatpak's
`org.kicad.KiCad.Library` extension (system wide, then per user). A missing 3D model folder is allowed; every model
then counts as missing.

kicad-cli is `PINO_KICAD_CLI` when set (it may hold arguments, such as a `flatpak run` line), else `kicad-cli` on
`PATH`. Every call runs without `DISPLAY` or `WAYLAND_DISPLAY`, with KiCad's config and cache in
`<project>/.pino/kicad/`, and with the library paths passed in, so it never opens a window or touches the user's
KiCad settings. Without kicad-cli the build still runs and says which checks it skipped.

## The build folder

Everything goes under `<project>/.pino/`. The engine never edits `board.py`, `outline.json` or anything else in the
project.

```
.pino/builds.json             build history: number, hash, verdict, time (newest 100)
.pino/build/<hash>/
  circuit.json                the circuit board.py declared
  placement.json              poses and ratsnest edges
  board.kicad_sch  board.kicad_pcb  board.kicad_pro  board.kicad_dru  sym-lib-table  fp-lib-table
  filled/                     a copy of the project, with the board's zones filled by kicad-cli
  erc.json  netlist.xml  drc.json
  schematic.svg  svg/board-<layer>.svg  board.glb  render-top.png (with --render)
  result.json
```

The hash covers the circuit, the kernel and kicad-cli versions, every symbol and footprint the board uses, and the
render option. A build of an input that was built before returns the stored result. A folder is written under a
temporary name and renamed when complete, so two builds at once never leave half a folder. The newest 20 build
folders are kept.

## The result

`schema/build-result-1.schema.json` describes `pino.build/1` exactly. A result has a verdict (`ok`, `errors` or
`failed`), a headline such as `On h4: 0 errors, 2 warnings, 18 unrouted`, counts, at most 200 findings (the rest
counted in `truncated`), artifact paths relative to the project, timings per step, what changed since the previous
build in words, the placement score and what still waits (`routing: not started`).

Every finding has a source, a code, a severity and a plain message, and where it applies a position: board
millimetres (origin at the outline centre, y up), sheet millimetres (top left, y down) or a file and line.
Connections are checked by the parts and pins on each net, never by net names.

## pcbnew

pcbnew: none. Zone fill and DRC use kicad-cli, and the router runs in its own venv, which has no pcbnew. Nothing to
replace in KiCad 11.

## Tests

```sh
uv run --directory kernel pytest
```

Tests that need kicad-cli or KiCad's own libraries carry the `kicad_cli` and `kicad_libs` markers and skip with a
message when those are missing. Tests marked `krt` run the installed router and skip when there is none (they never
install it). Tests marked `network` fetch from GitHub and run only with `PINO_TEST_NETWORK=1`. Every test gets its
own `PINO_CACHE_DIR`. The fake router in `tests/fake_krt/` stands in for KiCadRoutingTools everywhere else. The unit tests use hand-written libraries in `tests/fixtures/libs/`.
`tests/fixtures/reference/` holds the reference board, built end to end.

## Licences

Apache-2.0, like the rest of pino. Some modules are ported from pcb-kit (MIT); `NOTICE` lists them with pcb-kit's
licence. KiCadRoutingTools (MIT) is fetched on first use, not shipped; `NOTICE` carries its licence too.
