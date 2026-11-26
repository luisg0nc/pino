# pino engine (stage 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Python engine, `pino_kernel` in `kernel/`, that turns a project's `board.py` into a KiCad 10 project with a readable schematic, a placed board, fast checks and a versioned JSON build result, from a CLI and a long-lived JSON-lines mode.

**Architecture:** `board.py` runs in a child process and yields one circuit model (JSON). Two writers take that model: the schematic writer (from the schematic spike) and the board writer (from the board-writer spike), sharing one UUID scheme. A placer turns placement intent into positions, scored by a ratsnest scorer ported from pcb-kit. kicad-cli runs ERC, netlist export, DRC with zone refill, SVG, GLB and render; pino's own checks read KiCad's outputs by pins, never by net names. Every build lands in `.pino/build/<hash>/` with a `result.json`.

**Tech Stack:** Python 3.12+, uv, standard library only at run time; pytest and jsonschema for tests; KiCad 10.0.x `kicad-cli` (no pcbnew).

**Spec:** `docs/superpowers/specs/2026-11-26-pino-design.md` (sections 3, 5.1 to 5.3, 5.8, 5.10, 6, 7, 9). Spike reports: `.worktrees/spike-board-writer.report.md`, `.worktrees/spike-schematic.report.md` (not committed; read them before starting).

