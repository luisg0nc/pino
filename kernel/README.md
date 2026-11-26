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
uv run --directory kernel pino-kernel parts get C25804
uv run --directory kernel pino-kernel release <project folder> --dry-run
```

`build` prints the result on stdout and exits 0 when the verdict is `ok`, 1 for `errors` and 2 for `failed`.
Options: `--timeout S` (how long board.py may run, 30 s by default), `--render` (also a top render of the board),
`--no-kicad` (skip every kicad-cli step), `--no-cache` (build again even when this input was built before) and
`--offline` (look no parts up; use what the parts cache holds).

`version` prints `{"kernel", "schema", "kicad_cli", "libraries"}`.

## Serve protocol

`serve` reads one JSON request per line on stdin and writes one JSON object per line on stdout, flushed. Logs go
to stderr.

```json
{"id": 1, "op": "ping"}
{"id": 2, "op": "build", "project": "/path/to/project", "options": {"timeout": 30, "render": false, "kicad": true, "cache": true}}
{"id": 3, "op": "route", "project": "/path/to/project", "options": {"build": null, "timeout": 900, "step_timeout": 300, "install": true, "cache": true}}
{"id": 4, "op": "route_status", "project": "/path/to/project"}
{"id": 5, "op": "cancel", "job": 3}
{"id": 6, "op": "parts", "action": "get", "lcsc": "C25804"}
{"id": 7, "op": "fab_profiles"}
{"id": 8, "op": "release_status", "project": "/path/to/project"}
{"id": 9, "op": "release", "project": "/path/to/project", "options": {"bump": null, "network": true}}
{"id": 10, "op": "diff", "project": "/path/to/project", "from": "0123456789ab", "to": "ba9876543210"}
{"id": 11, "op": "shutdown"}
```

Ordered ops are answered in request order: `ping` gives `{"id": 1, "ok": true, "pong": {"kernel": "0.3.0",
"schema": "pino.build/1", "serve": 3, "route_schema": "pino.route/1", "parts_schema": "pino.parts/1",
"release_schema": "pino.release/1"}}`, `build` gives `{"id": 2, "ok": true, "result": {...}}`, `route_status` gives
`{"id": 4, "ok": true, "status": {...}}` (the `routing` field of the latest build), `fab_profiles` gives the fab's
limits, `release_status` says whether a release would go through, `diff` gives what changed between two kept builds
(`{"id": 10, "ok": true, "changes": {...}}`), and `shutdown` gives `{"id": 11, "ok": true}`.

Job ops (`route`, `parts`, `release`) run in child processes and do not hold up the ordered ops. Their progress
comes back as `{"id": 3, "event": {...}}` lines and their end as one `{"id": 3, "ok": true, "result": {...}}`.
`cancel` (or its older name `route_cancel`) is answered at once, out of order, with
`{"id": 5, "ok": true, "cancelled": true}` (`false` when no such job runs). `shutdown` and the end of input cancel
running jobs and wait up to 10 s for them.

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
their gap or not coupled. Last it exports `board.glb` from the routed, zone-filled board, as a build exports its
own (a build's model has no routed tracks, so the app's 3D view takes this one while the copper is a route's); if
that export fails, the route stands, with a warning. The route lands in `.pino/routes/<key>/` (`board.kicad_pcb`,
`filled/`, `board.glb`, `copper.json`, `drc.json`, `plan.json`, `key.json`, `route.json`, `log.txt`). The key is a
hash of what the copper depends on: nets by pad, placement, footprints, outline, zones, kept copper, rules, routing
instructions, and the router and kernel versions. The reference labels are in it too: the routed board is the
build's board with the copper on it, and its DRC checks them. A value change keeps the key; moving a part or a label
does not. When the newest kept route's board differs from the new one only by its labels (`labels moved` and nothing
else), a route does not run the router: it puts that route's tracks, arcs and vias on the new build's board, fills the
zones, runs DRC with parity and pino's checks, exports `board.glb` and stores the result as a new route (3 s on the
reference board, most of it the model export). Its result says so in `reused` (`{"number", "key"}` of the route it
took the copper from, else `null`) and in its headline (`copper of r3 kept (labels moved)`), and keeps that route's
steps, share and log. `--no-cache` always runs the router. The fast build reports routing as `none`, `running`,
`current` or `stale` (with the reasons), and stale copper is never used as it is: only a new route, by the router or
by this step, makes it current again. One route runs per project.
Routes are cached by key (a kept one with no `board.glb` gets it exported from its kept board, without routing
again), can be cancelled (SIGTERM, or
`route_cancel` in serve) and stop after 300 s per step and 900 s in all.

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

## Parts

A part can be named by its LCSC number, JLC's part number. pino asks jlcsearch
(https://github.com/tscircuit/jlcsearch, MIT) about it: stock, price, package, and whether JLC calls it basic,
preferred or extended (an extended part costs a setup fee per part type). `pino-kernel parts search <text>`
(`--basic`, `--preferred`, `--package`, `--limit`), `parts get <LCSC>`, `parts fetch <LCSC>...` and
`parts refresh <project>` print one `pino.parts/1` result. Text search leaves out parts whose stock jlcsearch does
not know, which includes many basic parts, so look those up by number.

What jlcsearch said is cached under `<cache>/parts/` with its date. Stock is fresh for 24 hours, and "no such part"
is remembered for 6 hours. When jlcsearch cannot be reached, the fast build waits 5 minutes before asking again,
so a bad connection slows one build and not every save; `parts` and `release` always ask. `PINO_CACHE_DIR` moves the cache, `PINO_JLCSEARCH_URL` points at another server,
`PINO_PARTS_OFFLINE=1` makes pino ask nothing, and `PINO_PARTS_RECORDED=<folder>` answers from recorded files (tests
use it; `scripts/record_parts.py` records them by hand). A request carries pino's version in its User-Agent and
nothing about you.

board.py can name a part by number alone, `r.path("R1", lcsc="C25744")`. Then pino picks the KiCad symbol and
footprint from KiCad's own libraries: `data/jlc/kicad_map.csv` has a row per number checked by hand, and rules for
plain two-pin passives (0402 to 1206 resistors and capacitors, 0402 to 0805 LEDs) from jlcsearch's category and
package. For any other part, board.py fails at that line and asks for `symbol=` and `footprint=` (with `lcsc=`
kept). pino does not use EasyEDA's library. The build looks up the numbers board.py spells out before it runs,
because board.py's own process only reads the cache.

`hand_fit=True` marks a part you solder yourself: it is left out of JLC's BOM and CPL and of KiCad's position
files. `why="..."` says why board.py chose an extended part. `rotation=` replaces pino's CPL rotation correction
for one part, in degrees counter-clockwise.

Every build checks the assembled parts again (source `parts`): a number JLC does not have, no stock or less than the
board needs (errors), less than five boards' worth or stock that cannot be confirmed (warnings), a part with no
number, and extended parts without `why=`. Stock changes by the day, so these findings are never stored with the
build and never change its hash.

## Fab files

`pino-kernel release <project>` writes `fab/v<version>/` from the newest build and its route, and nothing else
outside `.pino/`:

```
fab/v1.0.0/
  README.md                  what to upload, the parts, what to check in JLC's preview, what changed
  manifest.json              versions, hashes and the circuit this release holds
  <name>-v1.0.0-gerbers.zip  Gerbers and drill files, for the PCB order
  <name>-v1.0.0-bom.csv      Comment, Designator, Footprint, JLCPCB Part #, Quantity
  <name>-v1.0.0-cpl.csv      Designator, Val, Package, Mid X, Mid Y, Rotation, Layer
  gerbers/                   the same files, unzipped
