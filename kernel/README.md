# pino kernel

The engine behind pino. It runs a project's `board.py`, writes a KiCad 10 project from it (schematic, placed
board, rules), runs the fast checks and reports one build result as JSON. Routing is a later stage; this one stops
at a placed, unrouted board.

Python 3.12 or later, standard library only at run time. Tests use pytest and jsonschema.

## Run it

```sh
uv run --directory kernel pino-kernel build <project folder>
uv run --directory kernel pino-kernel version
uv run --directory kernel pino-kernel serve
```

`build` prints the result on stdout and exits 0 when the verdict is `ok`, 1 for `errors` and 2 for `failed`.
Options: `--timeout S` (how long board.py may run, 30 s by default), `--render` (also a top render of the board),
`--no-kicad` (skip every kicad-cli step) and `--no-cache` (build again even when this input was built before).

`version` prints `{"kernel", "schema", "kicad_cli", "libraries"}`.

## Serve protocol

`serve` reads one JSON request per line on stdin and writes one JSON reply per line on stdout, flushed, in request
order. Logs go to stderr.

```json
{"id": 1, "op": "ping"}
{"id": 2, "op": "build", "project": "/path/to/project", "options": {"timeout": 30, "render": false, "kicad": true, "cache": true}}
{"id": 3, "op": "shutdown"}
```

Replies are `{"id": 1, "ok": true, "pong": {"kernel": "0.1.0", "schema": "pino.build/1"}}`,
`{"id": 2, "ok": true, "result": {...}}` and `{"id": 3, "ok": true}`. A line that is not JSON, or an unknown op,
gets `{"id": <id or null>, "ok": false, "error": "..."}` and the loop goes on. End of input also stops it. Each build
still runs board.py in a fresh child process.

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

pcbnew: none. Zone fill uses kicad-cli. Nothing to replace in KiCad 11.

## Tests

```sh
uv run --directory kernel pytest
```

Tests that need kicad-cli or KiCad's own libraries carry the `kicad_cli` and `kicad_libs` markers and skip with a
message when those are missing. The unit tests use hand-written libraries in `tests/fixtures/libs/`.
`tests/fixtures/reference/` holds the reference board, built end to end.

## Licences

Apache-2.0, like the rest of pino. Some modules are ported from pcb-kit (MIT); `NOTICE` lists them with pcb-kit's
licence.