**Where to work:** branch `engine` in a worktree at `.worktrees/engine`, cut from `main` while the `shell` branch is still being built (director's call, 2026-11-26, so the two run in parallel). The engine touches only `kernel/` and `.github/workflows/kernel.yml`. Root files that the shell also creates (`NOTICE`, `.gitignore`) get engine-only content: the pcb-kit section goes in `kernel/NOTICE` and the root `NOTICE` is merged after the shell lands; kernel ignores go in `kernel/.gitignore`. Task 17's CI jobs go in their own workflow `.github/workflows/kernel.yml`, not `ci.yml`, and `app/src/ci.test.ts` is not touched. The engine merges after the shell; the director rebases it if needed. One PR to `main` after the leak audit; the director merges after the whole-branch review.

**Spike code, read only:** `git -C <repo> show spike-schematic:spike/schematic/<file>` and `git -C <repo> show spike-board-writer:spike/board_writer/<file>`. Each task names the spike file it starts from. Spike code is pino's own and needs no notice. pcb-kit code (MIT) is read from a fresh clone of https://github.com/somebox/pcb-kit at commit `32867ca`; never run it.

## Global Constraints

- Python `>=3.12`, project managed by uv in `kernel/`. Run-time dependencies: none. Dev dependencies: `pytest>=8`, `jsonschema>=4`.
- No pcbnew. Nothing imports it, and `kernel/tests/test_hygiene.py` fails if any file under `kernel/src` contains `import pcbnew` or `from pcbnew`. Zone fill goes through `kicad-cli pcb drc --refill-zones --save-board` on a copy.
- Deterministic bytes: every file a build writes, except `result.json`, is a pure function of `board.py`, `outline.json`, the library files it uses, the kernel version and the kicad-cli version. Same bytes across processes and `PYTHONHASHSEED` values. No time, randomness, absolute paths or set iteration order in those files. UUIDs come only from `pino_kernel/ids.py`.
- `result.json` differs between two builds of the same input only in `number`, `timings`, `changes` and `cached`.
- Ported pcb-kit code (MIT, Copyright (c) 2026 Jeremy Seitz) keeps its notice: a "pcb-kit" section with the full MIT text in the repo root `NOTICE`, and this header at the top of each ported file: `# Ported from pcb-kit (https://github.com/somebox/pcb-kit, commit 32867ca). MIT License, Copyright (c) 2026 Jeremy Seitz. See NOTICE.` Ported files: `pino_kernel/outline.py` (outline_points), `pino_kernel/placement/ratsnest.py`, `pino_kernel/diff.py`.
- KiCad library files (CC-BY-SA) are never copied into the repo. Unit-test libraries under `kernel/tests/fixtures/libs/` are hand-written. Tests that need KiCad's own libraries carry the `kicad_libs` marker; tests that run kicad-cli carry `kicad_cli`. Both skip with a clear message when the thing is missing.
- No personal paths, hostnames or user names in committed files; `test_hygiene.py` fails on `/home/<name>` or `/Users/` under `kernel/`. Tests build in `tmp_path`, never in the repo tree.
- Tests never open a window: every kicad-cli call runs with `DISPLAY` and `WAYLAND_DISPLAY` removed from its environment, and `kernel/tests/conftest.py` removes both from `os.environ` for the whole session. Never start the KiCad GUI. Never run the real `claude` CLI.
- kicad-cli runs with an isolated KiCad home: `KICAD_CONFIG_HOME=<project>/.pino/kicad/config`, `XDG_CACHE_HOME=<project>/.pino/kicad/cache`. Library paths go in through `-D KICAD10_SYMBOL_DIR=…`, `-D KICAD10_FOOTPRINT_DIR=…`, `-D KICAD10_3DMODEL_DIR=…` (and the same names in the environment).
- The engine writes only under `<project>/.pino/`. It never edits `board.py`, `outline.json` or anything else in the project.
- Processes: the engine kills only processes it started (the child's own process group). No broad kills.
- Coordinates. Board positions everywhere pino shows them (board.py, findings, placement, build result) are millimetres in the `outline.json` frame: origin at the outline centre, x right, y up. Only `pino_kernel/coords.py` converts to KiCad's frame (`X = 100 + x`, `Y = 100 - y`); angles are the same number in both (counter-clockwise as seen from the top). Schematic positions are sheet millimetres, origin top left, y down, as KiCad has them.
- KiCad formats: `.kicad_pcb` `(version 20260206)` with `(generator "pino")` and `(generator_version "10.0")`; `.kicad_sch` `(version 20260306)`. Files are named `board.kicad_*` in every build, whatever the `Board` name; the name goes into the title block.
- Size caps for what reaches the agent (spec section 2, anti-goals): at most 200 findings in a result (`truncated` counts the rest), messages at most 300 characters, at most 50 lines per change list, headline at most 160 characters.
- English, plain words in every message; no em dashes in copy.
- Commits: plain `git commit`, no Co-Authored-By trailer, no "Generated with" footer.

## Review Focus

1. A project folder whose path has a space or non-ASCII letters (`~/boards/my board`, `placa-ação`): the build works and kicad-cli gets each path as one argument. Test: `test_build_in_a_path_with_spaces` in Task 16.
2. Library files not written by KiCad's own formatter (a footprint on one line, a symbol library indented with spaces, as converted or user libraries are): they load the same. Tests: `test_symbol_library_indented_with_spaces` in Task 3, `test_one_line_footprint_loads_like_the_formatted_one` in Task 10.
3. Two builds of one project at once (the app's serve process and a CLI run by Claude): both finish, `builds.json` stays valid JSON, no half-written build folder is left. Test: `test_two_builds_at_once` in Task 16.
4. A `board.py` that imports a helper module beside it or opens a file by a relative path: it works as it would under `python board.py`. Test: `test_board_py_imports_a_sibling_module` in Task 7.
5. A library footprint that carries its own zone listing more copper layers than the board has (the ESP32-C6-MINI-1 antenna keep-out lists In1.Cu to In30.Cu): pino writes only the board's layers and KiCad's re-save leaves the zone unchanged. Tests: `test_footprint_zone_keeps_only_board_layers` in Task 11, `test_footprint_zone_survives_kicad_resave` in Task 11.

---

## File structure

```
NOTICE                                   modify: add the pcb-kit section
.gitignore                               modify: kernel/.venv/, __pycache__/, .pytest_cache/
.github/workflows/ci.yml                 modify: kernel jobs (Task 17)
app/src/ci.test.ts                       modify: expects the kernel jobs (Task 17)
kernel/
  pyproject.toml  README.md
  schema/build-result-1.schema.json      the versioned result schema
  src/pino/__init__.py                   the board.py library: Board, Block, Part, Group, PinSet, CircuitError, fab
  src/pino/board.py                      API, validation, to_circuit()
  src/pino_kernel/
    __init__.py                          __version__
    sexpr.py  ids.py  coords.py  libraries.py  geometry.py
    kicad_cli.py                         every kicad-cli call
    symbols.py                           .kicad_sym loader
    fab.py                               fab profiles (JLC standard 2 and 4 layer)
    circuit.py                           circuit model, placement, JSON
    findings.py                          Finding, At
    outline.py                           outline.json (pcb-kit enclosure.json shape), ported outline_points
    runner.py                            child: run board.py, print circuit JSON
    run_board.py                         parent: spawn, timeout, errors with file and line
    schematic/canvas.py layout.py writer.py lint.py
    pcb/footprint.py writer.py stackup.py rules.py
    placement/ratsnest.py placer.py
    checks/netlist.py expect.py reports.py courtyards.py fit.py
    diff.py                              circuit and layout changes in words (ported)
    result.py  history.py  build.py  cli.py
  tests/
    conftest.py  helpers.py  semdiff.py  fake_kicad_cli.py
    fixtures/libs/{symbols,footprints,3dmodels}/   hand-written test libraries
    fixtures/outline/enclosure.json
    fixtures/reference/board.py  outline.json      the spec section 6 board
    test_*.py
```

---

### Task 1: Kernel package, S-expressions, IDs, coordinates, library discovery

**Files:**
- Create: `kernel/pyproject.toml`, `kernel/src/pino_kernel/__init__.py`, `kernel/src/pino_kernel/sexpr.py` (from `spike-board-writer:spike/board_writer/board_writer/sexpr.py`), `kernel/src/pino_kernel/ids.py`, `kernel/src/pino_kernel/coords.py`, `kernel/src/pino_kernel/libraries.py`, `kernel/src/pino/__init__.py` (empty for now), `kernel/tests/conftest.py`
- Modify: `NOTICE`, `.gitignore`
- Test: `kernel/tests/test_sexpr.py`, `test_ids.py`, `test_coords.py`, `test_libraries.py`, `test_hygiene.py`

**Interfaces:**
- Produces:
  - `sexpr.Sym(str)` (bare atom; a plain `str` is a quoted string), `num(v: float) -> Sym`, `parse(text: str) -> list`, `dump(node: list) -> str`, `find(node, key) -> list | None`, `find_all(node, key) -> list[list]`.
  - `ids.NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://pino.invalid/kernel/v1")`, `ids.uid(*parts: str) -> str` (uuid5 of `"/".join(parts)`), `ids.symbol_uuid(key: str) -> str` (= `uid("symbol", key)`), `ids.footprint_uuid(key: str) -> str` (= `uid("footprint", key)`), `ids.sheet_uuid() -> str` (= `uid("sheet", "root")`), `ids.footprint_path(key: str) -> str` (= `"/" + symbol_uuid(key)`). `key` is a part's `id=` when given, else its ref. The board name is never part of a key.
  - `coords.ORIGIN = (100.0, 100.0)`, `to_kicad(x: float, y: float) -> tuple[float, float]`, `from_kicad(X: float, Y: float) -> tuple[float, float]`.
  - `libraries.Libraries(symbols: Path, footprints: Path, models: Path)` (frozen dataclass) with `path_vars() -> dict[str, str]` (the three `KICAD10_*_DIR` names), `libraries.discover(env: Mapping[str, str] = os.environ) -> Libraries`, `libraries.LibrariesNotFound(Exception)` with `.tried: list[str]`.
  - `pino_kernel.__version__ = "0.1.0"`.

- [x] **Step 1: Write the failing tests**

```python
# test_sexpr.py
def test_parse_marks_bare_atoms_and_keeps_strings():
    node = parse('(kicad_pcb (version 20260206) (generator "pino") (net "GND"))')
    assert isinstance(node[0], Sym) and node[0] == "kicad_pcb"
    gen = find(node, "generator")[1]
    assert gen == "pino" and not isinstance(gen, Sym)
    assert parse(dump(node)) == node

def test_num_is_canonical():
    assert [num(1.0), num(-0.0), num(0.1 + 0.2), num(1.23456789), num(100)] == ["1", "0", "0.3", "1.234568", "100"]

def test_dump_escapes_and_indents_with_tabs():
    text = dump([Sym("property"), 'a"b\\c', [Sym("at"), num(1), num(2)]])
    assert '"a\\"b\\\\c"' in text and "\n\t(at 1 2)" in text

def test_find_all():
    assert [n[1] for n in find_all(parse("(a (b 1) (c) (b 2))"), "b")] == ["1", "2"]

# test_ids.py
def test_symbol_uuid_is_uuid5_of_key():
    assert ids.symbol_uuid("U1") == str(uuid.uuid5(ids.NAMESPACE, "symbol/U1"))
    assert ids.footprint_path("pullup") == "/" + ids.symbol_uuid("pullup")
    assert len({ids.symbol_uuid("U1"), ids.footprint_uuid("U1"), ids.sheet_uuid()}) == 3

# test_coords.py
def test_round_trip_and_y_flip():
    assert to_kicad(0, 0) == (100.0, 100.0)
    assert to_kicad(3, 4) == (103.0, 96.0)
    assert from_kicad(*to_kicad(-7.5, 2.25)) == (-7.5, 2.25)

# test_libraries.py
def test_pino_variables_win(tmp_path):
    for d in ("s", "f", "m"): (tmp_path / d).mkdir()
    env = {"PINO_KICAD_SYMBOL_DIR": str(tmp_path / "s"), "PINO_KICAD_FOOTPRINT_DIR": str(tmp_path / "f"),
           "PINO_KICAD_3DMODEL_DIR": str(tmp_path / "m"), "KICAD10_SYMBOL_DIR": "/nowhere"}
    libs = discover(env)
    assert libs.symbols == tmp_path / "s" and libs.path_vars()["KICAD10_3DMODEL_DIR"] == str(tmp_path / "m")

def test_nothing_found_lists_what_was_tried():
    with pytest.raises(LibrariesNotFound) as e:
        discover({"PINO_KICAD_SYMBOL_DIR": "/nowhere/s", "HOME": "/nowhere"}, roots=())
    assert "/nowhere/s" in e.value.tried

# test_hygiene.py
def test_no_pcbnew_import(): ...      # grep kernel/src for r"^\s*(import|from)\s+pcbnew"
def test_no_personal_paths(): ...     # grep kernel/ text files (skip .venv and this file) for r"/home/[a-z]" and "/Users/"
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel'`

- [x] **Step 3: Write the package**

- `pyproject.toml`: name `pino-kernel`, version `0.1.0`, `requires-python = ">=3.12"`, `dependencies = []`, build backend hatchling with packages `src/pino` and `src/pino_kernel`, `[project.scripts] pino-kernel = "pino_kernel.cli:main"`, dependency group `dev = ["pytest>=8", "jsonschema>=4"]`, pytest `testpaths = ["tests"]` and markers `kicad_cli`, `kicad_libs`.
- `sexpr.py`: the board spike's reader and printer as they are (they match KiCad 10's save layout). Every later module uses its convention: `Sym` for bare atoms, `str` for quoted strings. The schematic spike's `Q` convention is not used.
- `discover(env, roots=DEFAULT_ROOTS)`: per kind, the first existing directory of `PINO_KICAD_<KIND>_DIR`, then `KICAD10_<KIND>_DIR`, then `<root>/symbols|footprints|3dmodels` for each root in order: `/usr/share/kicad`, `/usr/local/share/kicad`, `/var/lib/flatpak/runtime/org.kicad.KiCad.Library/x86_64/stable/active/files`, `~/.local/share/flatpak/runtime/org.kicad.KiCad.Library/x86_64/stable/active/files` (expanded from `env["HOME"]` at run time). Raise `LibrariesNotFound` when symbols or footprints are missing; a missing models dir is allowed (every model then counts as missing).
- `conftest.py`: an autouse session fixture that deletes `DISPLAY` and `WAYLAND_DISPLAY` from `os.environ`; skip hooks for the two markers (`kicad_cli` skips with "kicad-cli not found: install KiCad 10 to run this test"; `kicad_libs` skips with "KiCad's libraries not found").
- `NOTICE`: append a "pcb-kit" section: source URL, commit `32867ca`, the three ported files, and the MIT licence text with "Copyright (c) 2026 Jeremy Seitz".
- `.gitignore`: add `kernel/.venv/`, `__pycache__/`, `.pytest_cache/`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests -v`
Expected: PASS (6 tests)

- [x] **Step 5: Commit**

```bash
git add NOTICE .gitignore kernel
git commit -m "kernel: package skeleton, S-expressions, IDs, coordinates, library discovery"
```

---

### Task 2: kicad-cli wrapper

**Files:**
- Create: `kernel/src/pino_kernel/kicad_cli.py` (from `spike-board-writer:spike/board_writer/validate.py` and `kicad_env`/`cli` in `spike-schematic:spike/schematic/build.py`), `kernel/tests/fake_kicad_cli.py`
- Test: `kernel/tests/test_kicad_cli.py`

**Interfaces:**
- Consumes: `Libraries.path_vars()` (Task 1).
- Produces:
  - `CliRun(step: str, argv: list[str], seconds: float, returncode: int, output: str)` dataclass; `output` is the last 2000 characters of stdout plus stderr.
  - `KicadCli(libraries: Libraries, home: Path, argv0: Sequence[str])`; `KicadCli.find(env=os.environ) -> list[str] | None` (`shlex.split(env["PINO_KICAD_CLI"])` when set and its first word resolves, else `shutil.which("kicad-cli")`).
  - Methods, each deleting its output file or folder first (a failed run must not leave the last build's report behind): `version() -> str`, `erc(sch, out) -> CliRun`, `netlist(sch, out) -> CliRun`, `sch_svg(sch, out_dir) -> CliRun`, `drc(pcb, out, *, refill=False, save=False, parity=False) -> CliRun`, `pcb_svg(pcb, out_dir, layers: Sequence[str]) -> CliRun`, `glb(pcb, out) -> CliRun`, `render(pcb, out, *, side="top", width=1600, height=1200) -> CliRun`, `sch_upgrade(sch) -> CliRun`, `run(step, *args, timeout=120.0) -> CliRun`, `env() -> dict[str, str]`.

- [x] **Step 1: Write the failing tests**

`fake_kicad_cli.py` prints one JSON line `{"argv": sys.argv[1:], "env": {k: os.environ.get(k) for k in WATCHED}}`; prints `--define-var` for any `--help`; sleeps 30 s when its first argument is `sleep`; never writes an output file.

```python
def make(tmp_path, libs):
    return KicadCli(libs, tmp_path / "home", [sys.executable, str(FAKE)])

def test_environment_has_no_display_and_an_isolated_home(tmp_path, fixture_libs, monkeypatch):
    monkeypatch.setenv("DISPLAY", ":0"); monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    run = make(tmp_path, fixture_libs).erc(tmp_path / "board.kicad_sch", tmp_path / "erc.json")
    seen = json.loads(run.output.splitlines()[0])
    assert seen["env"]["DISPLAY"] is None and seen["env"]["WAYLAND_DISPLAY"] is None
    assert seen["env"]["KICAD_CONFIG_HOME"] == str(tmp_path / "home" / "config")
    assert f"KICAD10_SYMBOL_DIR={fixture_libs.symbols}" in seen["argv"]
    assert seen["argv"][:4] == ["sch", "erc", "--format", "json"] and "--severity-all" in seen["argv"]

def test_stale_report_is_deleted_first(tmp_path, fixture_libs):
    out = tmp_path / "erc.json"; out.write_text("{}")
    make(tmp_path, fixture_libs).erc(tmp_path / "board.kicad_sch", out)
    assert not out.exists()

def test_glb_flags_match_the_spec(tmp_path, fixture_libs):
    argv = json.loads(make(tmp_path, fixture_libs).glb(tmp_path / "b.kicad_pcb", tmp_path / "b.glb").output.splitlines()[0])["argv"]
    for flag in ("--include-tracks", "--include-pads", "--include-zones", "--include-silkscreen", "--include-soldermask"):
        assert flag in argv

def test_drc_flags(tmp_path, fixture_libs):
    argv = json.loads(make(tmp_path, fixture_libs).drc(tmp_path / "b.kicad_pcb", tmp_path / "d.json", refill=True, save=True, parity=True).output.splitlines()[0])["argv"]
    assert {"--refill-zones", "--save-board", "--schematic-parity", "--severity-all"} <= set(argv)

def test_timeout_kills_the_child_and_says_so(tmp_path, fixture_libs):
    run = make(tmp_path, fixture_libs).run("sleep", "sleep", timeout=1.0)
    assert run.returncode != 0 and "timed out after 1 s" in run.output and run.seconds < 5

@pytest.mark.kicad_cli
def test_real_version_is_10(tmp_path):
    libs = discover(); cli = KicadCli(libs, tmp_path / "home", KicadCli.find())
    assert cli.version().startswith("10.")
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_kicad_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.kicad_cli'`

- [x] **Step 3: Write `kicad_cli.py`**

- `env()`: `os.environ` minus `DISPLAY` and `WAYLAND_DISPLAY`, plus `KICAD_CONFIG_HOME=<home>/config`, `XDG_CACHE_HOME=<home>/cache`, plus `libraries.path_vars()`. Create both folders on first use.
- `-D NAME=VALUE` for each path var is added to a subcommand only when `<argv0> <subcommand> --help` lists `--define-var`; the answer is cached per subcommand on the instance.
- `run()` uses `subprocess.run(argv, env=..., capture_output=True, text=True, timeout=..., start_new_session=True)`; on `TimeoutExpired` it kills the child's process group with `os.killpg(proc.pid, SIGKILL)` (only that group) and returns `returncode=-9` with output `"timed out after <n> s"`. Paths are passed as `str(path)` list items, never through a shell.
- Exact commands: `sch erc --format json --severity-all -o OUT SCH`; `sch export netlist --format kicadxml -o OUT SCH`; `sch export svg -o DIR SCH`; `pcb drc --format json --severity-all [--refill-zones] [--save-board] [--schematic-parity] -o OUT PCB`; `pcb export svg --mode-multi --exclude-drawing-sheet --page-size-mode 2 -l L1,L2,… -o DIR/ PCB` (if this kicad-cli's `pcb export svg --help` lacks `--mode-multi`, one `--mode-single` call per layer named `DIR/board-<layer with . replaced by _>.svg`); `pcb export glb --include-tracks --include-pads --include-zones --include-silkscreen --include-soldermask -o OUT PCB`; `pcb render --side SIDE --width W --height H --quality basic -o OUT PCB`; `sch upgrade --force SCH`; `version`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_kicad_cli.py -v`
Expected: PASS (the real-version test passes or skips with the marker message)

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/kicad_cli.py kernel/tests/fake_kicad_cli.py kernel/tests/test_kicad_cli.py
git commit -m "kernel: kicad-cli wrapper with no display, isolated home and path variables"
```

---

### Task 3: Symbol loader

**Files:**
- Create: `kernel/src/pino_kernel/symbols.py` (from `spike-schematic:spike/schematic/pinosch/symbols.py`), `kernel/tests/fixtures/libs/symbols/pino_test.kicad_sym`, `kernel/tests/fixtures/libs/symbols/power.kicad_sym`
- Test: `kernel/tests/test_symbols.py`

**Interfaces:**
- Produces:
  - `GRID = 1.27`; `Pin(number: str, name: str, etype: str, x: int, y: int, angle: int, length: int)` frozen dataclass, grid units, sheet orientation as in the spike.
  - `Symbol(lib_id: str, node: list, pins: tuple[Pin, ...], properties: dict[str, str], is_power: bool)` with `pins_for(key: str | int) -> list[Pin]` (by number first, then every pin of that name). `node` is the flattened `(symbol "Lib:Name" …)` ready for `lib_symbols`.
  - `SymbolLibrary(root: Path)` with `load(lib_id: str) -> Symbol` and `source_digest(lib_id: str) -> str` (sha256 of the symbol's text block and its `extends` parents). Cached per `(file, mtime_ns)`.
  - `SymbolNotFound(KeyError)`, `UnsupportedSymbol(ValueError)`.
  - `turn`, `pin_at`, `pin_outward`, `body_box` as in the spike.

- [x] **Step 1: Write the fixture libraries and the failing tests**

`pino_test.kicad_sym` is hand-written, indented with two spaces (not tabs), with: `R` and `C` (pins 1 and 2, vertical, as KiCad's Device:R), `R_Derived` (`extends "R"`, Value `Rd`), `LED` (K=1 left, A=2 right), `LDO3` (VIN=1 left, GND=2 bottom, VOUT=3 right), `IC6` (VDD=1, GND=2, IO1=3, IO2=4, IO3=5, EN=6), `CONN_VBUS` (VBUS on pins 1 to 4, GND on 5, all on the right), `CONN2` (pins 1 and 2 on one side), `DUAL` (two units). `power.kicad_sym` holds `GND`, `+3V3`, `VBUS` and `PWR_FLAG` power symbols.

```python
def test_loads_pins_in_number_order(fixture_libs):
    assert [p.number for p in SymbolLibrary(fixture_libs.symbols).load("pino_test:R").pins] == ["1", "2"]

def test_symbol_library_indented_with_spaces(fixture_libs):
    lib = SymbolLibrary(fixture_libs.symbols)
    assert lib.load("pino_test:IC6").pins_for("EN")[0].number == "6"

def test_extends_is_flattened(fixture_libs):
    lib = SymbolLibrary(fixture_libs.symbols)
    d = lib.load("pino_test:R_Derived")
    assert d.node[1] == "pino_test:R_Derived" and d.properties["Value"] == "Rd"
    assert d.pins == lib.load("pino_test:R").pins
    assert all(str(s[1]).startswith("R_Derived_") for s in find_all(d.node, "symbol"))

def test_name_stands_for_every_pad(fixture_libs):
    lib = SymbolLibrary(fixture_libs.symbols)
    assert len(lib.load("pino_test:CONN_VBUS").pins_for("VBUS")) == 4
    assert lib.load("pino_test:CONN_VBUS").pins_for(5)[0].name == "GND"

def test_multi_unit_is_refused_in_plain_words(fixture_libs):
    with pytest.raises(UnsupportedSymbol, match="multi-unit symbols are not supported yet: pino_test:DUAL"):
        SymbolLibrary(fixture_libs.symbols).load("pino_test:DUAL")

def test_missing_symbol_and_library(fixture_libs):
    lib = SymbolLibrary(fixture_libs.symbols)
    with pytest.raises(SymbolNotFound): lib.load("pino_test:Nope")
    with pytest.raises(SymbolNotFound): lib.load("nolib:R")

@pytest.mark.kicad_libs
def test_real_ldo_extends_and_footprint():
    s = SymbolLibrary(discover().symbols).load("Regulator_Linear:AP2112K-3.3")
    assert {p.name for p in s.pins} >= {"VIN", "GND", "EN", "VOUT"}
    assert s.properties["Footprint"] == "Package_TO_SOT_SMD:SOT-23-5"
```

`fixture_libs` (in `conftest.py`) sets the three `PINO_KICAD_*_DIR` variables to `tests/fixtures/libs/{symbols,footprints,3dmodels}` with monkeypatch and returns `discover()`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_symbols.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.symbols'`

- [x] **Step 3: Write `symbols.py`**

Find a top-level symbol by scanning tokens with a depth counter (strings and parentheses, as the spike's `_STRING_OR_PAREN`) and taking `(symbol "<name>"` at depth 1; never by indentation. Count units from sub-symbol names `<Name>_<unit>_<style>`; more than one unit above 0 raises `UnsupportedSymbol`. Keep the spike's `extends` flattening, pin geometry and pose functions.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_symbols.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/symbols.py kernel/tests/fixtures/libs/symbols kernel/tests/test_symbols.py kernel/tests/conftest.py
git commit -m "kernel: symbol loader that does not depend on KiCad's indentation"
```

---

### Task 4: Shared model: circuit JSON, placement, findings, fab profiles

**Files:**
- Create: `kernel/src/pino_kernel/circuit.py`, `kernel/src/pino_kernel/findings.py`, `kernel/src/pino_kernel/fab.py`
- Test: `kernel/tests/test_circuit.py`, `kernel/tests/test_fab.py`

**Interfaces:**
- Produces (all dataclasses; every later task uses these names):
  - `circuit.SCHEMA = "pino.circuit/1"`; `CircuitSchemaError(ValueError)`.
  - `PinRef(ref: str, number: str)` frozen, `str()` gives `"U1.3"`, JSON `["U1", "3"]`.
  - `PinInfo(number: str, name: str, etype: str)`.
  - `PartSpec(ref, key, symbol, footprint, value, lcsc, dnp: bool, block, role, pins: list[PinInfo], line: int | None)`; `role` in `path|shunt|tap|across`.
  - `NetSpec(name, kind, external: bool, symbol: str, pins: list[PinRef], line)`; `kind` in `signal|supply|gnd`.
  - `BlockSpec(key, title, parts: list[str])`.
  - `Intent(target: str, edge: str | None, along: float | None, near: str | None, side: str | None, at: tuple[float, float] | None, rot: float | None, back: bool, line)`; `target` and `near` are `"U1"`, `"U1.3"` or `"group:<name>"`.
  - `GroupSpec(name, refs: list[str], line)`.
  - `Keepout(polygon: list[tuple[float, float]], layers: list[str], forbid: list[str], why: str, source: str, line)`; `forbid` from `tracks|vias|pads|copperpour|footprints`; `source` is `board.py` or `outline.json`.
  - `ZoneSpec(net, layer, polygon: list[tuple[float, float]] | None, line)`.
  - `NetClassSpec(name, nets: list[str], width, clearance, via_diameter, via_drill, line)`.
  - `Expect(kind: str, a: list[PinRef], b: list[PinRef], through: list[str], line)`; `kind` in `path|apart`.
  - `Hole(name, x, y, drill, courtyard)`; `OutlineSpec(width, height, segments: list[tuple], holes: list[Hole], height_limit: dict | None, source: str)`; segments are `("line", a, b)` or `("arc", start, mid, end)` in board mm.
  - `Circuit(schema, name, layers: int, fab: str, outline: OutlineSpec, blocks, parts, nets, no_connects: list[PinRef], nc_rest: dict[str, list[str]], intents, groups, keepouts, zones, net_classes, expects, source_file: str)` with `to_json() -> str`, `from_json(text) -> Circuit` (static), `part(ref) -> PartSpec`, `net_of(ref, number) -> NetSpec | None`.
  - `PartPose(x: float, y: float, rot: float, back: bool)`; `Placement = dict[str, PartPose]`; `placement_to_json(p) -> str`, `placement_from_json(text) -> Placement`.
  - `findings.At(space: str, x=None, y=None, layer=None, file=None, line=None)` (`space` in `board|sheet|source`), `findings.Finding(source, code, severity, message, at: At | None = None, refs=(), pins=(), nets=())` frozen, `to_json() -> dict`, `SEVERITIES = ("error", "warning", "info")`.
  - `fab.FabProfile(name, layers, min_track, min_clearance, min_via_drill, min_via_diameter, min_annular, min_hole, hole_to_hole, copper_to_edge, silk_min_width, silk_min_text_height, board_thickness=1.6, copper_oz=1.0)`, `fab.jlc_standard_2layer`, `fab.jlc_standard_4layer`, `fab.PROFILES: dict[str, FabProfile]`, `fab.for_layers(n) -> FabProfile`.

- [x] **Step 1: Write the failing tests**

```python
def test_json_round_trip_is_exact(sample_circuit):           # a hand-built Circuit with every field set
    text = sample_circuit.to_json()
    assert Circuit.from_json(text) == sample_circuit and Circuit.from_json(text).to_json() == text

def test_json_keeps_declaration_order(sample_circuit):
    assert [p.ref for p in Circuit.from_json(sample_circuit.to_json()).parts] == [p.ref for p in sample_circuit.parts]

def test_other_schema_is_refused():
    with pytest.raises(CircuitSchemaError, match="pino.circuit/2"):
        Circuit.from_json('{"schema": "pino.circuit/2"}')

def test_net_of(sample_circuit):
    assert sample_circuit.net_of("R1", "1").name == "VBUS" and sample_circuit.net_of("R1", "9") is None

def test_floats_are_rounded_in_json():
    assert '"x": 1.000001' in placement_to_json({"R1": PartPose(1.0000006, 0, 0, False)})

def test_finding_json_drops_empty_fields():
    f = Finding("fit", "outside_outline", "error", "R1 is outside the outline", At("board", 1.0, 2.0, "F.Cu"), refs=("R1",))
    assert f.to_json() == {"source": "fit", "code": "outside_outline", "severity": "error",
                           "message": "R1 is outside the outline", "at": {"space": "board", "x": 1.0, "y": 2.0, "layer": "F.Cu"}, "refs": ["R1"]}

# test_fab.py
def test_jlc_profiles():
    assert fab.for_layers(2) is fab.jlc_standard_2layer and fab.for_layers(4) is fab.jlc_standard_4layer
    assert (fab.jlc_standard_2layer.min_track, fab.jlc_standard_2layer.min_clearance) == (0.15, 0.15)
    assert (fab.jlc_standard_4layer.min_track, fab.jlc_standard_4layer.min_clearance) == (0.1, 0.1)
    assert set(fab.PROFILES) == {"jlc-standard-2layer", "jlc-standard-4layer"}
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_circuit.py tests/test_fab.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [x] **Step 3: Write the three modules**

- `to_json`: `json.dumps(..., indent=1, sort_keys=True, ensure_ascii=False) + "\n"`; floats rounded to 6 decimals; lists keep declaration order (layout reads it).
- Profiles (conservative values at or above JLC's published standard minimums; a person checks them against JLC's capability page before stage 8 makes fab files): 2-layer `min_track 0.15, min_clearance 0.15, min_via_drill 0.3, min_via_diameter 0.6, min_annular 0.15, min_hole 0.3, hole_to_hole 0.5, copper_to_edge 0.3, silk_min_width 0.15, silk_min_text_height 1.0`; 4-layer the same except `min_track 0.1, min_clearance 0.1`. Both 1.6 mm, 1 oz.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_circuit.py tests/test_fab.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/circuit.py kernel/src/pino_kernel/findings.py kernel/src/pino_kernel/fab.py kernel/tests/test_circuit.py kernel/tests/test_fab.py
git commit -m "kernel: circuit model JSON, placement, findings and fab profiles"
```

---

### Task 5: The board.py library: parts, pins, nets, blocks

**Files:**
- Create: `kernel/src/pino/board.py` (from `spike-schematic:spike/schematic/pinosch/model.py`), `kernel/tests/helpers.py`
- Modify: `kernel/src/pino/__init__.py`
- Test: `kernel/tests/test_pino_parts.py`

**Interfaces:**
- Consumes: `SymbolLibrary` (Task 3), `libraries.discover` (Task 1), circuit types (Task 4).
- Produces:
  - `pino.CircuitError(Exception)` with `.problems: list[Problem]`, `.file`, `.line` (the first problem's); `pino.board.Problem(message: str, file: str | None, line: int | None)`.
  - `Board(name: str, *, layers: int = 2, outline: str | tuple[float, float] | None = None, fab: FabProfile | None = None)`; every `Board()` registers itself in `pino.board._BOARDS` (the runner reads it).
  - `Board.block(key: str, title: str) -> Block`.
  - `Block.path|shunt|tap|across(ref: str, symbol: str, value: str = "", *, footprint: str = "", lcsc: str = "", dnp: bool = False, id: str | None = None) -> Part`.
  - `Part.__getitem__(key: str | int) -> PinSet`, `Part.__getattr__(name) -> PinSet` for pin names (after real attributes), `Part.key` (`id` or ref).
  - `PinSet(tuple[PinRef, ...])`.
  - `Board.net(name, *pins) -> NetSpec`, `Board.supply(name, *pins, external=False, symbol="") -> NetSpec`, `Board.gnd(*pins, external=False, name="GND") -> NetSpec`, `Board.nc(*pins) -> None`, `Board.nc_rest(part) -> list[PinRef]`.
  - `Board.validate() -> None` (raises `CircuitError` with every problem), `Board.to_circuit() -> Circuit` (calls `validate()`).
  - `pino.__init__` exports `Board, Block, Part, PinSet, CircuitError`.
  - `tests/helpers.py`: `small_board() -> pino.Board` (fixture libs: CONN_VBUS J1 to LDO3 U1 to IC6 U2, caps, an LED with its resistor; validated and complete) used by later tasks.

- [x] **Step 1: Write the failing tests**

```python
def test_pin_name_gives_every_pad(fixture_libs):
    j = Board("t", outline=(20, 20)).block("p", "P").path("J1", "pino_test:CONN_VBUS", footprint="pino_test:USB_Edge")
    assert len(j["VBUS"]) == 4 and j.VBUS == j["VBUS"] and j[5] == (PinRef("J1", "5"),)

def test_unknown_pin_names_the_line(fixture_libs):
    r = Board("t", outline=(20, 20)).block("p", "P").path("R1", "pino_test:R", footprint="pino_test:R_0603")
    with pytest.raises(CircuitError) as e:
        r["X"]; line = inspect.currentframe().f_lineno
    assert "R1: no pin 'X' in pino_test:R" in str(e.value)
    assert e.value.file.endswith("test_pino_parts.py") and e.value.line == line

def test_duplicate_ref_and_id(fixture_libs): ...   # second "R1" -> "ref R1 used twice"; second id="a" -> "id 'a' used twice"
def test_ref_must_look_like_a_ref(fixture_libs): ... # "r1", "#PWR1", "U" -> CircuitError "ref 'r1' ..."

def test_net_names_kicad_can_carry(fixture_libs):
    for bad in ("A B", "A/B", "~A", "Net-(R1-1)", "{x}", ""):
        with pytest.raises(CircuitError, match="net name"):
            small_board().net(bad, ...)                  # any two free pins

def test_validate_collects_every_problem(fixture_libs):
    b = small_board_without_led_nets()                  # helper variant: D1's two pins left on no net
    with pytest.raises(CircuitError) as e: b.validate()
    assert len(e.value.problems) == 2 and all(p.line for p in e.value.problems)

def test_shunt_needs_one_ground_pin(fixture_libs): ...      # message "C1: a shunt has exactly one pin on GND"
def test_one_pin_net_needs_external(fixture_libs): ...      # "net VBUS_IN has only 1 pin"
def test_stacked_pins_on_different_nets(fixture_libs): ...
def test_supply_needs_a_power_symbol(fixture_libs): ...     # b.supply("VFOO", ...) -> "no power symbol power:VFOO; pass symbol="
def test_part_needs_a_footprint(fixture_libs): ...          # symbol without Footprint property and no footprint= -> "J1 has no footprint: pass footprint="

def test_nc_rest_is_recorded(fixture_libs):
    c = small_board().to_circuit()
    assert c.nc_rest == {"U2": ["5"]}                    # IO3 left open by nc_rest in the helper

def test_id_keeps_the_key_across_a_rename(fixture_libs):
    assert small_board(led_ref="D9", led_id="status").to_circuit().part("D9").key == "status"

def test_to_circuit_is_deterministic(fixture_libs):
    assert small_board().to_circuit().to_json() == small_board().to_circuit().to_json()
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_pino_parts.py -v`
Expected: FAIL with `ImportError: cannot import name 'Board' from 'pino'`

- [x] **Step 3: Write `pino/board.py`**

- Keep the spike's rules: role as method name; every pin on a net or no-connect; stacked pins on different nets are an error; `external=True` is explicit; no automatic PWR_FLAG.
- Line capture: each public call records the first stack frame whose file is outside the `pino` package (`sys._getframe` walk); stored as `line` on specs and on `Problem`. `file` is the frame's filename.
- Ref pattern `^[A-Z][A-Z_]*[0-9]+$`. Net name pattern `^[A-Za-z0-9_+.\-]+$`, and names starting `Net-(` or `unconnected-(` are refused.
- Symbols are loaded through one `SymbolLibrary(discover().symbols)` per process, cached on the `Libraries` value.
- `nc_rest` returns what it marked and `to_circuit` stores it in `Circuit.nc_rest` so the build can list it.
- Placement, outline, keep-outs, zones, net classes and expects come in Task 6; `to_circuit` fills them with empty values for now, and `outline` is required (a missing one is a validate problem: "Board needs an outline: pass outline='outline.json' or outline=(width, height)"). A tuple outline becomes a rounded rectangle with 1 mm corners through Task 6's `outline.rectangle`; until then the tuple only stores width and height.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_pino_parts.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino kernel/tests/helpers.py kernel/tests/test_pino_parts.py
git commit -m "pino: board.py library with parts by symbol and footprint, pins, nets and blocks"
```

> **Plan fix (Task 5, during the build):** `test_unknown_pin_names_the_line` as written could never pass: `r["X"]` raises
> before `line = ...` runs on the same line. The test takes the line number first (`f_lineno + 2`) and then calls `r["X"]`.

---

### Task 6: The board.py library: placement intent, outline.json, keep-outs, zones, net classes, assertions

**Files:**
- Create: `kernel/src/pino_kernel/outline.py` (ports `outline_points`, `boss_notch`, `_mirror_items` from pcb-kit `pcbkit/mech.py`, with the MIT header), `kernel/tests/fixtures/outline/enclosure.json`
- Modify: `kernel/src/pino/board.py`, `kernel/src/pino/__init__.py`
- Test: `kernel/tests/test_outline.py`, `kernel/tests/test_pino_intent.py`

**Interfaces:**
- Consumes: Task 4 types, Task 5 `Board`.
- Produces:
  - `outline.OutlineError(ValueError)`, `outline.outline_points(w, h, r, notches=None, cutouts=None) -> list[tuple]` (raises `OutlineError` where pcb-kit raised `SystemExit`), `outline.load_outline(path: Path) -> OutlineSpec`, `outline.rectangle(width, height, corner=1.0) -> OutlineSpec`, `outline.polygon(spec: OutlineSpec, chord=0.1) -> list[tuple[float, float]]`, `outline.outline_keepouts(path) -> list[Keepout]`.
  - `outline.json` keys read: `board.width`, `board.height`, `board.corner_radius`, `board.notches`, `board.cutouts`, `mounts[] {x, y, hole, boss, name, head}`, `keepouts[] {x, y, d, what}`, and pino's own optional `height_limit {top, bottom}` (kept, not checked in this stage). `name`, `notes`, `origin`, `drawings` are ignored. Mount courtyard diameter is `max(boss, head)`, default `hole + 2`. A keep-out circle grows by 0.5 mm (as pcb-kit), forbids everything, on all copper layers.
  - `Board.place(target: Part | Group, *, edge=None, center=False, along=None, near=None, side=None, at=None, rot=None, back=False) -> None` (`edge`, `side` in `top|bottom|left|right`; `along` mm from the edge's centre, positive right or up; `center=True` means `along=0`).
  - `Board.group(name: str, *parts: Part) -> Group`.
  - `Board.keepout(*, region, layers="all", why="", forbid=("tracks", "vias", "pads", "copperpour", "footprints")) -> None` (`region` is `(x0, y0, x1, y1)` or a list of points, board mm).
  - `Board.zone(net: str | NetSpec, *, layer: str, region=None) -> None`.
  - `Board.net_class(name: str, nets: Sequence[str | NetSpec], *, width: float, clearance: float | None = None, via_diameter: float | None = None, via_drill: float | None = None) -> None` (unset values take the fab profile's minimums, via 0.6/0.3).
  - `Board.expect_path(a, b, *, through: Sequence[Part] = ()) -> None`, `Board.expect_apart(a, b) -> None`.
  - `pino.fab` is `pino_kernel.fab`; `pino` exports `Group`.

- [x] **Step 1: Write the failing tests**

```python
# test_outline.py
def test_rounded_rectangle_is_closed():
    segs = outline_points(40, 30, 2)
    assert [s[0] for s in segs].count("arc") == 4 and len(segs) == 8
    ends = [s[-1] for s in segs]; starts = [s[1] for s in segs]
    assert all(math.dist(e, s) < 1e-6 for e, s in zip(ends, starts[1:] + starts[:1]))

def test_load_keeps_y_up_and_reads_mounts():
    spec = load_outline(FIXTURES / "outline/enclosure.json")       # 56 x 44, a notch at +x+y, 4 mounts
    assert (spec.width, spec.height) == (56, 44)
    assert [(h.name, h.x, h.y, h.drill) for h in spec.holes][0] == ("H1", -24.5, 18.5, 3.2)
    assert spec.height_limit == {"top": 12.0, "bottom": 3.0}

def test_cutout_that_does_not_fit():
    with pytest.raises(OutlineError, match="does not fit"):
        outline_points(20, 20, 1, cutouts=[{"x": 9.5, "y": 9.5, "boss": 6}])

# test_pino_intent.py
def test_edge_intent_is_recorded(fixture_libs):
    b = small_board(); b.place(b.part("J1"), edge="bottom", center=True)
    assert b.to_circuit().intents[0] == Intent("J1", "bottom", 0.0, None, None, None, None, False, ANY_LINE)

def test_conflicting_intent(fixture_libs):
    for kw in ({"edge": "bottom", "at": (0, 0)}, {"near": "x", "at": (0, 0)}, {"side": "top"}, {"edge": "north"}, {"center": True}):
        with pytest.raises(CircuitError): small_board().place(..., **kw)     # side without near, center without edge

def test_place_twice(fixture_libs): ...          # "J1 is placed twice (lines 12 and 14)"
def test_outline_path_is_relative_to_board_py(tmp_path, fixture_libs): ...
def test_keepout_rectangle_becomes_a_polygon(fixture_libs):
    b = small_board(); b.keepout(region=(0, 0, 10, 6), why="antenna")
    assert b.to_circuit().keepouts[0].polygon == [(0, 0), (10, 0), (10, 6), (0, 6)]

def test_net_class_with_unknown_net(fixture_libs): ...     # "net class power names VBUSS, which is no net"
def test_zone_layer_must_exist(fixture_libs): ...          # layer "In1.Cu" on 2 layers -> "this board has no In1.Cu"
def test_layers_and_fab_must_agree(fixture_libs): ...      # layers=3 -> error; layers=2, fab=jlc_standard_4layer -> error
def test_expect_path_records_pins(fixture_libs):
    b = small_board(); j1, u1 = b.part("J1"), b.part("U1")
    b.expect_path(j1["VBUS"], u1["VIN"])
    e = b.to_circuit().expects[0]
    assert e.kind == "path" and e.a == [PinRef("J1", n) for n in "1234"] and e.b == [PinRef("U1", "1")]
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_outline.py tests/test_pino_intent.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.outline'`

- [x] **Step 3: Write `outline.py` and extend `pino/board.py`**

Port `outline_points` and its two helpers unchanged in logic. `Board.part(ref) -> Part` is added for tests and helpers. All intent and rule checks that need the whole board (unknown nets in a class, missing outline) run in `validate()`; argument checks raise at the call.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_outline.py tests/test_pino_intent.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino kernel/src/pino_kernel/outline.py kernel/tests/fixtures/outline kernel/tests/test_outline.py kernel/tests/test_pino_intent.py
git commit -m "pino: placement intent, outline.json, keep-outs, zones, net classes and expect_path"
```

> **Plan fix (Task 6, during the build):** `test_cutout_that_does_not_fit` used a boss at (9.5, 9.5) on a 20 x 20 board,
> which pcb-kit's rule accepts (the cut stays inside the board). The test uses a boss at (2, 2), whose cut reaches past
> the board's centre lines. Keep-out layers "all" are stored as `["*.Cu"]` and expanded by the board writer.

---

### Task 7: Run board.py in a child process

**Files:**
- Create: `kernel/src/pino_kernel/runner.py`, `kernel/src/pino_kernel/run_board.py`
- Test: `kernel/tests/test_run_board.py`

**Interfaces:**
- Consumes: `pino.board._BOARDS`, `Board.to_circuit()`, `CircuitError.problems`, `Libraries`.
- Produces:
  - Child: `python -I -m pino_kernel.runner <board.py>`; prints exactly one JSON object on the real stdout: `{"ok": true, "circuit": {...}}` or `{"ok": false, "problems": [{"message", "file", "line"}]}`. `board.py`'s own prints go to stderr.
  - Parent: `RunResult(circuit: Circuit | None, problems: list[Problem], log: str, seconds: float)`; `run_board(project: Path, *, libraries: Libraries, timeout: float = 30.0, python: str = sys.executable) -> RunResult`. `log` is the child's stderr, last 4000 characters. Problem files are relative to the project when inside it.

- [x] **Step 1: Write the failing tests**

```python
def test_good_board(make_project, fixture_libs):
    r = run_board(make_project(SMALL_BOARD_PY), libraries=fixture_libs)
    assert r.problems == [] and r.circuit.parts[0].ref == "J1"

def test_syntax_error_has_file_and_line(make_project, fixture_libs):
    r = run_board(make_project("from pino import Board\n\nb = Board(\n"), libraries=fixture_libs)
    assert r.circuit is None and r.problems[0].file == "board.py" and r.problems[0].line == 3
    assert r.problems[0].message.startswith("SyntaxError")

def test_exception_points_at_board_py_line(make_project, fixture_libs):
    r = run_board(make_project("x = 1\ny = 2\nz = 1 / 0\n"), libraries=fixture_libs)
    assert (r.problems[0].line, r.problems[0].message) == (3, "ZeroDivisionError: division by zero")

def test_circuit_errors_keep_their_lines(make_project, fixture_libs): ...   # two validate problems -> two problems with lines
def test_no_board_and_two_boards(make_project, fixture_libs): ...          # "board.py made no Board" / "board.py made 2 Boards; pino builds one"

def test_hang_is_stopped(make_project, fixture_libs):
    t = time.monotonic()
    r = run_board(make_project("while True:\n    pass\n"), libraries=fixture_libs, timeout=1.0)
    assert r.problems[0].message == "board.py did not finish in 1 s" and time.monotonic() - t < 5

def test_prints_do_not_break_the_result(make_project, fixture_libs):
    r = run_board(make_project('print("hello")\n' + SMALL_BOARD_PY), libraries=fixture_libs)
    assert r.circuit is not None and "hello" in r.log

def test_board_py_imports_a_sibling_module(make_project, fixture_libs):
    project = make_project("from helpers_here import VALUE\nopen('note.txt').read()\n" + SMALL_BOARD_PY.replace('"10k"', "VALUE"),
                           extra={"helpers_here.py": 'VALUE = "4.7k"\n', "note.txt": "x"})
    assert run_board(project, libraries=fixture_libs).circuit.part("R1").value == "4.7k"
```

`make_project(board_py: str, extra: dict[str, str] = {}, outline: str | None = None) -> Path` (conftest) writes a project folder in `tmp_path`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_run_board.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.run_board'`

- [x] **Step 3: Write the runner and the parent**

- Child: dup the real stdout, point `sys.stdout` at stderr, put the project folder at `sys.path[0]`, `os.chdir` to it, `runpy.run_path(board.py, run_name="__main__")`, then take the single board from `_BOARDS` and print `to_circuit().to_json()` wrapped as above. Map `SyntaxError` to its `lineno`; any other exception to the innermost traceback frame inside the project folder.
- Parent: environment = `PATH`, `HOME`, `LANG`, `PYTHONHASHSEED=0` and the three `PINO_KICAD_*_DIR` values from `libraries`; `cwd=project`; `start_new_session=True`; on timeout kill the child's process group only. Output that is not one JSON object becomes the problem "board.py stopped the engine's runner: <last stderr line>".

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_run_board.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/runner.py kernel/src/pino_kernel/run_board.py kernel/tests/test_run_board.py kernel/tests/conftest.py
git commit -m "kernel: run board.py in a child process with a timeout and errors by line"
```

---

### Task 8: Schematic writer and the netlist gate

**Files:**
- Create: `kernel/src/pino_kernel/schematic/__init__.py`, `canvas.py` (from `pinosch/canvas.py`), `layout.py` (from `pinosch/layout.py`), `writer.py` (from `pinosch/writer.py`), `kernel/src/pino_kernel/checks/__init__.py`, `checks/netlist.py` (from `pinosch/check.py`)
- Test: `kernel/tests/test_schematic_writer.py`, `kernel/tests/test_netlist_check.py`, `kernel/tests/schematic_cases.py` (the seven circuits from `spike-schematic:spike/schematic/stress.py`, rebuilt on the `pino` API)

**Interfaces:**
- Consumes: `Circuit` (Task 4), `SymbolLibrary` (Task 3), `ids` (Task 1), `KicadCli` (Task 2, kicad tests only).
- Produces:
  - `SchematicFiles(kicad_sch: str, sym_lib_table: str, fp_lib_table: str, canvas: Canvas, paper: str)`.
  - `layout.layout_sheet(circuit: Circuit, symbols: SymbolLibrary) -> tuple[Canvas, str]`.
  - `writer.write_schematic(circuit: Circuit, symbols: SymbolLibrary) -> SchematicFiles`; `writer.DrawingError(Exception)`; `writer.symbol_boxes(canvas: Canvas) -> list[dict]` (`{ref, x0, y0, x1, y1, pins: [{number, x, y}]}` in sheet mm, for the views stage).
  - `checks.netlist.Netlist(comps: dict, nets: dict[str, frozenset[tuple[str, str]]])`, `read_netlist(path: Path) -> Netlist`, `compare(circuit: Circuit, netlist: Netlist) -> list[Finding]` (source `netlist`, code `netlist_mismatch`, error), `net_names(circuit, netlist) -> list[Finding]` (source `netlist`, code `net_name`, warning: "net LED_A exports as Net-(D1-A)").

- [x] **Step 1: Write the failing tests**

```python
def test_same_bytes_in_two_processes(fixture_libs, tmp_path):
    digests = {seed: run_writer_in_subprocess(seed, tmp_path) for seed in ("1", "98765")}
    assert digests["1"] == digests["98765"]

def test_symbol_uuid_follows_key(fixture_libs):
    sch = parse(write(small_board(led_id="status")).kicad_sch)
    uuids = {find(s, "property")[2]: find(s, "uuid")[1] for s in find_all(sch, "symbol")}
    assert uuids["R1"] == ids.symbol_uuid("R1") and uuids["D1"] == ids.symbol_uuid("status")

def test_no_uuid_twice(fixture_libs): ...                  # every (uuid …) value in the file is unique
def test_every_named_signal_net_has_a_global_label(fixture_libs):
    files = write(small_board())
    labelled = {lab.net for lab in files.canvas.labels if lab.is_global}
    assert {n.name for n in small_board().to_circuit().nets if n.kind == "signal"} <= labelled

def test_canvas_pins_carry_the_model_nets(fixture_libs): ...  # every canvas pin's net == circuit.net_of(ref, number).name
def test_a_short_is_refused():
    cv = canvas_with_two_nets_meeting()
    with pytest.raises(DrawingError, match=r"nets \['A', 'B'\] meet at"): writer.connect(cv)

def test_unicode_value_is_written_as_utf8(fixture_libs):
    text = write(small_board(cap_value="4.7µF")).kicad_sch
    assert '"4.7µF"' in text

def test_lib_tables_use_path_variables(fixture_libs):
    f = write(small_board())
    assert '"${KICAD10_SYMBOL_DIR}/pino_test.kicad_sym"' in f.sym_lib_table
    assert '"${KICAD10_FOOTPRINT_DIR}/pino_test.pretty"' in f.fp_lib_table

# test_netlist_check.py: hand-written kicadxml fixtures
def test_renamed_net_still_matches(): ...                      # same pins under another name -> compare() == []
def test_right_names_wrong_pins_fail():
    # lesson from an earlier board: "a check that matches nets by label name passed a wrong join once"
    found = compare(circuit, read_netlist(FIX / "swapped.xml"))     # CC1 and CC2 joined under the name CC1
    assert any(f.code == "netlist_mismatch" and "CC1" in f.message for f in found)
def test_exported_names_are_checked_apart(): ...               # net_names() warns on Net-(D1-A), compare() still passes

@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
@pytest.mark.parametrize("case", schematic_cases.ALL)
def test_kicad_netlist_matches_intent(case, kicad, tmp_path):
    c = case().to_circuit(); out = write_project(c, tmp_path)        # sch + lib tables
    kicad.netlist(out / "board.kicad_sch", out / "netlist.xml")
    n = read_netlist(out / "netlist.xml")
    assert compare(c, n) == [] and net_names(c, n) == []

@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_probe_pin_positions(kicad, tmp_path): ...   # port of spike probe.py: 12 poses of AP2112K-3.3; 48/48 pins land where computed; field justify drawn on the side asked

@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_kicad_resave_keeps_uuids(kicad, tmp_path): ...  # sch_upgrade; every symbol and pin uuid survives; netlist still matches
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_schematic_writer.py tests/test_netlist_check.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.schematic'`

- [x] **Step 3: Port the spike's layout and writer onto `Circuit`**

- The layout reads `Circuit` (parts, blocks, `net_of`) and `SymbolLibrary`, not the spike's `model.Board`. Every S-expression uses `Sym`/`str` from Task 1.
- UUIDs: symbol `ids.symbol_uuid(part.key)`, pins `ids.uid("pin", key, number)`, sheet `ids.sheet_uuid()`, power symbols, labels, wires, junctions, no-connects and frames `ids.uid("sch", <kind>, <spike key parts>)`. The board name appears only in the title block.
- `instances` use project name `board`.
- Net names: every signal net gets at least one global label. Where the layout drew a net only as wire, add a global label on a two-grid stub from the net's first wire end that has room; the drawing check (`connect`) must still pass. Power nets keep power symbols.
- Keep the spike's field-justify rule, its geometry check (`connect`), and `nc_rest` behaviour.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_schematic_writer.py tests/test_netlist_check.py -v`
Expected: PASS (kicad tests pass, or skip with the marker messages)

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/schematic kernel/src/pino_kernel/checks kernel/tests/test_schematic_writer.py kernel/tests/test_netlist_check.py kernel/tests/schematic_cases.py kernel/tests/fixtures
git commit -m "kernel: schematic writer with stable UUIDs and a pin-based netlist gate"
```

---

### Task 9: Schematic readability: lint with positions and the weak layout cases

**Files:**
- Create: `kernel/src/pino_kernel/schematic/lint.py` (from `pinosch/lint.py`)
- Modify: `kernel/src/pino_kernel/schematic/layout.py`
- Test: `kernel/tests/test_schematic_lint.py`

**Interfaces:**
- Consumes: `Canvas`, `Circuit`, `SymbolLibrary`.
- Produces: `lint(canvas: Canvas, circuit: Circuit, symbols: SymbolLibrary) -> list[Finding]`; source `lint`, severity `warning`, codes `overlap`, `wire_through`, `crossing`, `direction`, `blocks_overlap`; `at` is `At("sheet", x_mm, y_mm)`; `refs` names the parts involved.

- [x] **Step 1: Write the failing tests**

```python
def test_clean_board_has_no_findings(fixture_libs):
    c = small_board().to_circuit(); cv, _ = layout_sheet(c, syms())
    assert lint(cv, c, syms()) == []

def test_findings_carry_sheet_positions(fixture_libs):
    found = lint(canvas_with_overlap(), circuit, syms())
    assert found[0].code == "overlap" and found[0].at.space == "sheet" and found[0].at.x > 0

def test_frames_are_sized_per_block(fixture_libs):
    cv, _ = layout_sheet(three_block_board().to_circuit(), syms())
    heights = {f.key: f.box[3] - f.box[1] for f in cv.frames}
    assert heights["reg"] < heights["mcu"]

def test_satellites_follow_their_ic_pins(fixture_libs):
    # three decoupling caps on U2's VDD, IO1, IO2 nets, declared in reverse order
    cv, _ = layout_sheet(caps_reversed_board().to_circuit(), syms())
    assert order_of_clusters(cv) == order_of_hub_pins(cv, "U2")

def test_one_more_path_part_keeps_the_arrangement(fixture_libs):
    before = arrangement(layout_sheet(board_with_paths(2).to_circuit(), syms())[0], "mcu")
    after = arrangement(layout_sheet(board_with_paths(3).to_circuit(), syms())[0], "mcu")
    assert before == after                                      # "below" or "right", never flips

@pytest.mark.kicad_libs
def test_mosfet_in_a_path_is_a_lint_finding():
    c = schematic_cases.mosfet_in_path().to_circuit(); syms = SymbolLibrary(discover().symbols)
    assert any(f.code == "direction" for f in lint(layout_sheet(c, syms)[0], c, syms))
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_schematic_lint.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.schematic.lint'`

- [x] **Step 3: Write the lint and the three layout fixes**

- Lint: the spike's rules, each finding with a sheet position in mm (the centre of the overlap, the crossing point, the symbol origin) and the refs involved.
- Frames: each frame takes its own block's height; frames in one row share their top edge.
- Satellites: clusters are ordered by the position of the hub pin they share a net with (top to bottom for columns, left to right for rows); clusters with no hub pin keep declaration order after them.
- Arrangement: "clusters below" when the block's largest path part has at most `SMALL_HUB` (8) pins, "columns to the right" otherwise. The spike's `right < 90 and len(paths) < 3` threshold is removed.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_schematic_lint.py tests/test_schematic_writer.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/schematic kernel/tests/test_schematic_lint.py
git commit -m "kernel: schematic lint with positions; frames per block, satellites by pin"
```

---

### Task 10: Footprint loader, geometry and 3D model check

**Files:**
- Create: `kernel/src/pino_kernel/pcb/__init__.py`, `pcb/footprint.py` (from `spike-board-writer:spike/board_writer/board_writer/footprint.py`), `kernel/src/pino_kernel/geometry.py`, `kernel/tests/fixtures/libs/footprints/pino_test.pretty/*.kicad_mod`, `kernel/tests/fixtures/libs/3dmodels/pino_test.3dshapes/R_0603.step`
- Test: `kernel/tests/test_footprint.py`, `kernel/tests/test_geometry.py`

**Interfaces:**
- Consumes: `Libraries`, `ids`, `coords`, `sexpr`, `Finding`.
- Produces:
  - `geometry`: `Point = tuple[float, float]`, `Polygon = list[Point]`, `bbox(poly)`, `point_in_polygon(p, poly) -> bool`, `polygons_overlap(a, b) -> bool` (interiors meet; touching edges do not count), `inside(poly, container) -> bool`, `distance_to_edges(p, poly) -> float`, `arc_points(start, mid, end, chord=0.1) -> list[Point]`, `circle_polygon(cx, cy, r, n=48) -> Polygon`.
  - `FootprintNotFound(KeyError)`.
  - `Footprint(lib_id, node: list, pads: list[LocalPad], courtyard: dict[str, list[Polygon]], models: list[str], edge_face: str, keepouts: list[Polygon])`; `courtyard` keyed `"F"`/`"B"` in local coordinates; `edge_face` in `top|bottom|left|right` (local).
  - `FootprintLibrary(libraries: Libraries)` with `load(lib_id) -> Footprint`, `model_exists(path: str) -> bool`, `source_digest(lib_id) -> str`.
  - `Placed(ref, key, footprint: Footprint, x, y, rot, back, value, pad_nets: dict[str, str], dnp: bool, lcsc: str)`; `x`, `y` in board mm.
  - `place(p: Placed, *, copper_layers: list[str]) -> list` (the board S-expression, KiCad save order), `pad_world(p) -> list[Pad]` (`Pad(number, x, y, layers, net, through: bool)` in board mm), `courtyard_world(p) -> dict[str, list[Polygon]]` (side `"F"`/`"B"`, board mm, through-hole parts on both sides).
  - `model_findings(placed: list[Placed], lib: FootprintLibrary) -> list[Finding]` (source `model3d`, code `model3d_missing` warning with the unresolved path, `model3d_none` info).
  - `pin_pad_findings(circuit: Circuit, lib: FootprintLibrary) -> list[Finding]` (source `pads`: a pin with no pad is an error; a numbered pad with no pin is a warning; pads numbered `""` are mechanical and ignored).

- [x] **Step 1: Write the fixture footprints and the failing tests**

Hand-written footprints in `pino_test.pretty`: `R_0603` (pads 1 at (-0.8, 0) and 2 at (0.8, 0), courtyard rect (-1.5, -0.75)-(1.5, 0.75), model `${KICAD10_3DMODEL_DIR}/pino_test.3dshapes/R_0603.step`, two drawings that carry library UUIDs), `R_0603_oneline` (the same, on one line), `C_0603`, `LED_0603` (model path that does not exist), `SOT23` (3 pads), `SOIC6`, `USB_Edge` (5 pads, a `"PCB Edge"` text on Dwgs.User at local y = +3), `MODULE_ANT` (6 pads, a keep-out zone at local y < 0 whose `layers` list F.Cu, B.Cu and In1.Cu to In30.Cu), `PIN_TH` (one through-hole pad).

```python
def test_pads_rotate_counter_clockwise(fp_lib):
    pads = {p.number: (p.x, p.y) for p in pad_world(Placed("R1", "R1", fp_lib.load("pino_test:R_0603"), 10, 5, 90, False, "10k", {}, False, ""))}
    assert pads["1"] == pytest.approx((10.0, 4.2)) and pads["2"] == pytest.approx((10.0, 5.8))

def test_back_side_mirrors_local_y(fp_lib): ...       # asymmetric fixture pad at local (1.0, 0.5): front -> (1.0, -0.5), back -> (1.0, 0.5)
def test_library_uuids_are_replaced(fp_lib):
    a = place(placed("R1"), copper_layers=CU2); b = place(placed("R2"), copper_layers=CU2)
    ua, ub = uuids_in(a), uuids_in(b)
    assert not ua & ub and not ua & LIBRARY_UUIDS and len(ua) == len(set(ua))

def test_path_is_the_symbol_uuid(fp_lib):
    assert find(place(placed("R1", key="pullup"), copper_layers=CU2), "path")[1] == ids.footprint_path("pullup")

def test_datasheet_and_description_are_written(fp_lib): ...
def test_one_line_footprint_loads_like_the_formatted_one(fp_lib):
    a, b = fp_lib.load("pino_test:R_0603"), fp_lib.load("pino_test:R_0603_oneline")
    assert a.pads == b.pads and a.courtyard == b.courtyard

def test_edge_face(fp_lib):
    assert fp_lib.load("pino_test:USB_Edge").edge_face == "bottom"
    assert fp_lib.load("pino_test:MODULE_ANT").edge_face == "top"
    assert fp_lib.load("pino_test:R_0603").edge_face == "bottom"

def test_courtyard_turns_with_the_part(fp_lib):
    assert bbox(courtyard_world(placed("R1", x=0, y=0, rot=90))["F"][0]) == pytest.approx((-0.75, -1.5, 0.75, 1.5))

def test_through_hole_courtyard_counts_on_both_sides(fp_lib): ...
def test_model_check(fp_lib):
    found = model_findings([placed("R1"), placed("D1", lib_id="pino_test:LED_0603")], fp_lib)
    assert [(f.code, f.refs) for f in found] == [("model3d_missing", ("D1",))]

def test_pin_without_pad_is_an_error(fixture_libs, fp_lib): ...
# test_geometry.py
def test_touching_squares_do_not_overlap(): ...
def test_l_shape_containment(): ...                  # a square in the notch of an L is not inside it
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_footprint.py tests/test_geometry.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [x] **Step 3: Port the spike's footprint code**

- Keep the spike's flip, absolute pad and text angles, pad option order, KiCad drawing order (`drawing_key`), library-UUID stripping and `Datasheet`/`Description` properties. The footprint UUID is `ids.footprint_uuid(key)`; item UUIDs `ids.uid("footprint", key, str(child_index), kind)`; `(path …)` is `ids.footprint_path(key)`, `(sheetname "/")`, `(sheetfile "board.kicad_sch")`.
- The placed position goes through `coords.to_kicad`; pad and courtyard results come back in board mm.
- Footprint-owned zones: keep only layers in `copper_layers`; write their polygon in the form KiCad's re-save keeps unchanged (Task 11's `test_footprint_zone_survives_kicad_resave` decides between board and local coordinates; start with board coordinates after rotation, flip and translation).
- `edge_face`: the side of the footprint's bounding box where a footprint-owned keep-out zone lies; else the side of a `"PCB Edge"` text on Dwgs.User; else `bottom` (KiCad's connector convention: mating face toward local +y).
- `model_exists`: replace `${KICAD10_3DMODEL_DIR}`, `${KICAD9_3DMODEL_DIR}`, `${KICAD8_3DMODEL_DIR}`, `${KICAD7_3DMODEL_DIR}` and `${KICAD6_3DMODEL_DIR}` with `libraries.models`; true when that file, or the same stem with `.step`, `.stp` or `.wrl`, exists.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_footprint.py tests/test_geometry.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/pcb kernel/src/pino_kernel/geometry.py kernel/tests/fixtures/libs kernel/tests/test_footprint.py kernel/tests/test_geometry.py
git commit -m "kernel: footprint loader with library roots, edge face and 3D model check"
```

---

### Task 11: Board writer: stackup, outline, holes, zones, keep-outs, net classes, fab rules

**Files:**
- Create: `kernel/src/pino_kernel/pcb/writer.py` (from `spike-board-writer:spike/board_writer/board_writer/board.py`), `pcb/stackup.py`, `pcb/rules.py`, `kernel/tests/semdiff.py` (from `spike-board-writer:spike/board_writer/semdiff.py`, as a function)
- Test: `kernel/tests/test_board_writer.py`

**Interfaces:**
- Consumes: `Circuit`, `Placement` (Task 4), `FootprintLibrary`, `place`, `Placed` (Task 10), `FabProfile`, `outline.polygon`.
- Produces:
  - `BoardFiles(kicad_pcb: str, kicad_pro: str, kicad_dru: str, placed: list[Placed])`.
  - `write_board(circuit: Circuit, placement: Placement, footprints: FootprintLibrary) -> BoardFiles`.
  - `stackup.stackup(layers: int, fab: FabProfile) -> list`, `rules.kicad_pro(circuit: Circuit, fab: FabProfile) -> str`, `rules.kicad_dru(fab: FabProfile) -> str`.
  - `copper_layers(n: int) -> list[tuple[int, str]]` (F.Cu 0, In1.Cu 4, In2.Cu 6, B.Cu 2).
  - `tests/semdiff.py`: `changed_items(a_text: str, b_text: str) -> list[tuple[str, str]]` (top-level `(kind, uuid)` pairs that differ, order ignored).

- [x] **Step 1: Write the failing tests**

```python
def test_same_bytes_twice_and_across_hash_seeds(fixture_libs, tmp_path): ...   # sha256 equal; subprocess with PYTHONHASHSEED 1 and 98765
def test_no_uuid_twice(fixture_libs): ...
def test_copper_layers(fixture_libs):
    two, four = layers_of(write(small_board(layers=2))), layers_of(write(small_board(layers=4)))
    assert two == [(0, "F.Cu"), (2, "B.Cu")] and four == [(0, "F.Cu"), (4, "In1.Cu"), (6, "In2.Cu"), (2, "B.Cu")]

def test_stackup_adds_up_to_board_thickness(fixture_libs):
    for n in (2, 4):
        assert sum(thicknesses(write(small_board(layers=n)))) == pytest.approx(1.6, abs=0.01)

def test_pad_nets_come_from_the_circuit(fixture_libs): ...      # U1 pad 1 has (net "VBUS")
def test_holes_are_board_only_npth(fixture_libs):
    fp = footprint_named(write(small_board(outline=FIXTURES / "outline/enclosure.json")), "H1")
    assert find(fp, "attr")[1:] == ["board_only", "exclude_from_pos_files", "exclude_from_bom"]
    assert find(find(fp, "pad"), "drill")[1] == "3.2" and find(fp, "pad")[2] == "np_thru_hole"

def test_keepout_is_a_rule_area(fixture_libs): ...              # zone with (keepout (tracks not_allowed) … (footprints not_allowed)), polygon in KiCad frame
def test_fill_zone_covers_the_outline(fixture_libs): ...        # b.zone("GND", layer="B.Cu") -> zone on B.Cu, net GND, polygon = outline polygon
def test_net_class_in_kicad_pro(fixture_libs):
    pro = json.loads(write(board_with_power_class()).kicad_pro)
    assert {"netclass": "power", "pattern": "VBUS"} in pro["net_settings"]["netclass_patterns"]
    assert pro["board"]["design_settings"]["rules"]["min_clearance"] == 0.15

def test_dru_carries_the_fab_limits():
    two, four = parse_rules(kicad_dru(fab.jlc_standard_2layer)), parse_rules(kicad_dru(fab.jlc_standard_4layer))
    assert two["track_width"] == "0.15mm" and four["track_width"] == "0.1mm"
    assert set(two) == {"track_width", "clearance", "hole_size", "via_diameter", "annular_width", "hole_to_hole", "edge_clearance", "silk_clearance", "text_height"}

def test_footprint_zone_keeps_only_board_layers(fixture_libs):
    zone = find(footprint_named(write(board_with_module(layers=2)), "U3"), "zone")
    assert find(zone, "layers")[1:] == ["F.Cu", "B.Cu"]

@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
@pytest.mark.parametrize("layers", [2, 4])
def test_kicad_refill_only_adds_fill(layers, kicad, tmp_path):
    # real-library board: SOIC-8, 0603s, one part on the back, rotations 0/90/180, a GND zone, 4 holes, a keep-out
    out = write_real_board(tmp_path, layers); filled = refill_copy(kicad, out)
    assert {k for k, _ in changed_items(out.read_text(), filled.read_text())} == {"zone"}
    assert drc_types(kicad, filled) <= {"unconnected_items"}

@pytest.mark.kicad_cli
def test_dru_is_read(kicad, tmp_path):
    # KiCad ignores a rule file with one bad token; a probe rule proves this one is read
    out = write_real_board(tmp_path, 2, extra_dru='(rule "probe" (constraint edge_clearance (min 50mm)) (condition "A.Type == \'Pad\'"))')
    assert any("probe" in v["description"] for v in drc_json(kicad, out)["violations"])

@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_footprint_zone_survives_kicad_resave(kicad, tmp_path):
    out = write_board_with("RF_Module:ESP32-C6-MINI-1", at=(0, 0), rot=90, tmp_path=tmp_path)
    filled = refill_copy(kicad, out)
    assert zone_polygon(footprint_named_text(out, "U1")) == zone_polygon(footprint_named_text(filled, "U1"))
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_board_writer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.pcb.writer'`

- [x] **Step 3: Write the board writer**

- From the spike: header, layers, setup with `pcbplotparams`, footprints front then back each by UUID, Edge.Cuts drawings by (layer, start, end, uuid), `embedded_fonts no`. No tracks or vias in this stage.
- Outline: `circuit.outline.segments` to `gr_line`/`gr_arc` on Edge.Cuts, stroke 0.05, UUIDs `ids.uid("edge", kind, index)`.
- Holes: one board-only footprint per `Hole` (`lib_id "pino:MountingHole"`, ref = hole name, NPTH pad with size = drill, F.CrtYd and B.CrtYd circles of the courtyard diameter, attr `board_only exclude_from_pos_files exclude_from_bom`).
- Keep-outs: rule-area zones on every copper layer listed, the `forbid` items `not_allowed`, the rest `allowed`, name `keepout:<why or index>`.
- Fill zones: as the spike's `_zone`, polygon = region or the outline polygon, fill not filled.
- Zones in the order KiCad re-saves them (the refill test pins it).
- DNP parts: write the footprint's DNP flag the way KiCad 10 writes it; the refill test includes a DNP part to pin the form.
- `stackup`: KiCad's `(stackup …)` with mask 0.01, outer copper 0.035; 2 layers: core 1.51 FR4; 4 layers (JLC04161H-7628): prepreg 0.2104, inner copper 0.0152, core 1.065, prepreg 0.2104.
- `kicad_pro`: the spike's JSON with rules from the profile and net classes from `circuit.net_classes`; `meta.filename "board.kicad_pro"`.
- `kicad_dru`: `(version 1)` then one rule per limit named `"pino: <limit>"` with the profile's values in mm (`edge_clearance` = `copper_to_edge`, `text_height` = `silk_min_text_height`, `silk_clearance` 0).

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_board_writer.py -v`
Expected: PASS (kicad tests pass, or skip with the marker messages)

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/pcb kernel/tests/semdiff.py kernel/tests/test_board_writer.py
git commit -m "kernel: board writer with stackups, outline, holes, zones, net classes and JLC rules"
```

> **Plan fixes (Task 11, during the build), each found by the refill test against kicad-cli 10.0.6:**
> - Footprint-owned zones: board coordinates (after rotation, flip and translation) are what KiCad's re-save keeps;
>   `test_footprint_zone_survives_kicad_resave` passes with them and with `(layers "F.Cu" "B.Cu")` written as a list.
> - Edge.Cuts arcs: KiCad keeps arcs turning one way in its y-down frame and swaps the ends of the others, so the
>   writer swaps start and end when the cross product in KiCad's frame is negative.
> - `drc --save-board` stores every `-D` variable as a board `(property ...)`. A saving run passes the library paths
>   through the environment only.
> - Mounting holes use the footprint name `"MountingHole"` with no library nickname (KiCad's library check reports
>   `"pino:MountingHole"` as a missing library).
> - `.kicad_dru`: `silk_clearance` with no condition also matches silk against copper zones, and `text_height` against
>   fab-layer text, so both rules carry a silkscreen condition.
> - An unrouted board's GND zone with no through-hole pad is `isolated_copper` (warning); the refill test allows it.

---

### Task 12: Ratsnest scorer, ported from pcb-kit

**Files:**
- Create: `kernel/src/pino_kernel/placement/__init__.py`, `placement/ratsnest.py` (ports `WEIGHTS`, `mst`, `edge`, `net_edges`, `length`, `_segx`, `_bbox`, `crosses`, `EdgeIndex`, `count_among`, `_meet_point` from pcb-kit `pcbkit/placement.py`, MIT header; drop everything that needs pcbnew, the study loader and the SVG drawing)
- Test: `kernel/tests/test_ratsnest.py`

**Interfaces:**
- Produces:
  - `WEIGHTS = {"cross": 10.0, "length": 0.2}`.
  - `PadPoint(x: float, y: float, side: str, ref: str, number: str)` (side `F`, `B` or `X` for through-hole).
  - `Edge = tuple[str, tuple[float, float], tuple[float, float], str]` (net, a, b, side), as pcb-kit.
  - `ratsnest(nets: Mapping[str, Sequence[PadPoint]], planes: Collection[str] = ()) -> list[Edge]`.
  - `Score(crossings: int, length: float, total: float, points: list[tuple[float, float]])`; `score(nets, planes=(), weights=WEIGHTS, any_side=False) -> Score` with `total = cross * crossings + length_weight * length`.

- [x] **Step 1: Write the failing tests**

```python
def test_mst_of_a_square():
    pts = [(0, 0), (10, 0), (10, 10), (0, 10)]
    assert len(mst(pts)) == 3 and length(net_edges("N", [(*p, "F", "R", "1") for p in pts])) == pytest.approx(30)

def test_crossings_know_sides():
    x = lambda side: {"A": [PadPoint(0, 0, side, "R1", "1"), PadPoint(10, 10, side, "R2", "1")]}
    other = {"B": [PadPoint(0, 10, "F", "R3", "1"), PadPoint(10, 0, "F", "R4", "1")]}
    assert score({**x("F"), **other}).crossings == 1
    assert score({**x("B"), **other}).crossings == 0
    assert score({**x("X"), **other}).crossings == 1

def test_planes_are_left_out():
    assert score(CROSSING_NETS, planes={"A"}).crossings == 0

def test_total_uses_pcb_kit_weights():
    s = score(CROSSING_NETS)
    assert s.total == pytest.approx(10.0 * s.crossings + 0.2 * s.length)

def test_index_agrees_with_brute_force():
    edges = FIXED_EDGES                                    # 60 edges from a fixed list in the test file
    assert EdgeIndex(edges).count_within() == count_among(edges)
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_ratsnest.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [x] **Step 3: Port the functions and add `PadPoint`, `ratsnest`, `Score`, `score`**

Iterate nets in sorted name order so ties and crossing points come out the same every run.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_ratsnest.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/placement kernel/tests/test_ratsnest.py
git commit -m "kernel: ratsnest scorer ported from pcb-kit (MIT)"
```

---

### Task 13: Placer: intent into positions

**Files:**
- Create: `kernel/src/pino_kernel/placement/placer.py`
- Test: `kernel/tests/test_placer.py`

**Interfaces:**
- Consumes: `Circuit`, `Intent`, `GroupSpec`, `Keepout`, `Placement`, `PartPose` (Task 4); `FootprintLibrary`, `Placed`, `pad_world`, `courtyard_world` (Task 10); `geometry` (Task 10); `score`, `PadPoint` (Task 12); `fab.PROFILES`.
- Produces:
  - `PlaceResult(placement: Placement, score: Score, findings: list[Finding], placed: list[Placed], seconds: float)`.
  - `place(circuit: Circuit, footprints: FootprintLibrary, *, rounds: int = 2) -> PlaceResult`.
  - Findings: source `placement`, codes `placement_no_room` (warning, with the best invalid spot as `at`), `placement_loop` (error).

- [x] **Step 1: Write the failing tests**

```python
def test_fixed_position_is_exact(fixture_libs, fp_lib):
    r = place(board_with(intent={"R1": {"at": (3.0, -2.0), "rot": 90}}), fp_lib)
    assert r.placement["R1"] == PartPose(3.0, -2.0, 90, False)

def test_edge_center_is_flush(fixture_libs, fp_lib):
    r = place(board_with(intent={"J1": {"edge": "bottom", "center": True}}, outline=(40, 30)), fp_lib)
    assert r.placement["J1"].x == 0 and r.placement["J1"].rot == 0
    assert bbox(courtyard_world(placed_of(r, "J1"))["F"][0])[1] == pytest.approx(-15.0, abs=0.05)

def test_edge_face_sets_rotation(fixture_libs, fp_lib):
    r = place(board_with(intent={"U3": {"edge": "top"}, "J1": {"edge": "right"}}), fp_lib)   # MODULE_ANT faces top, USB_Edge faces bottom
    assert (r.placement["U3"].rot, r.placement["J1"].rot) == (0, 90)

def test_near_side_top(fixture_libs, fp_lib):
    r = place(board_with(intent={"J1": {"edge": "bottom", "center": True}, "U1": {"near": "J1", "side": "top"}}), fp_lib)
    assert r.placement["U1"].y > r.placement["J1"].y and no_overlaps(r)

def test_satellite_sits_by_its_pin(fixture_libs, fp_lib):
    r = place(small_board().to_circuit(), fp_lib)
    assert distance(pad(r, "C3", "1"), pad(r, "U2", "1")) < 6.0          # C3 decouples U2's VDD

def test_keepout_is_respected(fixture_libs, fp_lib): ...
def test_no_overlaps_on_a_full_board(fixture_libs, fp_lib): ...           # 30 parts on 40 x 30
def test_no_room_is_a_finding_not_a_crash(fixture_libs, fp_lib):
    r = place(many_parts(30, outline=(10, 10)), fp_lib)
    assert any(f.code == "placement_no_room" for f in r.findings) and len(r.placement) == 30

def test_intent_loop(fixture_libs, fp_lib): ...                           # U1 near U2, U2 near U1 -> placement_loop names both
def test_same_placement_across_hash_seeds(fixture_libs, tmp_path): ...    # placement_to_json equal for PYTHONHASHSEED 1 and 98765
def test_hundred_parts_in_under_five_seconds(fixture_libs, fp_lib):
    assert place(many_parts(100, outline=(80, 60)), fp_lib).seconds < 5.0
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_placer.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [x] **Step 3: Write the placer**

The algorithm, which the tests do not fully fix:

```
order:   fixed (at) -> edge -> near, in dependency order (a loop is a placement_loop finding; its parts fall to "rest")
         -> groups (first member by its own intent or near the board centre, the others near it)
         -> satellites: unplaced 2-pin parts with a non-ground net on a pad of a part with 3 or more pads
            (anchor = that pad; the first such pad in pin-number order)
         -> rest, in declaration order
candidates (positions snapped to 0.05 mm, at most 400 per part):
  fixed      one: (at, rot or 0, back)
  edge       rot from EDGE_ROT[edge_face][edge] unless given (face bottom: bottom 0, right 90, top 180, left 270;
             other faces add their offset); the courtyard's face side on the outline's bounding-box edge;
             along given -> one spot, else every 0.5 mm along the edge
  near/side  rings 0.5 mm apart, from 0.5 mm to 10 mm off the anchor's courtyard box, on the given side
             (all four when no side); rotations 0, 90, 180, 270 unless rot given
  satellite  within 6 mm of the anchor pad, rotations 0 and 90
  rest       1 mm grid over the outline's box, rotations 0 and 90
valid:   courtyard inside the outline polygon (an edge part may cross on its face side only);
         no courtyard overlap with a placed part on the same side; outside keep-outs that forbid footprints
         and outside placed parts' own keep-out zones; every pad at least fab.copper_to_edge from the outline
choose:  lowest score() over the nets touching placed parts (planes: gnd nets and nets with a zone);
         ties by (distance to anchor, y, x, rot); no valid candidate -> the best invalid one and a
         placement_no_room finding at that spot
improve: `rounds` rounds over non-fixed parts (edge parts only along their edge), each part trying its
         candidates with the others held; keep a move only if the total score drops
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_placer.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/placement/placer.py kernel/tests/test_placer.py
git commit -m "kernel: placer that turns edge, near, side, group and fixed intent into positions"
```

---

### Task 14: Checks: assertions by pin, ERC and DRC reports, courtyards, outline fit

**Files:**
- Create: `kernel/src/pino_kernel/checks/expect.py`, `checks/reports.py`, `checks/courtyards.py`, `checks/fit.py`
- Test: `kernel/tests/test_checks.py`, fixtures `kernel/tests/fixtures/reports/{erc.json,drc.json,*.xml}` (hand-written in KiCad 10's report shape)

**Interfaces:**
- Consumes: `Netlist`, `read_netlist` (Task 8), `Placed`, `pad_world`, `courtyard_world`, `geometry` (Task 10), `Circuit`, `Finding`, `At`, `coords.from_kicad`.
- Produces:
  - `check_expects(circuit: Circuit, netlist: Netlist, pads: Mapping[tuple[str, str], tuple[float, float]]) -> list[Finding]`; codes `expect_path_broken`, `expect_apart_joined` (errors, source `expect`, `at` = board position of the first pin's pad, `pins` lists both ends).
  - `erc_findings(report: dict, symbol_refs: Mapping[str, str]) -> list[Finding]` (source `erc`; `at` sheet mm from the report's `coordinate_units`; `refs` from item UUIDs through `symbol_refs` (uuid to ref)).
  - `drc_findings(report: dict, footprint_refs: Mapping[str, str]) -> tuple[list[Finding], int]` (source `drc`; positions through `coords.from_kicad`; `unconnected_items` are counted, not listed; `courtyards_overlap` is dropped because `courtyard_overlaps` owns it; each `schematic_parity` item is an error with code `parity_<type>`). Returns `(findings, unrouted)`.
  - `courtyard_overlaps(placed: list[Placed]) -> list[Finding]` (source `courtyard`, code `courtyard_overlap`, error, `at` the centre of the overlap box, `layer` `F.CrtYd` or `B.CrtYd`).
  - `fit_findings(circuit: Circuit, placed: list[Placed], fab: FabProfile) -> list[Finding]` (source `fit`, errors: `outside_outline`, `pad_near_edge`, `in_keepout`, `on_hole`).

- [x] **Step 1: Write the failing tests**

```python
def test_path_on_one_net_passes(): assert check_expects(c_path_same_net, n_ok, PADS) == []
def test_path_through_a_part(): assert check_expects(c_through_fuse, n_ok, PADS) == []      # J1.VBUS -> F1 -> U1.VIN
def test_path_broken_says_where_each_end_went():
    f = check_expects(c_through_fuse, n_fuse_open, PADS)[0]
    assert f.code == "expect_path_broken" and "J1.1" in f.message and f.at.space == "board"

def test_names_never_count():
    # the right net names on the wrong pins: the wrong join an earlier board shipped past a name check
    assert check_expects(c_usb, read_netlist(FIX / "swapped.xml"), PADS)[0].code == "expect_path_broken"
    assert check_expects(c_usb, read_netlist(FIX / "renamed.xml"), PADS) == []

def test_apart_joined(): ...                                     # D+ and D- on one exported net -> expect_apart_joined
def test_erc_report_to_findings():
    f = erc_findings(json.loads((FIX / "erc.json").read_text()), {"<u1 uuid>": "U1"})
    assert (f[0].source, f[0].severity, f[0].refs, f[0].at.space) == ("erc", "error", ("U1",), "sheet")

def test_drc_report_to_findings():
    found, unrouted = drc_findings(json.loads((FIX / "drc.json").read_text()), {"<r1 uuid>": "R1"})
    assert unrouted == 18
    assert all(f.code != "courtyards_overlap" for f in found)
    assert any(f.code == "parity_missing_footprint" and f.severity == "error" for f in found)
    assert found[0].at.x == pytest.approx(-5.0)                 # KiCad X 95 -> board -5

def test_courtyards_overlap_on_the_same_side_only(fp_lib): ...  # front/front overlap -> 1 finding; front/back -> 0; through-hole/back -> 1
def test_fit(fixture_libs, fp_lib): ...                          # part past the outline, pad 0.2 mm from the edge, part in a keep-out, part on a hole -> one finding each
def test_edge_part_may_cross_on_its_face_only(fixture_libs, fp_lib): ...
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_checks.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [x] **Step 3: Write the four checks**

- `expect_path`, no `through`: every pin of `a` and every pin of `b` sit on one exported net. With `through`: a breadth-first walk where nodes are exported nets and a step crosses one listed part from the net of one of its pins to the net of another; it must reach `b`'s net using only listed parts. The walk reads `netlist.nets` pin sets only; net names are only used in messages.
- Severity map for both reports: `error` and `warning` as they are; `exclusion` and `ignore` dropped.
- Courtyards and fit reuse the geometry the placer uses (Task 10); a through-hole part's courtyard counts on both sides.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_checks.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/checks kernel/tests/test_checks.py kernel/tests/fixtures/reports
git commit -m "kernel: pin-based assertions, ERC and DRC findings with positions, courtyards and fit"
```

---

### Task 15: What changed, in words (ported from pcb-kit)

**Files:**
- Create: `kernel/src/pino_kernel/diff.py` (ports from pcb-kit `pcbkit/release/versions.py`: `BOM_FIELDS`, `BOM_FLAGS`, `circuit`, `_natural`, `_connections`, `circuit_fingerprint`, `_pins`, `circuit_changes`, `_xy`, `_arc_length`, `_child`, `_drawn`, `_net_named`, `_net_name`, `_in_frame`, `_hidden`, `_quote`, `layout`, `_refs`, `layout_changes`, `_by_name`; MIT header)
- Test: `kernel/tests/test_diff.py`

**Interfaces:**
- Consumes: `sexpr.parse`, `sexpr.dump`.
- Produces: `circuit(text: str) -> dict`, `circuit_changes(old: dict, new: dict) -> list[str]`, `layout(text: str) -> dict`, `layout_changes(old: dict, new: dict) -> list[str]`, `changes(old_pcb: str | None, new_pcb: str) -> dict[str, list[str]]` (`{"circuit": [...], "layout": [...]}`; with no old board, `{"circuit": ["first build"], "layout": []}`).

- [x] **Step 1: Write the failing tests**

```python
def test_value_change(): assert "R3 value 10k -> 4.7k" in changes(board_text(r3="10k"), board_text(r3="4.7k"))["circuit"]
def test_added_part(): assert any(line.startswith("adds R5") for line in changes(base, with_r5)["circuit"])
def test_net_gains_a_pin(): assert "net VIN gains U2.5" in changes(base, vin_plus_u2_5)["circuit"]
def test_renamed_net_is_no_change(): assert changes(base, renamed_vin)["circuit"] == []
def test_moved_turned_flipped():
    lines = changes(base, moved_r1_turned_r2_flipped_r3)["layout"]
    assert {"moves 1 part: R1", "turns R2 0 -> 90", "puts R3 on the back"} <= set(lines)
def test_first_build(): assert changes(None, base) == {"circuit": ["first build"], "layout": []}
```

The board texts are small `.kicad_pcb` strings built in the test file with `sexpr.dump`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_diff.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [x] **Step 3: Port**

Take text, never a path. Drop the release parts of `layout()` (`title`, `prints`, `plotted_texts`, `_masked`): silk texts are compared as written. Use pino's `sexpr` (its `Sym` matches pcb-kit's bare-atom convention).

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_diff.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/diff.py kernel/tests/test_diff.py
git commit -m "kernel: circuit and layout changes in words, ported from pcb-kit (MIT)"
```

---

### Task 16: Build result schema and the fast build

**Files:**
- Create: `kernel/src/pino_kernel/result.py`, `kernel/src/pino_kernel/history.py`, `kernel/src/pino_kernel/build.py`, `kernel/schema/build-result-1.schema.json`
- Test: `kernel/tests/test_build.py`, `kernel/tests/test_result.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `result.SCHEMA = "pino.build/1"`, `MAX_FINDINGS = 200`, `MAX_MESSAGE = 300`, `MAX_CHANGES = 50`, `MAX_HEADLINE = 160`.
  - `Timing(step: str, seconds: float, cached: bool = False)`.
  - `BuildResult(schema, kernel_version, kicad_cli: str | None, number: int, hash: str | None, verdict: str, headline: str, counts: dict[str, int], findings: list[Finding], truncated: int, artifacts: dict, timings: list[Timing], changes: dict[str, list[str]], placement: dict | None, waiting: list[str], cached: bool)` with `to_json() -> str` and `from_json(text) -> BuildResult`.
  - `verdict` in `ok|errors|failed`; `counts` keys `errors, warnings, infos, parts, nets, unrouted, crossings`; `placement` is `{"score", "crossings", "length_mm"}`; `waiting` is `["routing: not started"]` in this stage.
  - `headline(number, verdict, counts, problem: str | None) -> str`: `"On h4: 0 errors, 2 warnings, 18 unrouted"`; failed: `"On h4: board.py failed at line 12: NameError: name 'x' is not defined"`.
  - `history.History(project: Path)` with `next_number() -> int`, `previous(hash: str | None) -> dict | None` (latest entry with another hash whose folder still exists), `record(number, hash, verdict) -> None`; file `.pino/builds.json` = `{"schema": "pino.builds/1", "builds": [{"number", "hash", "verdict", "at"}]}`, newest 100 kept, written atomically under an `fcntl.flock` on `.pino/builds.lock`.
  - `BuildOptions(timeout: float = 30.0, render: bool = False, kicad: bool = True, cache: bool = True)`.
  - `build(project: Path, options: BuildOptions = BuildOptions()) -> BuildResult`. `KEEP_BUILDS = 20`.
  - Build folder `.pino/build/<hash>/`: `circuit.json`, `placement.json` (poses and ratsnest edges), `board.kicad_sch`, `board.kicad_pcb`, `board.kicad_pro`, `board.kicad_dru`, `sym-lib-table`, `fp-lib-table`, `filled/` (copies of the project files plus the refilled `board.kicad_pcb`), `erc.json`, `netlist.xml`, `drc.json`, `svg/board-<layer>.svg`, `schematic.svg`, `board.glb`, `render-top.png` (only with `render`), `result.json`. `artifacts` holds these paths relative to the project, POSIX separators; `svg` is a map layer to path.

- [x] **Step 1: Write the failing tests**

```python
NO_KICAD = BuildOptions(kicad=False)

def test_build_writes_only_under_dot_pino(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY); before = snapshot(p)
    build(p, NO_KICAD)
    assert {f for f in changed(before, snapshot(p))} <= {f for f in all_files(p) if f.startswith(".pino/")}

def test_failed_board_py(make_project, fixture_libs):
    r = build(make_project("x = (\n"), NO_KICAD)
    assert r.verdict == "failed" and r.hash is None and r.findings[0].at == At("source", file="board.py", line=1)
    assert r.headline.startswith("On h1: board.py failed at line 1")

def test_same_input_same_hash_and_cached(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY); a = build(p, NO_KICAD); b = build(p, NO_KICAD)
    assert a.hash == b.hash and b.cached and (a.number, b.number) == (1, 2)

def test_changes_versus_previous_build(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY); build(p, NO_KICAD)
    (p / "board.py").write_text(SMALL_BOARD_PY.replace('"10k"', '"4.7k"'))
    assert "R1 value 10k -> 4.7k" in build(p, NO_KICAD).changes["circuit"]

def test_findings_are_capped_and_sorted(make_project, fixture_libs):
    r = build(make_project(board_with_missing_models(250)), NO_KICAD)
    assert len(r.findings) == 200 and r.truncated == 50 and len(r.to_json()) < 100_000
    assert [f.severity for f in r.findings] == sorted((f.severity for f in r.findings), key=SEVERITIES.index)

def test_nc_rest_is_listed(make_project, fixture_libs): ...      # info finding "U2: 1 pin left open by nc_rest: 5 (IO3)"
def test_result_matches_schema(make_project, fixture_libs):
    jsonschema.validate(json.loads(build(make_project(SMALL_BOARD_PY), NO_KICAD).to_json()), SCHEMA_JSON)

def test_missing_kicad_cli_is_a_warning(make_project, fixture_libs, monkeypatch):
    monkeypatch.setenv("PINO_KICAD_CLI", "/nowhere/kicad-cli")
    r = build(make_project(SMALL_BOARD_PY))
    assert r.verdict != "failed" and any(f.code == "kicad_cli_missing" for f in r.findings)

def test_missing_libraries_fail_in_plain_words(make_project, monkeypatch):
    monkeypatch.setenv("PINO_KICAD_SYMBOL_DIR", "/nowhere/symbols")
    r = build(make_project(SMALL_BOARD_PY), NO_KICAD)
    assert r.verdict == "failed" and r.findings[0].code == "libraries_not_found" and "/nowhere/symbols" in r.findings[0].message

def test_build_in_a_path_with_spaces(tmp_path, fixture_libs):
    p = write_project(tmp_path / "my board ação", SMALL_BOARD_PY)
    assert build(p, NO_KICAD).verdict in ("ok", "errors")

def test_two_builds_at_once(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY)
    with ThreadPoolExecutor(2) as ex: results = list(ex.map(lambda _: build(p, NO_KICAD), range(2)))
    assert {r.number for r in results} == {1, 2}
    assert len(json.loads((p / ".pino/builds.json").read_text())["builds"]) == 2
    assert not list((p / ".pino/build").glob("*.tmp-*"))

def test_old_builds_are_pruned(make_project, fixture_libs, monkeypatch): ...   # KEEP_BUILDS=2, four different builds -> two folders remain
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_build.py tests/test_result.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [x] **Step 3: Write `result.py`, `history.py`, `build.py` and the schema**

Steps and their timing names, in this fixed order in `timings` whatever order they finish in:

```
"libraries"         discover(); LibrariesNotFound -> failed, code libraries_not_found
"run board.py"      run_board(); problems -> failed, one finding each (source board.py, At("source", file, line))
"hash"              sha256 of circuit.json bytes, kernel version, kicad-cli version (or "none"),
                    source_digest() of every symbol and footprint used (sorted by lib_id), and options.render;
                    first 12 hex digits. A complete .pino/build/<hash>/result.json and options.cache -> load it,
                    set number, changes and cached, record history, return.
"place"             placer.place()
"write schematic"   write_schematic(); DrawingError -> failed
"write board"       pin_pad_findings(), write_board(); writes into .pino/build/<hash>.tmp-<pid>-<thread id>/
"erc" "netlist" "schematic svg"           one worker
"drc" then "svg" and "glb" (and "render") another worker; drc runs on filled/ with refill, save and parity
"checks"            compare, net_names, check_expects, erc_findings, drc_findings, courtyard_overlaps,
                    fit_findings, model_findings, lint, placement findings, nc_rest info
"diff"              diff.changes(previous board text or None, this board text)
```

- Without kicad-cli (or with `kicad=False`) the kicad steps are left out of `timings`, and a warning `kicad_cli_missing` says which checks were skipped (only when `kicad=True` asked for them). A kicad step with a non-zero exit adds an error `kicad_cli_failed` (source `kernel`) with the step and the output's last line, and the build goes on.
- Findings are sorted by (severity order, source, code, message), cut to `MAX_FINDINGS`, messages cut to `MAX_MESSAGE` with "…"; change lists cut to `MAX_CHANGES` with a last line "and <n> more".
- `verdict`: `failed` when board.py, libraries or a writer failed; `errors` when any error finding is left; else `ok`.
- The temp folder is renamed onto `.pino/build/<hash>/` when complete; if that folder already exists (another build won the race), the temp folder is removed and the existing one used. History is recorded under the lock. Pruning removes build folders not among the newest `KEEP_BUILDS` history hashes, never the current or the previous one.
- The JSON Schema file describes `pino.build/1` exactly as `BuildResult.to_json()` writes it (`additionalProperties: false` at the top level and in findings).

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_build.py tests/test_result.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/result.py kernel/src/pino_kernel/history.py kernel/src/pino_kernel/build.py kernel/schema kernel/tests/test_build.py kernel/tests/test_result.py
git commit -m "kernel: the fast build with a versioned result, cache, history and changes"
```

> **Plan fixes (Task 16, during the build):**
> - `test_missing_libraries_fail_in_plain_words` could not pass with Task 1's discovery order (a wrong
>   `PINO_KICAD_SYMBOL_DIR` fell through to `/usr/share/kicad/symbols`). A `PINO_KICAD_<KIND>_DIR` that is set now wins
>   outright, like `PINO_KICAD_CLI`; a wrong one is reported.
> - The first kicad-cli build found three board-writer gaps: DRC parity wants every symbol field on the footprint
>   (an `LCSC` property, font thickness 0.15 as KiCad writes it), pads of no-connect pins carry KiCad's
>   `unconnected-(REF-PIN-PadN)` net, and the GLB export fails on a model file it cannot read (the test models are
>   now a real 1.6 x 0.8 mm STEP box made with kicad-cli). A kicad-cli build of the small board is now a test.
> - Build numbers are taken at the start under the lock (an entry marked `running`), so two builds at once get 1 and 2.

---

### Task 17: CLI, serve mode, README and CI

**Files:**
- Create: `kernel/src/pino_kernel/cli.py`, `kernel/README.md`
- Modify: `.github/workflows/ci.yml`, `app/src/ci.test.ts`
- Test: `kernel/tests/test_cli.py`

**Interfaces:**
- Consumes: `build`, `BuildOptions`, `BuildResult`, `KicadCli`, `discover`.
- Produces:
  - `main(argv: list[str] | None = None) -> int`; `python -m pino_kernel.cli` runs it.
  - `pino-kernel build <project> [--timeout S] [--render] [--no-kicad] [--no-cache]`: prints `BuildResult.to_json()` on stdout; exit 0 for `ok`, 1 for `errors`, 2 for `failed`. Nothing else goes to stdout.
  - `pino-kernel version`: `{"kernel": "0.1.0", "schema": "pino.build/1", "kicad_cli": "10.0.6" | null, "libraries": {...} | null}`.
  - `pino-kernel serve`: one JSON object per stdin line, one per stdout line, flushed, in request order:
    - `{"id": X, "op": "build", "project": "<dir>", "options": {"timeout": 30, "render": false, "kicad": true, "cache": true}}` -> `{"id": X, "ok": true, "result": {…}}`
    - `{"id": X, "op": "ping"}` -> `{"id": X, "ok": true, "pong": {"kernel": "0.1.0", "schema": "pino.build/1"}}`
    - `{"id": X, "op": "shutdown"}` -> `{"id": X, "ok": true}` then exit 0; end of input also exits 0.
    - a line that is not JSON, or an unknown `op` -> `{"id": <id or null>, "ok": false, "error": "<plain words>"}` and the loop goes on.
    - board.py still runs in a fresh child per build; logs go to stderr.

- [x] **Step 1: Write the failing tests**

```python
def run_cli(*args, **kw): return subprocess.run([sys.executable, "-m", "pino_kernel.cli", *args], capture_output=True, text=True, **kw)

def test_build_prints_one_json_result(make_project, fixture_libs):
    p = run_cli("build", str(make_project(SMALL_BOARD_PY)), "--no-kicad")
    r = json.loads(p.stdout)
    assert r["schema"] == "pino.build/1" and p.returncode == {"ok": 0, "errors": 1, "failed": 2}[r["verdict"]]

def test_failed_board_exits_2(make_project, fixture_libs):
    assert run_cli("build", str(make_project("x = (\n")), "--no-kicad").returncode == 2

def test_serve_answers_in_order_and_survives_bad_lines(make_project, fixture_libs):
    good, bad = make_project(SMALL_BOARD_PY), make_project("x = (\n", name="bad")
    lines = [{"id": 1, "op": "ping"}, "not json", {"id": 2, "op": "build", "project": str(bad), "options": {"kicad": False}},
             {"id": 3, "op": "build", "project": str(good), "options": {"kicad": False}}, {"id": 4, "op": "nope"}, {"id": 5, "op": "shutdown"}]
    p = run_cli("serve", input="\n".join(l if isinstance(l, str) else json.dumps(l) for l in lines) + "\n", timeout=60)
    out = [json.loads(l) for l in p.stdout.splitlines()]
    assert [o["id"] for o in out] == [1, None, 2, 3, 4, 5] and p.returncode == 0
    assert out[1]["ok"] is False and out[2]["result"]["verdict"] == "failed" and out[3]["result"]["verdict"] != "failed"
    assert out[4]["error"] == "unknown op 'nope'"

def test_version(fixture_libs): assert json.loads(run_cli("version").stdout)["schema"] == "pino.build/1"
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_cli.py -v`
Expected: FAIL with `No module named pino_kernel.cli`

- [x] **Step 3: Write the CLI, the README and the CI jobs**

- `cli.py` with `argparse`; `serve` reads `sys.stdin` line by line and writes through one `sys.stdout.write(...); flush()`.
- `kernel/README.md`: what the engine does, how to run (`uv run --directory kernel pino-kernel build <dir>`), the serve protocol above, library discovery and the `PINO_KICAD_*` variables, `PINO_KICAD_CLI`, the build folder layout, the result schema file, the pcbnew list ("pcbnew: none. Zone fill uses kicad-cli. Nothing to replace in KiCad 11."), the pcb-kit notice pointer. Run the humanizer skill on it.
- CI: job `kernel` (ubuntu-latest, `astral-sh/setup-uv`, `uv run --directory kernel pytest -m "not kicad_cli and not kicad_libs"`) and job `kernel-kicad` in container `kicad/kicad:10.0.6-full` running the whole suite; both on the shell stage's `changes` filter. `app/src/ci.test.ts`: the case "no kernel job yet" now expects both jobs.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_cli.py -v && pnpm -C app test -- ci.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/cli.py kernel/README.md kernel/tests/test_cli.py .github/workflows/ci.yml app/src/ci.test.ts
git commit -m "kernel: pino-kernel build and serve, README and CI jobs"
```

---

### Task 18: The reference board, built end to end

**Files:**
- Create: `kernel/tests/fixtures/reference/board.py`, `kernel/tests/fixtures/reference/outline.json`
- Test: `kernel/tests/test_reference_build.py`

**Interfaces:**
- Consumes: `build`, `BuildOptions`, `KicadCli`, `read_netlist`, `tests/semdiff.changed_items`.
- Produces: the fixture the views stage and the router spike reuse.

The board (spec section 6, parts only from KiCad's shipped libraries, LCSC fields empty): the spike schematic circuit (`spike-schematic:spike/schematic/board.py`) rewritten on the `pino` API, plus a second LED. Blocks `usb` (J1 `Connector:USB_C_Receptacle_USB2.0_16P` with footprint `Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12`, F1 polyfuse, R9 0R DNP across it, CC resistors, shield RC), `reg` (U2 `Regulator_Linear:AP2112K-3.3`, C3, C4), `mcu` (U1 `RF_Module:ESP32-C6-MINI-1`, decoupling, EN and BOOT pull-ups, SW1 `Switch:SW_Push` on `Button_Switch_SMD:SW_SPST_TL3342`, D1 status LED on IO8 with R6, D2 power LED on +3V3 with R7, `id="power-led"`). `outline.json`: 56 x 44 mm, corner radius 2, mounts H1 to H4 at (±24.5, ±18.5), hole 3.2, boss 5.0. Intent: `b.place(u1, edge="top", center=True)`, `b.place(j1, edge="bottom", center=True)`, `b.place(u2, near=j1, side="top")`, `b.place(sw1, edge="left")`, group `leds` (D1, R6, D2, R7) near U1 on the right. Rules: `b.zone("GND", layer="B.Cu")`, `b.net_class("power", ["VBUS", "+3V3"], width=0.5)`, `b.expect_path(j1["VBUS"], u2["VIN"], through=[f1])`, `b.expect_path(j1["D+"], u1["IO13"])`, `b.expect_path(j1["D-"], u1["IO12"])`, `b.expect_path(u2["VOUT"], u1["3V3"])`, `b.expect_apart(j1["D+"], j1["D-"])`.

- [x] **Step 1: Write the fixture and the failing test**

```python
pytestmark = [pytest.mark.kicad_cli, pytest.mark.kicad_libs]

@pytest.fixture
def ref(tmp_path):
    return shutil.copytree(FIXTURES / "reference", tmp_path / "reference")

def test_reference_builds_clean(ref):
    r = build(ref)
    assert r.verdict == "ok", [f.to_json() for f in r.findings if f.severity == "error"]
    assert r.counts["parts"] == 22 and r.counts["unrouted"] > 0
    for path in flatten(r.artifacts): assert (ref / path).is_file()
    assert {"F.Cu", "B.Cu", "Edge.Cuts"} <= set(r.artifacts["svg"]) and (ref / r.artifacts["glb"]).stat().st_size > 0
    assert [t.step for t in r.timings][:3] == ["libraries", "run board.py", "hash"]
    assert sum(t.seconds for t in r.timings) < 60

def test_exported_names_and_parity(ref):
    r = build(ref); d = ref / ".pino/build" / r.hash
    names = set(read_netlist(d / "netlist.xml").nets)
    assert names == {n.name for n in Circuit.from_json((d / "circuit.json").read_text()).nets}
    assert not [f for f in r.findings if f.code.startswith("parity_")]

def test_same_bytes_in_a_second_copy(ref, tmp_path):
    a = build(ref); other = shutil.copytree(FIXTURES / "reference", tmp_path / "again"); b = build(other)
    assert a.hash == b.hash
    assert digests(ref / ".pino/build" / a.hash, skip={"result.json"}) == digests(other / ".pino/build" / b.hash, skip={"result.json"})

def test_refill_adds_only_fill(ref):
    d = ref / ".pino/build" / build(ref).hash
    assert {k for k, _ in changed_items((d / "board.kicad_pcb").read_text(), (d / "filled/board.kicad_pcb").read_text())} == {"zone"}

def test_ref_rename_with_id_keeps_the_link(ref):
    first = build(ref)
    (ref / "board.py").write_text((ref / "board.py").read_text().replace('"D2"', '"D12"'))
    second = build(ref)
    assert ids_of(ref, second, "D12") == ids_of(ref, first, "D2")          # symbol uuid and footprint uuid
    assert not [f for f in second.findings if f.code.startswith("parity_")]
    assert any("D2" in line or "D12" in line for line in second.changes["circuit"])

def test_serve_builds_the_reference(ref): ...       # one serve session: ping, build, shutdown; result verdict "ok"
```

- [x] **Step 2: Run the test to verify it fails**

Run: `uv run --directory kernel pytest tests/test_reference_build.py -v`
Expected: FAIL on the first real gap (or SKIPPED with "kicad-cli not found: install KiCad 10 to run this test" on a machine without KiCad)

- [x] **Step 3: Fix what the end-to-end build finds**

Each fix goes into the module that owns it, with a unit test there first. Look at `schematic.svg` (rendered to PNG with `rsvg-convert`) and `svg/board-F_Cu.svg` yourself and say in the report what you saw and what they do not show.

- [x] **Step 4: Run the whole suite**

Run: `uv run --directory kernel pytest -v`
Expected: PASS, with the kicad tests run (not skipped) on this machine

- [x] **Step 5: Commit**

```bash
git add kernel/tests/fixtures/reference kernel/tests/test_reference_build.py
git commit -m "kernel: the reference board built end to end"
```

---

> **Plan fixes (Task 18, during the build), each found by building the reference board:**
> - DRC parity wants the symbol's Datasheet and Description on the footprint too: `PartSpec` carries both and the
>   board writer writes them.
> - The ESP32-C6-MINI-1 courtyard is a T that includes the antenna clearance. An edge part meets the edge on its face
>   line: where its own face-side keep-out begins (the clearance then lies past the edge), else its courtyard's face
>   side; it moves in until its pads keep the fab's copper-to-edge distance. A part placed near it gathers round its
>   on-board body. Satellites and group members that find no room by their anchor fall back to the rest rule.
> - KiCad saves a footprint's angle in (-180, 180] (270 is written -90).
> - kicad-cli stamps the run's time into SVG titles, ERC/DRC JSON, the netlist and the GLB, the input's absolute path
>   into the netlist, and its threaded DRC names either of two stacked pads in the unconnected list. `normalize.py`
>   takes these out so a build folder is the same bytes in any copy of the project.
> - `test_exported_names_and_parity` allows KiCad's `unconnected-(...)` nets beside board.py's.

## Self-review

**Spec coverage (scope items 1 to 10 and the spec sections):**

1. board.py library: Tasks 5 and 6 (parts by symbol and footprint, `lcsc=`, `id=`, pins, blocks and roles, intent, keep-outs, net classes, `expect_path`, `outline.json`, 2 or 4 layers).
2. Separate process with a timeout, errors by file and line: Task 7; failed builds in the result: Task 16.
3. Circuit model JSON: Task 4.
4. Schematic writer: Tasks 8 (library root, UUIDs, layout, names) and 9 (lint, frames per block, satellites by pin, MOSFET as a finding).
5. Board writer: Tasks 10 (loader, library root, 3D check, shared UUIDs) and 11 (stackups, outline, holes, zones, net classes, `.kicad_dru`).
6. Placement: Tasks 12 (ported scorer) and 13 (placer).
7. kicad-cli wrappers, timed: Task 2; timings in the result: Task 16.
8. Fast-build checks with positions: Tasks 8 (netlist), 9 (lint), 14 (expects, ERC, DRC, courtyards, fit), 10 (3D models, pins and pads).
9. Result schema, artifacts, timings, diff: Tasks 15 and 16.
10. Reference fixture end to end: Task 18.
- Spec 5.3 step 4 (headless board update matched by symbol UUID path): the board is written from the circuit with `path` = symbol UUID, and DRC parity proves the match (Tasks 10, 16, 18).
- Spec 5.8 (agent rules): not engine code; the findings carry the numbers and positions those rules need. Nothing here waives a finding.
- Spec 3 (no writes outside `.pino/`, no windows, no pcbnew): Global Constraints, `test_build_writes_only_under_dot_pino`, `test_hygiene.py`, the kicad-cli environment test.
- Stock, basic and extended checks (spec 5.3 step 6): stage 8, out of scope here.

**Step scan:** every step names a file, signature, value or command. The algorithms the tests do not fix (placer order and candidates, expect walk, build step order) are written out.

**Type consistency:** `Circuit`, `PartSpec.key`, `PinRef`, `Placement`/`PartPose`, `Placed`, `Finding`/`At`, `KicadCli`, `SymbolLibrary`, `FootprintLibrary`, `BuildResult` and `ids.footprint_path` are used with the same names and fields in every task that consumes them.

**Review Focus:** five entries, each with its test in the owning task (16, 3, 10, 16, 7, 11).

**Proportion:** test bodies are assertions; module bodies are left to the implementer except the placer and build-step outlines.

## Director's calls (2026-11-26, Luis asleep, recommendations taken)

- Board coordinates in the y-up, outline-centred frame (enclosure.json's) everywhere a person or Claude reads a position, converted to KiCad's frame in one module. Reason: one frame for marks, findings and the later torno link.
- JLC limits are conservative placeholders until stage 8 checks them against JLC's capability page.
- Built in parallel with the shell (see "Where to work").