```

Release refuses, and says why, when:

- there is no build, or the newest one failed, has errors or ran without kicad-cli
- board.py, or any `.py` or `.json` file of the project, changed since that build
- the board is not routed, a route is running, the copper is stale or incomplete, or it has DRC errors
- a part has no LCSC number, an extended part has no `why=`, or a part is out of stock
- the board is outside the sizes JLC assembles

Before plotting, it puts the route's copper onto the newest build's board, refills it and runs DRC with parity once
more, so the Gerbers match the BOM and CPL even when only a value changed after the route. It asks jlcsearch for
stock again, and the headline and the README name the parts whose stock it could not confirm.

The first release is 1.0.0. A change to the circuit (parts, values, footprints, numbers, what is fitted, or which
pins share a net) makes a minor release; anything else that changes the files makes a patch. `--major`, `--minor`
and `--patch` choose for you. The same files make no new release, and pino never writes over a `fab/v<version>/`
that is there. The same project gives the same bytes, zip included. `--dry-run` only says whether a release would
go through; `--offline` looks nothing up.

Positions in the CPL are millimetres from the centre of the board outline, y up, and the Gerbers use the same
origin. The CPL's rotation is KiCad's angle plus a correction per footprint family (`data/jlc/rotations.csv`,
worked out from EIA-481-D tape orientations; its docstring and `NOTICE` say how). None of the corrections has been
checked in JLC's placement preview yet, so release lists every part whose rotation could matter. Look at each one in
the preview before you pay.

`diff` compares two build folders that are still kept and answers
`{"id": 4, "ok": true, "changes": {"circuit": [...], "layout": [...]}}`, in the words a build's own `changes` uses.
A folder that was pruned answers `build <hash> is no longer kept`.

## Reference labels

After placement, the board writer moves each part's reference label (its Reference text) to the first clear spot
beside the part: above, below, left, right (centred, then flush with either end of that side), then the same four
turned 90 degrees. A spot is clear when the text keeps the fab's silk to pad distance from every pad, stays off every
part's body (a label under a part is not seen once it is assembled), off every other label and footprint silk line, and
the fab's copper to edge distance inside the outline. A part's body is its F.Fab or B.Fab outline on that side, or, for
a footprint that draws none, the outline round its pads and silk; the courtyard's margin outside the body does not
block, so a label may sit there (it can still be read). Tracks and zones do not count, since silk over copper is fine
for the fab. When nothing fits, the text gets smaller, never below the fab's minimum text height and line width; when
still nothing fits, the label is hidden and one `label_hidden` info finding names those parts. Bottom parts get their
labels on B.SilkS, mirrored, by the same rules. The text's size is worked out from KiCad's stroke font
(`pcb/labels.py`). The route starts from the build's board, so it keeps them, and a label that moves makes the
route stale (`labels moved`). The next route then keeps the copper (see Routing). On the reference board 3 of 22
labels are hidden (C3, C5, C7).

`b.label(part, ...)` in board.py sets one label by hand and wins: `side="left"` (top, bottom, left or right, centred),
`at=(dx, dy)` (mm from the part's origin, board frame), `rot=90` (degrees; alone it only turns the automatic search) or
`hide=True`. A hand label is not checked; DRC reports one that lands on a pad or another label. A `b.label()` on a
part whose footprint draws no reference on the silkscreen places nothing and gives a `label_not_drawn` warning.

## Design rules

`board.kicad_pro` holds each net class's widths and clearance, with the fab's smallest track and clearance as floors.
`board.kicad_dru` adds the fab limits that differ for vias and pads, plus the copper-to-edge and silkscreen limits.
It has no blanket clearance rule: in KiCad a custom clearance rule replaces every net class's clearance. JLC's
0.15 mm pad to pad rule applies to pads of the Default class only, for the same reason.

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
.pino/builds.json             build history: number, hash, verdict, time, digest of the sources (newest 100)
.pino/build/<hash>/
  circuit.json                the circuit board.py declared
  placement.json              poses and ratsnest edges
  board.kicad_sch  board.kicad_pcb  board.kicad_pro  board.kicad_dru  sym-lib-table  fp-lib-table
  filled/                     a copy of the project, with the board's zones filled by kicad-cli
  erc.json  netlist.xml  drc.json
  schematic.svg               the sheet without KiCad's drawing sheet (no border or title block)
  sheet.json                  where each symbol, pin, wire, label and block frame is, in sheet mm
  svg/board-<layer>.svg  board.glb  render-top.png (with --render)
  result.json
```

The hash covers the circuit, the kernel and kicad-cli versions, every symbol and footprint the board uses, and the
render option. A build of an input that was built before returns the stored result. A folder is written under a
temporary name and renamed when complete, so two builds at once never leave half a folder. The newest 20 build
folders are kept.

## The result

`schema/build-result-1.schema.json` describes `pino.build/1` exactly, and `schema/sheet-1.schema.json` describes
`sheet.json`. A result has a verdict (`ok`, `errors` or
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
own `PINO_CACHE_DIR` and runs with parts offline; a test that tries to open an internet socket fails. Parts tests
answer from `tests/fixtures/parts/jlcsearch/` (recorded by hand, with a few made-up parts marked `synthetic`). The fake router in `tests/fake_krt/` stands in for KiCadRoutingTools everywhere else. The unit tests use hand-written libraries in `tests/fixtures/libs/`.
`tests/fixtures/reference/` holds the reference board, built end to end.

## Licences

Apache-2.0, like the rest of pino. Some modules are ported from pcb-kit (MIT); `NOTICE` lists them with pcb-kit's
licence. KiCadRoutingTools (MIT) is fetched on first use, not shipped; `NOTICE` carries its licence too. The CPL
rotation table is pino's own.
