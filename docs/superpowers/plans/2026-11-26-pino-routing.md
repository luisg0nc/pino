# pino routing (stage 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Routing as a background job in the kernel: KiCadRoutingTools managed by pino, a cancellable route job keyed by what the copper depends on, cleanup, deterministic UUIDs, zone refill, DRC and copper checks, stale copper in the build result, and Claude's finishing tools, proven by two boards fully routed and DRC clean.

**Architecture:** A fast build's board goes through a fixed router chain (planes, fanout per QFN, differential pairs, the rest, plane repair, then the `route_hint` steps from `board.py`), each step a KiCadRoutingTools (KRT) script in a child process under a venv in the user cache. pino takes only the copper out of KRT's output, merges it into its own board text, cleans it, gives it UUIDs from a hash, refills zones and runs DRC with kicad-cli, then its own copper checks. The result lands in `.pino/routes/<key>/`, keyed by a hash of nets, placement, footprints, outline, zones, kept copper, rules and routing instructions; a fast build reports that copper as current or stale. Claude finishes with trial tools (`route_net`, `nudge`, `keep`) that return lines for `board.py`, so the source stays the whole truth.

**Tech Stack:** Python 3.12+, uv, standard library only in `pino_kernel`; KiCadRoutingTools v0.17.7 (MIT) at a pinned commit in its own venv (numpy, scipy, shapely); KiCad 10.0.x `kicad-cli`; pytest and jsonschema for tests.

**Spec:** `docs/superpowers/specs/2026-11-26-pino-design.md` (5.1, 5.3 "Routing, in the background", 5.6 `route`, 5.8, 7 item 5, 9). Engine plan: `docs/superpowers/plans/2026-11-26-pino-engine.md` (this plan uses its names). Spike report: `.worktrees/spike-router.report.md` and its notes (not committed; read them before starting).

**Where to work:** branch `routing` cut from `main` after `engine` has merged, in a worktree at `.worktrees/routing`. One PR to `main` after the leak audit; one whole-branch review (Opus) at the end. The app's routing UI is not in this stage (views and marks stages); the serve requests here are what the app will map to MCP tools.

**Reference code, read only:** KRT at https://github.com/drandyhaas/KiCadRoutingTools commit `6ab59a6a97f7bc489f72cc965a4dba4a1ce29f72` (read its `--help` output and `fab_overrides.example.txt`; never copy its code). pcb-kit (MIT) at https://github.com/somebox/pcb-kit commit `32867ca`: `pcbkit/checks/cleanup_tracks.py` and `pcbkit/checks/route_check.py`; read from a fresh clone, never run.

## Global Constraints

Every task's requirements include the engine plan's Global Constraints (Python `>=3.12`, no run-time dependencies, size caps, coordinates, kicad-cli environment, hygiene tests). On top of them:

- No pcbnew. Nothing in pino imports it. KRT's venv is made without `--system-site-packages`, so no KRT step can import it either.
- No GPL code in pino. Freerouting is not used, downloaded or mentioned as a dependency. KRT (MIT) is never vendored or copied: it is fetched at first use into the user cache. `test_hygiene.py` fails on "GNU General Public License" or "SPDX-License-Identifier: GPL" under `kernel/src`.
- KRT is pinned: repo `https://github.com/drandyhaas/KiCadRoutingTools`, commit `6ab59a6a97f7bc489f72cc965a4dba4a1ce29f72`, `VERSION` `0.17.7`, deps `numpy==2.5.5`, `scipy==1.18.1`, `shapely==2.2.0`, Python 3.12. A different version is refused, never run.
- KRT flags pino always passes where the script accepts them: `--fab-overrides <file>`, `--no-fix-drc-settings`, `--board-edge-clearance`, and `--no-gnd-vias` on `route_diff.py`. pino never passes `--visualize`, `-V`, `--auto` or `--display-time`; `routing.krt.run` raises `ValueError` if asked to.
- DRC always runs with pino's own `board.kicad_pro` and `board.kicad_dru` copied from the build, never with a project file KRT wrote.
- Deterministic bytes after routing: in `.pino/routes/<key>/`, `board.kicad_pcb`, `copper.json`, `plan.json`, `key.json` and `filled/board.kicad_pcb` are a pure function of the build folder, the KRT commit, the kernel version and the kicad-cli version. Same bytes across processes and `PYTHONHASHSEED` values. KRT children run with `PYTHONHASHSEED=0`. Copper UUIDs come only from `ids.uid`.
- Writes: the kernel writes under `<project>/.pino/` and under the user cache `<cache>/krt/` (and nowhere else). It never edits `board.py`: the finishing tools return lines for Claude to write.
- No personal paths in committed files. Tests run in `tmp_path` with `PINO_CACHE_DIR` set to a temp folder. Tests marked `krt` read an installed router and never install one; only the `network` test installs, into `tmp_path`.
- Tests never open a window: KRT and kicad-cli children get no `DISPLAY` or `WAYLAND_DISPLAY`; KRT children also get `SDL_VIDEODRIVER=dummy` and `MPLBACKEND=Agg`. Never start the KiCad GUI. Never run the real `claude` CLI.
- Processes: pino kills only process groups it started (each KRT step and each job child runs with `start_new_session=True`): SIGTERM, then SIGKILL after 5 s. No broad kills.
- Time limits: 300 s per router step and 900 s per route job by default (spec 5.3: a router over five minutes on the reference board is dropped).
- Coordinates: every position pino shows (plan, findings, `copper.json`, snippets, CLI arguments, region and corridor) is board mm in the `outline.json` frame, y up. Only `coords.py` converts.
- The engine's size caps apply to `RouteResult` and `TrialResult` too (200 findings, 300-character messages, 160-character headline); event `log` lines are cut to 300 characters.
- English, plain words in every message; no em dashes in copy.
- Commits: plain `git commit`, no Co-Authored-By trailer, no "Generated with" footer.

## Review Focus

1. A project folder whose path has a space or non-ASCII letters (`my board ação`): the route job, the fab-overrides file and every KRT argument still arrive as single arguments. Test: `test_route_in_a_path_with_spaces` in Task 8.
2. Luis saves `board.py` while a route is running: the finished route is stored under its own key, the next build shows it as stale with the reason, and no half-written folder is left. Test: `test_save_during_route_marks_it_stale` in Task 9.
3. First route on a machine that is offline, or an install cut off halfway: the route fails with one finding that says what to run, and a half-installed router is never used later. Tests: `test_offline_install_fails_in_plain_words`, `test_interrupted_install_is_not_used` in Task 1.
4. The app quits or cancels during a router step: the router's process group is gone, the temp folder is removed, history says cancelled. Tests: `test_cancel_kills_the_router_and_cleans_up` in Task 8, `test_shutdown_cancels_running_jobs` in Task 10.
5. A board with nothing left to route (every net kept, or nets with one pad): the job finishes in seconds, says "nothing to route", and the router share is `null`, never a division by zero. Tests: `test_nothing_to_route_has_no_share` in Task 7, `test_route_with_nothing_to_route` in Task 8.

## Changes to the engine's interfaces

Each is its own task, named here so a reviewer can find them:

- Task 2: `Circuit` gains `pairs`, `kept_routes`, `fixed_vias`, `route_hints`; `pino_kernel.__version__` becomes `"0.2.0"` (old build caches stop matching).
- Task 3: `write_board` now writes kept copper (locked segments and vias); `pcb/rules.py` names its Default net class values as constants.
- Task 9: `BuildResult` gains `routing`; `counts["unrouted"]`, `headline` and `waiting` follow the routing state; the `pino.build/1` schema file gains the field (additive; readers that ignore it keep working).
- Task 10: serve mode streams job events and answers `route_cancel` out of order; the serve loop moves from `cli.py` to `serve.py`. The engine's ordering test still passes unchanged.
- Additive only, not interface changes: new functions in `geometry.py` (Task 4), a canned-DRC switch in `tests/fake_kicad_cli.py` (Task 8), `diff_pair` in the reference fixture (Task 12).

---

## File structure

```
NOTICE                                       modify: KRT section; pcb-kit ported files list
.github/workflows/kernel.yml                 modify: router install and cache, markers (Task 12)
kernel/
  README.md                                  modify: routing section
  schema/route-result-1.schema.json          new
  schema/trial-result-1.schema.json          new
  schema/build-result-1.schema.json          modify: routing (Task 9)
  src/pino/board.py  __init__.py             modify: keep_route, via, fixed_via, route_hint, diff_pair
  src/pino_kernel/
    circuit.py                               modify: PairSpec, RouteStep, KeptRoute, FixedVia, RouteHint
    geometry.py                              modify: distances (additions)
    pcb/writer.py  pcb/rules.py              modify: kept copper, Default class constants
    pcb/copper.py                            new: read copper, merge, UUIDs, copper.json, strip, move
    pcb/cleanup.py                           new: ported cleanup plan, rebuilt dangling peel
    checks/kept.py                           new: kept_route_bent, pair_undeclared
    routing/__init__.py
    routing/krt.py                           install, locate, version check, run one KRT script
    routing/plan.py                          RouterRules, RoutePlan, router keep-outs, fab overrides
    routing/key.py                           RouteKey and stale reasons
    routing/chain.py                         the chain and hint steps
    routing/checks.py                        DRC attribution, unrouted nets, share, copper checks
    routing/result.py                        RouteResult, TrialResult
    routing/history.py                       .pino/routes.json
    routing/job.py                           route_board, route_project
    routing/state.py                         routing_state for the build result
    routing/trials.py  routing/snippets.py   route_net, nudge, keep; board.py lines
    serve.py                                 serve loop with jobs
    cli.py  build.py  result.py              modify
  tests/
    fake_krt/                                VERSION, route.py, route_diff.py, qfn_fanout.py, route_planes.py,
                                             route_disconnected_planes.py, startup_checks.py, fakelib.py
    copper_boards.py                         builds small .kicad_pcb texts with sexpr for tests
    fixtures/route_reports/*.json            hand-written DRC reports in KiCad 10's shape
    fixtures/reference/finish.py             board.py lines that finish the reference route
    fixtures/four_layer/source.json  finish.json
    test_*.py
```

---

### Task 1: KiCadRoutingTools managed by pino

**Files:**
- Create: `kernel/src/pino_kernel/routing/__init__.py`, `kernel/src/pino_kernel/routing/krt.py`, `kernel/tests/fake_krt/` (all files listed above)
- Modify: `kernel/src/pino_kernel/cli.py` (`router` subcommand), `kernel/tests/conftest.py`, `kernel/tests/test_hygiene.py`, `NOTICE`
- Test: `kernel/tests/test_krt.py`

**Interfaces:**
- Consumes: `KicadCli.env()` (engine Task 2), `Finding` (engine Task 4).
- Produces:
  - Constants `KRT_REPO`, `KRT_COMMIT`, `KRT_VERSION = "0.17.7"`, `KRT_DEPS`, `KRT_PYTHON = "3.12"`, `ROUTER_ID = "KiCadRoutingTools 0.17.7 6ab59a6a97f7"`, `FORBIDDEN_FLAGS = ("--visualize", "-V", "--auto", "--display-time")`.
  - `cache_root(env: Mapping[str, str] = os.environ) -> Path`: `PINO_CACHE_DIR`, else `$XDG_CACHE_HOME/pino`, else `$HOME/.cache/pino`.
  - `Krt(root: Path, python: Path, version: str, commit: str | None, flags: dict[str, frozenset[str]])` frozen; `script(name: str) -> Path`. `flags[script]` holds the options its `--help` lists, probed at install.
  - `RouterMissing(Exception)` with `.finding: Finding` (source `router`, code `router_missing` or `router_version`, severity error).
  - `locate(env=os.environ) -> Krt`: `PINO_KRT_DIR` with `PINO_KRT_PYTHON` when set, else `<cache>/krt/<commit[:12]>/` holding `stamp.json` (`{"commit", "version", "deps", "flags"}`); raises `RouterMissing`.
  - `install(env=os.environ, *, on_line: Callable[[str], None] = lambda s: None, timeout: float = 900.0) -> Krt`.
  - `ensure(env=os.environ, *, allow_install: bool = True, on_line=...) -> Krt`.
  - `check(krt: Krt) -> list[Finding]`.
  - `KrtRun(step: str, argv: list[str], seconds: float, returncode: int, summary: dict | None, log: str)`; `log` is the last 4000 characters.
  - `krt_env(kicad: KicadCli) -> dict[str, str]`.
  - `run(krt: Krt, step: str, script: str, args: Sequence[str], *, cwd: Path, env: Mapping[str, str], timeout: float, on_line: Callable[[str], None], cancel: threading.Event) -> KrtRun`.
  - CLI `pino-kernel router status|install`: prints `{"router": "KiCadRoutingTools", "version": "0.17.7", "commit": "6ab59a6…", "installed": bool, "root": str | null, "problems": [finding json]}`; exit 0 when installed and `check` is empty, else 1.
  - `conftest.py`: fixture `fake_krt` (a copy of `tests/fake_krt` in `tmp_path` plus the env dict `{"PINO_KRT_DIR", "PINO_KRT_PYTHON": sys.executable, "PINO_CACHE_DIR"}` applied with monkeypatch); marker `krt` (skips with "KiCadRoutingTools not installed: run uv run --directory kernel pino-kernel router install" unless `locate()` succeeds) and marker `network` (skips unless `PINO_TEST_NETWORK=1`).

- [x] **Step 1: Write the fake router and the failing tests**

`fake_krt/fakelib.py` is shared by the fake scripts. Each script appends `{"script", "argv", "cwd"}` as one JSON line to `$FAKE_KRT_ARGV_LOG` when set, writes its pid to `$FAKE_KRT_PIDFILE` when set, and then by `$FAKE_KRT_MODE`: `copy` (default: output = input plus, for `route.py`/`route_diff.py`, one F.Cu segment per `--nets` net from its first pad centre to its second, skipping nets in `$FAKE_KRT_FAIL`), `sleep` (sleep 60 s), `crash` (exit 1, no output; only for the script named in `$FAKE_KRT_CRASH` when set), `env` (print the environment as one JSON line). `route.py` prints `[i/n] Routing <net> (id=i)` per net and `JSON_SUMMARY: {"successful": n, "failed": k, "failed_single": [...], "total_time": 0.01, "total_vias": 0}`. `startup_checks.py` defines `run_all_checks()` that returns. `VERSION` holds `0.17.7`.

```python
def test_cache_root_order(tmp_path):
    assert cache_root({"PINO_CACHE_DIR": str(tmp_path / "c"), "XDG_CACHE_HOME": "/x", "HOME": "/h"}) == tmp_path / "c"
    assert cache_root({"XDG_CACHE_HOME": str(tmp_path), "HOME": "/h"}) == tmp_path / "pino"
    assert cache_root({"HOME": str(tmp_path)}) == tmp_path / ".cache" / "pino"

def test_override_dir_is_used_and_checked(fake_krt):
    krt = locate()
    assert krt.version == "0.17.7" and check(krt) == []

def test_other_version_is_refused(fake_krt):
    (fake_krt.root / "VERSION").write_text("0.18.0\n")
    with pytest.raises(RouterMissing) as e: locate()
    assert e.value.finding.code == "router_version"
    assert "0.18.0" in e.value.finding.message and "0.17.7" in e.value.finding.message

def test_missing_router_says_how_to_fix(tmp_path):
    with pytest.raises(RouterMissing) as e: ensure({"PINO_CACHE_DIR": str(tmp_path)}, allow_install=False)
    assert e.value.finding.code == "router_missing" and "pino-kernel router install" in e.value.finding.message

def test_interrupted_install_is_not_used(tmp_path):
    half = tmp_path / "krt" / (KRT_COMMIT[:12] + ".tmp-999"); half.mkdir(parents=True); (half / "VERSION").write_text("0.17.7")
    nostamp = tmp_path / "krt" / KRT_COMMIT[:12]; nostamp.mkdir(); (nostamp / "VERSION").write_text("0.17.7")
    with pytest.raises(RouterMissing): locate({"PINO_CACHE_DIR": str(tmp_path)})

def test_offline_install_fails_in_plain_words(tmp_path):
    env = {"PINO_CACHE_DIR": str(tmp_path), "PINO_KRT_REPO": str(tmp_path / "no-such-repo"),
           "PATH": os.environ["PATH"], "HOME": str(tmp_path)}
    with pytest.raises(RouterMissing) as e: install(env)
    assert e.value.finding.code == "router_missing" and "could not fetch" in e.value.finding.message
    assert not list((tmp_path / "krt").glob("*.tmp-*"))

def test_run_parses_summary_and_streams_lines(fake_krt, tmp_path):
    lines = []
    r = run(locate(), "signals", "route.py", [str(two_net_board(tmp_path)), str(tmp_path / "out.kicad_pcb"), "--nets", "A"],
            cwd=tmp_path, env=clean_env(), timeout=30, on_line=lines.append, cancel=threading.Event())
    assert r.returncode == 0 and r.summary["successful"] == 1 and "[1/1] Routing A (id=1)" in lines

def test_timeout_kills_only_the_router_group(fake_krt, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep"); monkeypatch.setenv("FAKE_KRT_PIDFILE", str(tmp_path / "pid"))
    r = run(locate(), "signals", "route.py", ARGS, cwd=tmp_path, env=clean_env(), timeout=1.0, on_line=print, cancel=threading.Event())
    assert r.returncode == -9 and "timed out after 1 s" in r.log and r.seconds < 5
    with pytest.raises(ProcessLookupError): os.kill(int((tmp_path / "pid").read_text()), 0)

def test_cancel_stops_the_step(fake_krt, tmp_path, monkeypatch): ...   # sleep mode, cancel set by a 0.5 s timer -> returncode -15, "cancelled" in log, pid gone

def test_no_display_and_no_window_flags(fake_krt, tmp_path, monkeypatch):
    monkeypatch.setenv("DISPLAY", ":0"); monkeypatch.setenv("FAKE_KRT_MODE", "env")
    lines = []; run(locate(), "s", "route.py", ARGS, cwd=tmp_path, env=krt_env(fake_kicad(tmp_path)), timeout=30, on_line=lines.append, cancel=threading.Event())
    seen = json.loads(lines[0])
    assert "DISPLAY" not in seen and "WAYLAND_DISPLAY" not in seen
    assert (seen["SDL_VIDEODRIVER"], seen["MPLBACKEND"], seen["PYTHONHASHSEED"]) == ("dummy", "Agg", "0")
    with pytest.raises(ValueError): run(locate(), "s", "route.py", [*ARGS, "--visualize"], cwd=tmp_path, env={}, timeout=1, on_line=print, cancel=threading.Event())

def test_cli_status(fake_krt): ...   # run_cli("router", "status") -> exit 0, json "installed": true

# test_hygiene.py
def test_no_gpl_code(): ...          # grep kernel/src for "GNU General Public License" and "SPDX-License-Identifier: GPL"

@pytest.mark.network
def test_real_install_into_a_temp_cache(tmp_path):
    env = {**os.environ, "PINO_CACHE_DIR": str(tmp_path)}
    krt = install(env)
    assert krt.version == "0.17.7" and check(krt) == [] and "--no-fix-drc-settings" in krt.flags["route.py"]
    stamp = (tmp_path / "krt" / KRT_COMMIT[:12] / "stamp.json").stat().st_mtime_ns
    ensure(env); assert (tmp_path / "krt" / KRT_COMMIT[:12] / "stamp.json").stat().st_mtime_ns == stamp
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_krt.py tests/test_hygiene.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.routing'`

- [x] **Step 3: Write `routing/krt.py`, the CLI subcommand and the NOTICE section**

- `install`: under `fcntl.flock` on `<cache>/krt/<commit12>.lock`, in `<commit12>.tmp-<pid>/`: `git init src`, `git -C src fetch --depth 1 <PINO_KRT_REPO or KRT_REPO> <KRT_COMMIT>`, `git -C src checkout FETCH_HEAD`; venv `uv venv --python 3.12 venv` when `uv` is on PATH, else `python3.12 -m venv venv`; `uv pip install --python venv/bin/python <KRT_DEPS>` (or the venv's pip); `venv/bin/python build_router.py --tag v0.17.7` with `cwd=src` (it falls back to `cargo` by itself); `check()`; probe each script's `--help` into `flags`; write `stamp.json` last; rename the temp folder onto `<commit12>/`. Every failure removes the temp folder and raises `RouterMissing` whose message names the failed step in plain words ("could not fetch KiCadRoutingTools from <repo>: <last line>. pino needs network access once to install its router; run `pino-kernel router install` again when online, or set PINO_KRT_DIR and PINO_KRT_PYTHON to a checkout you made yourself.").
- `check`: `VERSION` equals `KRT_VERSION`; for the cache install, `stamp.json` commit equals `KRT_COMMIT`; `python -c "import sys; sys.path.insert(0, ROOT); import startup_checks; startup_checks.run_all_checks()"` exits 0 within 60 s.
- `run`: scripts run as `<python> <root>/<script> <args>` (not `-I`: KRT imports sibling modules), `cwd` given, stdout and stderr merged and read line by line, `start_new_session=True`. `JSON_SUMMARY: ` lines are parsed. Timeout or cancel kills the child's process group (SIGTERM, then SIGKILL after 5 s) and sets returncode `-9` or `-15` with "timed out after <n> s" or "cancelled" in `log`.
- `krt_env`: `kicad.env()` (no display, isolated KiCad home, library variables) plus `PYTHONHASHSEED=0`, `PYTHONDONTWRITEBYTECODE=1`, `SDL_VIDEODRIVER=dummy`, `MPLBACKEND=Agg`, and `PATH` with the kicad-cli folder first (KRT's plane repair calls kicad-cli itself).
- `NOTICE`: a "KiCadRoutingTools" section: what it is, the repo URL, the commit, "MIT License, Copyright (c) 2026 drandyhaas", that pino does not include its code and fetches it on first use into the user cache. (If the pcb-kit section still lives in `kernel/NOTICE`, add this one beside it.)

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_krt.py tests/test_hygiene.py -v`
Expected: PASS (the `network` test skips with its marker message)

- [x] **Step 5: Commit**

```bash
git add NOTICE kernel/src/pino_kernel/routing kernel/src/pino_kernel/cli.py kernel/tests/fake_krt kernel/tests/conftest.py kernel/tests/test_krt.py kernel/tests/test_hygiene.py
git commit -m "kernel: KiCadRoutingTools pinned, installed on first use into the user cache, version checked"
```

**Plan fixes (implementation):**
- KRT pin: tag `v0.17.7` is commit `bc48cce8ac603d5300b24eebddd993098a20d0e4`; the plan's `6ab59a6` is two later commits that touch only docs and a stress test. Per the director's call, `KRT_COMMIT` is the tag's commit, so the release's prebuilt core matches it. `ROUTER_ID` is `KiCadRoutingTools 0.17.7 bc48cce8ac60`.
- Install does not run `build_router.py` (it falls back to `cargo` when the download fails). pino downloads `grid_router-linux-x86_64.so` from the v0.17.7 release itself and checks its pinned sha256 (`KRT_CORE`); other machines get a plain-words finding.
- uv's and pip's caches and any Python uv downloads go under `<cache>/krt/` (`UV_CACHE_DIR`, `PIP_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`), so the install writes nowhere else.
- `PINO_KRT_DIR` installs have their flags probed with `--help` once per process; cache installs read them from `stamp.json`.
- conftest: an autouse fixture gives every test its own `PINO_CACHE_DIR`; `krt` tests get the router found in the environment pytest started in (read only). Extra tests: a stamp from another commit is refused, `router status` when missing, kicad-cli's folder first on PATH.

---

### Task 2: board.py library: kept routes, fixed vias, route hints, differential pairs (interface change: circuit model)

**Files:**
- Modify: `kernel/src/pino_kernel/circuit.py`, `kernel/src/pino/board.py`, `kernel/src/pino/__init__.py`, `kernel/src/pino_kernel/__init__.py` (`__version__ = "0.2.0"`)
- Test: `kernel/tests/test_pino_routes.py`, `kernel/tests/test_circuit.py` (two tests added)

**Interfaces:**
- Consumes: `Board`, `Part`, `PinSet`, `NetSpec`, `PinRef`, `CircuitError`, `fab.FabProfile` (engine Tasks 4 to 6).
- Produces:
  - `circuit.PairSpec(name: str, positive: str, negative: str, width: float | None, gap: float | None, line)`; `name` is the shared base (`"USB_D"`).
  - `circuit.RouteStep(kind: str, x: float, y: float, layer: str | None)`; `kind` in `point|via`; a via step's `layer` is the layer the route continues on.
  - `circuit.KeptRoute(net: str, frm: PinRef | tuple[float, float], to: PinRef | tuple[float, float], layer: str, width: float | None, steps: list[RouteStep], line)`.
  - `circuit.FixedVia(net: str, x: float, y: float, diameter: float | None, drill: float | None, line)`.
  - `circuit.RouteHint(net: str, region: tuple[float, float, float, float] | None, layers: list[str] | None, corridor: list[tuple[float, float]] | None, rip: list[str], line)`.
  - `Circuit` gains, after its last field: `pairs`, `kept_routes`, `fixed_vias`, `route_hints` (lists, default empty). `from_json` reads a missing key as `[]`.
  - `pino.via(x: float, y: float, *, to: str) -> RouteStep`.
  - `Board.keep_route(net: str | NetSpec, *, frm: PinSet | tuple[float, float], to: PinSet | tuple[float, float], layer: str, points: Sequence[tuple[float, float] | RouteStep] = (), width: float | None = None) -> None`.
  - `Board.fixed_via(net: str | NetSpec, *, at: tuple[float, float], diameter: float | None = None, drill: float | None = None) -> None`.
  - `Board.route_hint(net: str | NetSpec, *, region: tuple[float, float, float, float] | None = None, layers: Sequence[str] | None = None, corridor: Sequence[tuple[float, float]] | None = None, rip: Sequence[str] = ()) -> None`.
  - `Board.diff_pair(positive: str | NetSpec, negative: str | NetSpec, *, width: float | None = None, gap: float | None = None) -> None`.
  - `pino` exports `via`. `width`, `diameter`, `drill` and `gap` left as `None` are resolved by the board writer (Task 3) from the net's class.

- [x] **Step 1: Write the failing tests**

```python
def test_keep_route_records_pins_steps_and_line(fixture_libs):
    b = small_board(); j1, u1 = b.part("J1"), b.part("U1")
    b.keep_route("VBUS", frm=j1[1], to=u1["VIN"], layer="F.Cu", points=[(2.0, 1.0), via(3.0, 1.0, to="B.Cu"), (5.0, 1.0)])
    k = b.to_circuit().kept_routes[0]
    assert (k.net, k.frm, k.to, k.layer, k.width) == ("VBUS", PinRef("J1", "1"), PinRef("U1", "1"), "F.Cu", None)
    assert k.steps == [RouteStep("point", 2.0, 1.0, None), RouteStep("via", 3.0, 1.0, "B.Cu"), RouteStep("point", 5.0, 1.0, None)]
    assert k.line > 0

def test_keep_route_pin_on_another_net(fixture_libs):
    b = small_board()
    with pytest.raises(CircuitError, match=r"keep_route VBUS: U2\.6 is on net \w+, not VBUS"):
        b.keep_route("VBUS", frm=b.part("U2")[6], to=b.part("U1")["VIN"], layer="F.Cu"); b.validate()

def test_keep_route_needs_one_pin(fixture_libs):    # frm=j1["VBUS"] is 4 pins
    with pytest.raises(CircuitError, match="frm must be one pin"): ...

def test_keep_route_width_below_the_fab(fixture_libs):   # width=0.1 on 2 layers
    with pytest.raises(CircuitError, match="below the fab's 0.15 mm"): ...

def test_via_step_must_change_layer(fixture_libs):       # via(3, 1, to="F.Cu") while on F.Cu
    with pytest.raises(CircuitError, match=r"via at \(3, 1\) does not change layer"): ...

def test_route_hint_records_region_layers_rip(fixture_libs):
    b = small_board(); b.route_hint("VBUS", region=(-5, -5, 5, 5), layers=["B.Cu"], rip=["*"])
    assert b.to_circuit().route_hints[0] == RouteHint("VBUS", (-5.0, -5.0, 5.0, 5.0), ["B.Cu"], None, ["*"], ANY_LINE)

def test_route_hint_bad_region_and_layer(fixture_libs): ...   # (5, 5, -5, -5) -> "region must be (x0, y0, x1, y1) with x0 < x1 and y0 < y1"; "In1.Cu" on 2 layers -> "this board has no In1.Cu"

def test_diff_pair_recorded(fixture_libs):
    c = board_with_usb_pair().to_circuit()                 # helper: nets USB_D+ and USB_D-
    assert c.pairs == [PairSpec("USB_D", "USB_D+", "USB_D-", None, None, ANY_LINE)]

def test_diff_pair_names_must_pair(fixture_libs):          # nets "DP" and "DM"
    with pytest.raises(CircuitError, match="named like USB_D\\+ and USB_D- or USB_D_P and USB_D_N"): ...

def test_net_in_two_pairs(fixture_libs): ...               # "net USB_D+ is in two diff pairs"
def test_fixed_via_unknown_net(fixture_libs): ...          # "fixed_via: no net GNDD"

# test_circuit.py
def test_old_circuit_json_still_loads(sample_circuit):
    data = json.loads(sample_circuit.to_json())
    for k in ("pairs", "kept_routes", "fixed_vias", "route_hints"): data.pop(k)
    c = Circuit.from_json(json.dumps(data))
    assert (c.pairs, c.kept_routes, c.fixed_vias, c.route_hints) == ([], [], [], [])

def test_round_trip_with_routes(sample_circuit_with_routes):
    text = sample_circuit_with_routes.to_json()
    assert Circuit.from_json(text) == sample_circuit_with_routes and Circuit.from_json(text).to_json() == text
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_pino_routes.py tests/test_circuit.py -v`
Expected: FAIL with `ImportError: cannot import name 'via' from 'pino'`

- [x] **Step 3: Extend the model and the library**

- Pair names: positive and negative must be `<base>+`/`<base>-` or `<base>_P`/`<base>_N` with one base (KRT pairs nets by these suffixes). The pair's name is the base.
- Checks that need the whole board (nets exist, pins on the net, layers, widths against `fab.min_track`, via sizes against `fab.min_via_diameter` and `fab.min_via_drill`) run in `validate()`; argument shape checks (one pin, region order, corridor of at least two points, empty rip pattern) raise at the call. Every problem carries the call's line.
- `frm`/`to` given as a point is allowed (a route that joins copper at a T); its own check is only "inside the outline's bounding box".

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_pino_routes.py tests/test_circuit.py tests/test_pino_parts.py tests/test_pino_intent.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino kernel/src/pino_kernel/circuit.py kernel/src/pino_kernel/__init__.py kernel/tests/test_pino_routes.py kernel/tests/test_circuit.py kernel/tests/helpers.py
git commit -m "pino: keep_route, fixed_via, route_hint and diff_pair in the board.py library"
```

**Plan fixes (implementation):**
- `test_keep_route_pin_on_another_net`: U2.6 is on `+3V3`, which `\w+` cannot match; the test uses `\S+`.
- Layer names are checked at the call (the engine's `_layers` helper already raises there); nets, pins on the net, widths, via sizes and points inside the outline are checked in `validate()`.
- `KeptRoute` has its own JSON form: an end is `[ref, number]` (strings) for a pin or `[x, y]` (numbers) for a point. `circuit.pair_base()` holds the pair-name rule for Task 3 and Task 5.
- The engine's `test_cli.py` asserted the kernel version `0.1.0`; it now compares with `__version__`.
- Helpers: `ANY_LINE`, `usb_nets_board_py`, `board_from_text`, `board_with_usb_nets`, `board_with_usb_pair` in `tests/helpers.py`; the round-trip test builds its circuit with `_with_routes(sample_circuit)`.

---

### Task 3: The board writer writes kept copper (interface change: write_board output)

**Files:**
- Modify: `kernel/src/pino_kernel/pcb/writer.py`, `kernel/src/pino_kernel/pcb/rules.py`, `kernel/src/pino_kernel/build.py` ("checks" step)
- Create: `kernel/src/pino_kernel/checks/kept.py`
- Test: `kernel/tests/test_kept_copper.py`

**Interfaces:**
- Consumes: Task 2 types; `write_board`, `Placed`, `pad_world`, `copper_layers` (engine Tasks 10, 11); `ids.uid`; `coords.to_kicad`.
- Produces:
  - `rules.DEFAULT_TRACK_WIDTH`, `rules.DEFAULT_CLEARANCE`, `rules.DEFAULT_VIA_DIAMETER`, `rules.DEFAULT_VIA_DRILL`: the Default net class values `kicad_pro` already writes, named (no change to the written file).
  - `rules.net_rules(circuit: Circuit, fab: FabProfile, net: str) -> tuple[float, float, float, float]` (width, clearance, via diameter, via drill): the net's class values, unset ones from the Default class.
  - `writer.kept_copper(circuit: Circuit, placed: list[Placed], fab: FabProfile) -> list[list]`: top-level `segment` and `via` nodes, every one `(locked yes)`. A kept route runs from the `frm` pad centre through its steps to the `to` pad centre; a via step ends the current layer's segment and starts the next. Vias are through vias (`(layers "F.Cu" "B.Cu")`). UUIDs: `ids.uid("kept", net, str(i), "seg", str(k))`, `ids.uid("kept", net, str(i), "via", str(k))`, `ids.uid("fixed-via", net, str(i))`.
  - `write_board` puts those nodes in the board where KiCad 10 saves tracks and vias (the resave test pins the place).
  - `checks.kept.kept_findings(circuit: Circuit, placed: list[Placed]) -> list[Finding]`: source `routing`, code `kept_route_bent` (warning) when a written segment's angle is not a multiple of 45 degrees within 0.5 degrees; message "kept route VBUS (board.py line 31): the leg from J1.1 runs at 37 degrees; the pad may have moved. Route it again or update the points."; `at` the segment start.
  - `checks.kept.pair_findings(circuit: Circuit) -> list[Finding]`: source `routing`, code `pair_undeclared` (warning) for two nets whose names pair (Task 2's rule) with no `diff_pair`: "nets USB_D+ and USB_D- look like a differential pair; declare it with b.diff_pair(\"USB_D+\", \"USB_D-\") so the router couples them".

- [x] **Step 1: Write the failing tests**

```python
def test_kept_route_becomes_locked_segments_and_a_via(fixture_libs, fp_lib):
    files = write(board_with_kept_route())              # helper: keep_route VBUS J1.1 -> U1.VIN, one via to B.Cu
    segs, vias = top_level(files.kicad_pcb, "segment"), top_level(files.kicad_pcb, "via")
    assert len(segs) == 3 and len(vias) == 1 and all(find(n, "locked") for n in segs + vias)
    assert [find(s, "layer")[1] for s in segs] == ["F.Cu", "F.Cu", "B.Cu"]
    assert start_of(segs[0]) == pytest.approx(pad_centre_kicad(files, "J1", "1"))

def test_kept_route_follows_the_pad(fixture_libs, fp_lib):
    a, b = write(board_with_kept_route(j1_at=(0, -10))), write(board_with_kept_route(j1_at=(2, -10)))
    assert start_of(top_level(b.kicad_pcb, "segment")[0])[0] - start_of(top_level(a.kicad_pcb, "segment")[0])[0] == pytest.approx(2.0)

def test_width_and_via_from_the_net_class(fixture_libs, fp_lib):
    segs = top_level(write(board_with_kept_route(power_class=0.5)).kicad_pcb, "segment")
    assert {find(s, "width")[1] for s in segs} == {"0.5"}

def test_kept_uuids_are_stable_across_hash_seeds(fixture_libs, tmp_path): ...   # subprocess digests for PYTHONHASHSEED 1 and 98765
def test_no_kept_copper_no_tracks(fixture_libs): ...                             # small_board() board has no segment or via

def test_bent_leg_is_a_warning(fixture_libs, fp_lib):
    f = kept_findings(*circuit_and_placed(board_with_kept_route(points=[(3.7, -8.1)])))
    assert f[0].code == "kept_route_bent" and "board.py line" in f[0].message and f[0].at.space == "board"

def test_undeclared_pair_is_suggested(fixture_libs):
    assert [f.code for f in pair_findings(board_with_usb_nets().to_circuit())] == ["pair_undeclared"]
    assert pair_findings(board_with_usb_pair().to_circuit()) == []

@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_kept_copper_survives_kicad_resave(kicad, tmp_path):
    out = write_real_board(tmp_path, 2, kept=True); filled = refill_copy(kicad, out)
    assert {k for k, _ in changed_items(out.read_text(), filled.read_text())} == {"zone"}
    assert not {"track_dangling", "via_dangling"} & drc_types(kicad, filled)
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_kept_copper.py -v`
Expected: FAIL with `ImportError: cannot import name 'kept_copper'`

- [x] **Step 3: Write `kept_copper`, the two checks and their place in the build**

Pad centres come from `pad_world`, then `coords.to_kicad`. The build's "checks" step adds `kept_findings` and `pair_findings`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_kept_copper.py tests/test_board_writer.py tests/test_build.py -v`
Expected: PASS (kicad tests pass or skip with the marker messages)

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/pcb kernel/src/pino_kernel/checks/kept.py kernel/src/pino_kernel/build.py kernel/tests/test_kept_copper.py kernel/tests/helpers.py
git commit -m "kernel: kept routes and fixed vias written as locked copper, with bent-leg and pair findings"
```

**Plan fixes (implementation):**
- The test route goes down to B.Cu and back up (two vias), because U1.VIN is an SMD pad on F.Cu: three segments on F.Cu, B.Cu, F.Cu. The plan's `[F, F, B]` would end on B.Cu at a top pad.
- KiCad 10 writes a via's `(locked yes)` after `(layers ...)` and sorts tracks by layer id (a via by its first layer), then segment, arc, via, then UUID (seen in a kicad-cli resave). `writer.track_order` and `writer.layer_id` hold that rule; tests find a route's legs by their UUIDs.
- `writer.kept_geometry()` gives the legs and vias in board mm; `kept_copper` and `kept_findings` both use it. `rules.default_rules(fab)` gives the Default class as written.
- The resave test uses a kept route on the real board's LED net (R2.2 up to a via, across B.Cu, a via, down to D1.2), with pads from `pad_world`. Extra tests: default width, a fixed via, straight legs, the build reporting both findings.

---

### Task 4: Copper in the board text: read, merge, UUIDs, cleanup

**Files:**
- Create: `kernel/src/pino_kernel/pcb/copper.py`, `kernel/src/pino_kernel/pcb/cleanup.py` (ports `EPS`, `key`, `collinear`, `within`, `plan` from pcb-kit `pcbkit/checks/cleanup_tracks.py` with the engine's MIT header; `dangling` is rebuilt without pcbnew), `kernel/tests/copper_boards.py`
- Modify: `kernel/src/pino_kernel/geometry.py` (additions), `NOTICE` (ported files list)
- Test: `kernel/tests/test_copper.py`, `kernel/tests/test_cleanup.py`

**Interfaces:**
- Consumes: `sexpr`, `ids.uid`, `coords.from_kicad`, `coords.to_kicad`, `geometry`.
- Produces:
  - `geometry.point_segment_distance(p, a, b) -> float`, `geometry.segment_distance(a, b, c, d) -> float`, `geometry.segment_polygon_distance(a, b, poly) -> float` (0 when they meet).
  - `copper.Track(uuid, net, layer, width, a: Point, b: Point, locked: bool)`, `Arc(uuid, net, layer, width, start, mid, end, locked)`, `Via(uuid, net, at: Point, diameter, drill, layers: tuple[str, str], locked)`, `PadShape(ref, number, net, layers: tuple[str, ...], polygon: Polygon, size: tuple[float, float], drill: float | None, through: bool)`, `Fill(net, layer, zone: str, polygon: Polygon)` (one per `filled_polygon` island), `Copper(tracks, arcs, vias, pads, fills, layers: list[str])`. All positions board mm (outline frame).
  - `read_copper(text: str) -> Copper` (pads: footprint position and angle, pad offset, absolute pad angle, back side as KiCad stores it; shapes rect, roundrect, oval, circle, trapezoid as polygons; custom pads as their `size` rectangle).
  - `copper_nodes(text: str) -> list[list]`: top-level `segment`, `arc`, `via` nodes in file order.
  - `merge_copper(board_text: str, nodes: Sequence[list]) -> str`: drops the board's unlocked top-level copper, keeps its locked copper, adds `nodes` except those equal to a kept locked item (same kind, net, layer, width and ends to 1 nm), in the board's track place; output through `sexpr.dump`.
  - `rewrite_uuids(nodes: Sequence[list]) -> list[list]`: unlocked nodes sorted by (kind, layer, net, rounded geometry, width) and given `ids.uid("copper", kind, net, layer, <coordinates and width as num() strings>)`, a `#2`, `#3` suffix for equal ones; locked nodes unchanged.
  - `copper_json(copper: Copper) -> str`: `{"schema": "pino.copper/1", "tracks": [...], "arcs": [...], "vias": [...]}`, each item with `uuid, net, layer(s), width or diameter/drill, points, kept` (`kept` = locked), sorted by uuid, `json.dumps(indent=1, sort_keys=True)` plus newline, floats to 6 decimals.
  - `strip_copper(text: str) -> str`: removes top-level `segment`/`arc`/`via` and every zone's `filled_polygon` (the spike's `strip_copper.py`, pino's own code).
  - `move_footprint(text: str, ref: str, dx: float, dy: float) -> str`: moves one footprint and the zones it owns, board mm.
  - `cleanup.CleanupReport(removed: dict[str, str], merged: int)` (uuid to reason: `zero-length`, `duplicate`, `covered`, `merged`, `dangling`).
  - `cleanup.cleanup(text: str, copper: Copper) -> tuple[str, CleanupReport]`: the ported `plan` on unlocked segments (EPS 0.001 mm), then dangling leaves peeled one at a time: an unlocked segment with an end that touches nothing of its net on its layer (pad, via, other track, fill island) and whose other neighbours all meet at its other end. Applied to the text by UUID. Locked copper is never touched.

- [x] **Step 1: Write the failing tests**

`copper_boards.py` builds board texts with `sexpr.dump`: `board(footprints=[fp("R1", at=(x, y, rot), pads=[...], back=False)], tracks=[...], vias=[...], zones=[...])`, coordinates in board mm.

```python
def test_read_copper_in_board_frame():
    c = read_copper(board(tracks=[track("A", (-5, 2), (5, 2), 0.2, "F.Cu")]))
    t = c.tracks[0]; assert (t.a, t.b, t.layer, t.net, t.locked) == ((-5.0, 2.0), (5.0, 2.0), "F.Cu", "A", False)

def test_pad_polygons_turn_and_flip():
    c = read_copper(board(footprints=[fp("R1", at=(10, 5, 90), pads=R0603), fp("R2", at=(0, 0, 0), pads=R0603, back=True)]))
    assert bbox(pad(c, "R1", "1").polygon) == pytest.approx((9.6, 4.6, 10.4, 5.4), abs=0.01)
    assert pad(c, "R2", "1").layers == ("B.Cu", "B.Mask", "B.Paste")

def test_fills_are_islands(): ...        # one zone with two filled_polygon -> two Fill with the same zone name

def test_merge_keeps_locked_and_replaces_the_rest():
    base = board(tracks=[track("A", (0, 0), (1, 0), locked=True, uuid=U1), track("B", (0, 1), (1, 1), uuid=U2)])
    out = read_copper(merge_copper(base, copper_nodes(board(tracks=[track("A", (0, 0), (1, 0), locked=True), track("C", (0, 2), (1, 2))]))))
    assert sorted((t.net, t.locked) for t in out.tracks) == [("A", True), ("C", False)]
    assert [t.uuid for t in out.tracks if t.net == "A"] == [U1]

def test_rewrite_uuids_is_order_free_and_unique():
    nodes = copper_nodes(KRT_LIKE)                          # 40 segments, 5 vias, two equal segments
    a, b = rewrite_uuids(nodes), rewrite_uuids(list(reversed(nodes)))
    assert [dump(n) for n in a] == [dump(n) for n in b] and len({uuid_of(n) for n in a}) == len(a)

def test_net_names_with_plus_quotes_and_unicode_survive_merge():
    nets = ["+3V3", "Net-(R1-Pad2)", "Ω_SENSE", 'A"B']
    out = read_copper(merge_copper(board(), copper_nodes(board(tracks=[track(n, (0, i), (1, i)) for i, n in enumerate(nets)]))))
    assert sorted(t.net for t in out.tracks) == sorted(nets)

def test_copper_json_is_canonical():
    c = read_copper(KRT_LIKE); assert copper_json(c) == copper_json(read_copper(KRT_LIKE))
    assert json.loads(copper_json(c))["schema"] == "pino.copper/1"

def test_strip_and_move(): ...           # strip leaves footprints and zone outlines; move_footprint shifts the footprint and its zone by (1, 0)

# test_cleanup.py
def test_plan_reasons():
    text, report = cleanup(STUBS, read_copper(STUBS))       # one each: zero-length, duplicate, covered, two collinear halves
    assert sorted(set(report.removed.values())) == ["covered", "duplicate", "merged", "zero-length"] and report.merged == 1

def test_dead_end_chain_goes_whole_and_never_splits_a_net():
    text, report = cleanup(DEAD_END, read_copper(DEAD_END))   # pad -> 2-segment dead end; plus a segment joining two pads
    assert list(report.removed.values()) == ["dangling", "dangling"]
    assert len(read_copper(text).tracks) == 1

def test_locked_copper_is_never_touched(): ...              # a locked dead end stays
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_copper.py tests/test_cleanup.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.pcb.copper'`

- [x] **Step 3: Write `copper.py`, `cleanup.py` and the geometry additions**

Contact rule for `dangling` (and Task 7): items of one net touch when their copper shapes, grown by 0.02 mm (pcb-kit's `TOUCH`), meet on a shared layer; a via touches on both its layers; a through-hole pad on every copper layer. Fill islands come from the board text given (the caller refills first).

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_copper.py tests/test_cleanup.py tests/test_geometry.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add NOTICE kernel/src/pino_kernel/pcb/copper.py kernel/src/pino_kernel/pcb/cleanup.py kernel/src/pino_kernel/geometry.py kernel/tests/copper_boards.py kernel/tests/test_copper.py kernel/tests/test_cleanup.py
git commit -m "kernel: copper read, merge, hashed UUIDs and cleanup in the board text (cleanup plan ported from pcb-kit, MIT)"
```

**Plan fixes (implementation):**
- `test_pad_polygons_turn_and_flip` uses the helper's R0603 (pads at x = ±0.8, 0.9 x 0.8 mm), so a 90 degree turn shows: pad 1 of R1 at (10, 5, 90) spans (9.6, 3.75, 10.4, 4.65). The plan's box assumed a pad at the footprint origin.
- Additive: `PadShape.centre`, `Copper.unfilled` (zone outlines with no fill on a layer: a track touching one is never peeled, as in pcb-kit), `geometry.polygon_distance`, and in `copper.py` the contact rule shared with Task 7 (`Item`, `items_of`, `touch`, `holds`, `contact_map`, `TOUCH = 0.02`).
- Merged copper is sorted in KiCad's save order (`writer.track_order`) and goes before the first zone. A routed node equal to a kept locked item (either direction) is dropped.
- `cleanup` runs the ported plan first, then peels dangling leaves on the copper the plan left, and edits the parsed text by UUID.

---

### Task 5: Route plan and route key

**Files:**
- Create: `kernel/src/pino_kernel/routing/plan.py`, `kernel/src/pino_kernel/routing/key.py`
- Test: `kernel/tests/test_route_plan.py`, `kernel/tests/test_route_key.py`

**Interfaces:**
- Consumes: `read_copper`, `Copper`, `PadShape` (Task 4); `PairSpec`, `RouteHint`, `Circuit` (Task 2); `ROUTER_ID` (Task 1); `geometry.circle_polygon`; `sexpr`.
- Produces:
  - `RouterRules(track_width, clearance, via_diameter, via_drill, min_track, min_clearance, hole_clearance, hole_to_hole, edge_clearance)`.
  - `router_rules(pro_text: str, dru_text: str | None) -> RouterRules`: Default class from `net_settings.classes`; minimums from `board.design_settings.rules` (`min_track_width`, `min_clearance`, `min_hole_clearance` (0.25 when absent, KiCad's default), `min_hole_to_hole`, `min_copper_edge_clearance`), each raised to the matching `"pino: <limit>"` rule of the `.kicad_dru` when present. Then the hole-clearance gap (KRT ignores a hole clearance larger than copper clearance): `via_diameter = max(via_diameter, via_drill + 2 * (hole_clearance - min_clearance))`, rounded up to 0.01 mm.
  - `net_class_widths(pro_text: str, nets: Iterable[str]) -> dict[str, float]` (each net's class track width by the `netclass_patterns`, `fnmatch` style; Default when none).
  - `FanoutStep(ref, pitch, width, clearance)`, `PairStep(name, positive, negative, width, gap)`, `PlaneStep(net, layers: list[str])`, `PowerNet(net, width)`, `HintStep(net, region, layers, corridor, rip: list[str], line)`, `RouterKeepout(name: str, polygon: Polygon, layers: list[str])`.
  - `RoutePlan(layers, rules: RouterRules, grid_step: float, fanout, pairs, planes, power, signals: list[str], hints, keepouts, warnings: list[Finding])` with `to_json() -> str`, `RoutePlan.from_json(text) -> RoutePlan`.
  - `plan_route(board_text: str, pro_text: str, dru_text: str | None, *, pairs: Sequence[PairSpec] = (), hints: Sequence[RouteHint] = (), planes: Mapping[str, Sequence[str]] | None = None) -> RoutePlan`.
  - `plan_for_build(build_dir: Path) -> RoutePlan` (reads `board.kicad_pcb`, `board.kicad_pro`, `board.kicad_dru`, `circuit.json`).
  - `fab_overrides_text(rules: RouterRules) -> str`.
  - `region_keepouts(region: tuple[float, float, float, float], board_box: tuple[float, float, float, float], layers: list[str]) -> list[RouterKeepout]`.
  - `hole_keepouts(copper: Copper, rules: RouterRules) -> list[RouterKeepout]`.
  - `add_router_items(board_text: str, keepouts: Sequence[RouterKeepout], corridor: Sequence[Point] | None = None) -> str`; `strip_router_items(board_text: str, prefix: str = "pino-router:") -> str`.
  - `key.RouteKey(key: str, parts: dict[str, str])` with `to_json()`, `from_json()`; `PARTS = ("nets", "placement", "footprints", "outline", "zones", "kept", "rules", "plan", "router")`.
  - `key.route_key(board_text: str, pro_text: str, dru_text: str | None, plan: RoutePlan, *, router_id: str = ROUTER_ID, kernel_version: str = __version__) -> RouteKey`.
  - `key.stale_reasons(old: RouteKey, new: RouteKey) -> list[str]`, in `PARTS` order, words: `connections changed`, `parts moved`, `footprints changed`, `outline changed`, `zones or keep-outs changed`, `kept copper changed`, `rules changed`, `routing instructions changed`, `router or kernel version changed`.

- [x] **Step 1: Write the failing tests**

`PRO_2L` and `DRU_2L` are hand-written in the test: Default class 0.2 / 0.2 / via 0.6 / 0.3; rules `min_track_width 0.15`, `min_clearance 0.15`, `min_hole_clearance 0.25`, `min_hole_to_hole 0.5`, `min_copper_edge_clearance 0.3`; `power` class 0.5 on `VBUS` and `+3V3`.

```python
def test_rules_from_pro_and_dru():
    assert router_rules(PRO_2L, DRU_2L) == RouterRules(0.2, 0.2, 0.6, 0.3, 0.15, 0.15, 0.25, 0.5, 0.3)

def test_hole_clearance_gap_grows_the_via():
    rr = router_rules(pro(clearance=0.15, min_clearance=0.15, via=(0.45, 0.3), hole_clearance=0.254), None)
    assert rr.via_diameter == 0.51

def test_fab_overrides_file():
    assert fab_overrides_text(router_rules(PRO_2L, DRU_2L)).splitlines() == [
        "track_width = 0.15", "clearance = 0.15", "via_diameter = 0.6", "via_drill = 0.3", "hole_to_hole = 0.5"]

def test_fanout_only_for_four_sided_fine_pitch():
    p = plan_route(board_with(QFN32_05, USB_C, SOT23, ESP32_MODULE), PRO_2L, DRU_2L)
    assert [s.ref for s in p.fanout] == ["U1"] and p.grid_step == 0.05
    assert plan_route(board_with(SOT23), PRO_2L, DRU_2L).grid_step == 0.1

def test_planes_from_zones_and_signals_exclude_planes_and_pairs():
    p = plan_route(board_with_gnd_zone_and_usb(), PRO_2L, DRU_2L, pairs=[PairSpec("USB_D", "USB_D+", "USB_D-", None, None, 1)])
    assert p.planes == [PlaneStep("GND", ["B.Cu"])] and not {"GND", "USB_D+", "USB_D-"} & set(p.signals)
    assert p.pairs[0].width == 0.2 and p.pairs[0].gap == 0.2 and p.signals == sorted(p.signals)

def test_power_widths_from_net_classes():
    assert plan_route(board_with_power_nets(), PRO_2L, DRU_2L).power == [PowerNet("+3V3", 0.5), PowerNet("VBUS", 0.5)]

def test_rip_never_names_kept_or_plane_nets():
    p = plan_route(board_with_locked_vbus_and_gnd_zone(), PRO_2L, DRU_2L, hints=[RouteHint("SDA", None, None, None, ["*"], 9)])
    assert "*" not in p.hints[0].rip and not {"VBUS", "GND"} & set(p.hints[0].rip) and "SCL" in p.hints[0].rip

def test_region_keepouts_cover_the_rest():
    ks = region_keepouts((-5, -5, 5, 5), (-20, -15, 20, 15), ["F.Cu", "B.Cu"])
    assert len(ks) == 4 and not any(point_in_polygon((0, 0), k.polygon) for k in ks)
    assert sum(point_in_polygon((10, 0), k.polygon) for k in ks) == 1

def test_npth_holes_get_router_keepouts():
    ks = hole_keepouts(read_copper(board_with_mounting_holes()), router_rules(PRO_2L, DRU_2L))
    assert [k.name for k in ks] == ["pino-router:hole:H1", "pino-router:hole:H2", "pino-router:hole:H3", "pino-router:hole:H4"]
    assert max(distance((-24.5, 18.5), pt) for pt in ks[0].polygon) == pytest.approx(1.6 + 0.25 + 0.1, abs=0.02)

def test_router_items_are_rule_areas_and_strip_cleanly():
    text = add_router_items(BOARD, region_keepouts((-5, -5, 5, 5), (-20, -15, 20, 15), ["F.Cu"]), corridor=[(0, 0), (5, 5)])
    z = [n for n in find_all(parse(text), "zone") if str(find(n, "name")[1]).startswith("pino-router:")]
    assert len(z) == 4 and all(find(find(n, "keepout"), "tracks")[1] == "not_allowed" for n in z)
    assert strip_router_items(text) == BOARD

def test_plan_json_round_trip(): ...

# test_route_key.py
def test_value_change_keeps_the_key():
    assert route_key(board_text(r1="10k"), PRO_2L, DRU_2L, PLAN).key == route_key(board_text(r1="4.7k"), PRO_2L, DRU_2L, PLAN).key

def test_move_and_net_change_name_the_reason():
    a = route_key(board_text(), PRO_2L, DRU_2L, PLAN)
    assert stale_reasons(a, route_key(board_text(r1_at=(3, 0)), PRO_2L, DRU_2L, PLAN)) == ["parts moved"]
    assert stale_reasons(a, route_key(board_text(r1_pad1_net="B"), PRO_2L, DRU_2L, PLAN)) == ["connections changed"]
    assert stale_reasons(a, route_key(board_text(), pro(clearance=0.25), DRU_2L, PLAN)) == ["rules changed"]

def test_key_ignores_uuids_silk_and_formatting(): ...   # re-indented text, other footprint UUIDs, other silk text -> same key
def test_kept_copper_changes_the_key(): ...             # one locked segment added -> ["kept copper changed"]
def test_key_is_twelve_hex(): assert re.fullmatch(r"[0-9a-f]{12}", route_key(board_text(), PRO_2L, DRU_2L, PLAN).key)
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_route_plan.py tests/test_route_key.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.routing.plan'`

- [x] **Step 3: Write `plan.py` and `key.py`**

- Fanout: a footprint is fanned out when it has at least 16 SMD pads, at least 3 on each of the four sides of its pad bounding box, and a smallest neighbour pitch of 0.65 mm or less (QFN, DFN, QFP; modules and one-row connectors are not). Step width = `max(rules.min_track, min(rules.track_width, narrowest pad dimension))`; clearance = `rules.min_clearance`. `grid_step` is 0.05 when a fanout part has pitch 0.5 mm or less, else 0.1.
- Planes default to the nets of the board's fill zones (not rule areas), with their layers. Signals: nets with two or more pads, minus plane nets and pair nets, sorted. Power: nets whose class width is above `rules.track_width`. Pair width and gap: the positive net's class width and clearance unless the pair sets them.
- Hint rip patterns are expanded with `fnmatch` over signal and pair nets, minus nets with locked copper; a hint with an empty expansion keeps `rip=[]`.
- Region keep-outs: the board box grown by 1 mm, minus the region rectangle, as up to four rectangles named `pino-router:region:<n>`. Hole keep-outs: a 16-point circle of radius `drill / 2 + hole_clearance + track_width / 2` around each NPTH pad. Router rule areas forbid tracks and vias and allow pads, copper pour and footprints. The corridor is a `gr_line` chain on `User.1` with UUIDs `ids.uid("router", "corridor", str(k))`.
- Key parts are sha256 digests of canonical text: `nets` (sorted `ref.pad=net`), `placement` (sorted `ref at x y rot side`), `footprints` (per ref, pad geometry relative to the footprint), `outline` (Edge.Cuts items), `zones` (zone and rule-area outlines, layers, nets, no fills), `kept` (locked copper), `rules` (the pro's `board.design_settings` and `net_settings`, and the dru text), `plan` (`RoutePlan.to_json()` without `rules` and `warnings`), `router` (`router_id` and `kernel_version`). `key` = first 12 hex of sha256 over `"name=digest"` lines in `PARTS` order.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_route_plan.py tests/test_route_key.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/routing/plan.py kernel/src/pino_kernel/routing/key.py kernel/tests/test_route_plan.py kernel/tests/test_route_key.py kernel/tests/copper_boards.py
git commit -m "kernel: route plan from the board and its rules, hole-clearance fix, and the route key"
```

**Plan fixes (implementation):**
- Director's call over the plan's default: planes come from fill zones on boards of 4 or more layers only. On 2 layers the zone net is routed as tracks (`test_two_layer_ground_goes_as_tracks`); `planes=` asks for planes on any board. The plan's zone test runs on a 4-layer board (GND plane on In1.Cu), and so does the rip test.
- Nets whose pads are all joined by kept (locked) copper are not in `signals` (`test_a_net_joined_by_kept_copper_is_not_routed`), so a fully kept board has nothing to route. A hint never rips its own net.
- `RoutePlan.keepouts` holds the hole keep-outs; `RoutePlan.nothing_to_route`, `RoutePlan.to_dict()` and `plan.board_box(text)` are additive. Plan warnings: `via_grown` (info), `diff_pair_unknown`, `route_hint_unknown` (the hint is left out).
- Shared test cases live in `tests/route_cases.py` (`pro()`, `PRO_2L`, `DRU_2L` from the engine's `kicad_dru`, the boards).

---

### Task 6: The router chain

**Files:**
- Create: `kernel/src/pino_kernel/routing/chain.py`
- Modify: `kernel/tests/fake_krt/*` (as needed for the cases below)
- Test: `kernel/tests/test_route_chain.py`

**Interfaces:**
- Consumes: `Krt`, `run`, `KrtRun` (Task 1); `RoutePlan`, `fab_overrides_text`, `region_keepouts`, `hole_keepouts`, `add_router_items`, `strip_router_items` (Task 5); `read_copper` (Task 4).
- Produces:
  - `Events = Callable[[dict], None]`.
  - `ChainStep(name: str, script: str, args: list[str], keepouts: list[RouterKeepout], corridor: list[Point] | None)`; `args` hold the placeholders `{IN}`, `{OUT}`, `{FAB}`.
  - `chain_steps(plan: RoutePlan, krt: Krt) -> list[ChainStep]`; `hint_steps(plan: RoutePlan, krt: Krt, board_box) -> list[ChainStep]`.
  - `StepRun(step: str, script: str, seconds: float, returncode: int, routed: int, failed: list[str], note: str)` with `to_json()`.
  - `ChainResult(board_text: str, steps: list[StepRun], seconds: float, stopped: str | None)`; `stopped` in `None|cancelled|timed_out`; `board_text` has every `pino-router:` item stripped.
  - `run_steps(krt: Krt, steps: Sequence[ChainStep], board_text: str, pro_text: str, work: Path, *, plan: RoutePlan, env: Mapping[str, str], step_timeout: float, deadline: float, cancel: threading.Event, events: Events, index0: int = 0, total: int | None = None) -> ChainResult`.

- [x] **Step 1: Write the failing tests**

```python
def test_chain_order_and_arguments(fake_krt, tmp_path, argv_log):
    plan = plan_route(QFN_USB_GND_BOARD, PRO_2L, DRU_2L, pairs=[USB_PAIR])
    run_steps(locate(), chain_steps(plan, locate()), QFN_USB_GND_BOARD, PRO_2L, tmp_path, plan=plan, env=clean_env(),
              step_timeout=30, deadline=time.monotonic() + 60, cancel=threading.Event(), events=lambda e: None)
    calls = argv_log()
    assert [c["script"] for c in calls] == ["route_planes.py", "qfn_fanout.py", "route_diff.py", "route.py", "route_disconnected_planes.py"]
    sig = calls[3]["argv"]
    assert "--no-fix-drc-settings" in sig and sig[sig.index("--fab-overrides") + 1].endswith("fab-overrides.txt")
    assert sig[sig.index("--clearance") + 1] == "0.2" and sig[sig.index("--board-edge-clearance") + 1] == "0.3"
    assert sig[sig.index("--power-nets") + 1:sig.index("--power-nets") + 3] == ["+3V3", "VBUS"]
    pair = calls[2]["argv"]
    assert pair[pair.index("--nets") + 1:pair.index("--nets") + 3] == ["USB_D+", "USB_D-"] and "--no-gnd-vias" in pair
    assert not set(FORBIDDEN_FLAGS) & {a for c in calls for a in c["argv"]}

def test_each_step_feeds_the_next(fake_krt, tmp_path): ...          # step n's in.kicad_pcb bytes == step n-1's out.kicad_pcb
def test_pro_file_beside_every_input(fake_krt, tmp_path): ...       # in.kicad_pro next to each in.kicad_pcb, bytes == PRO_2L
def test_flags_the_script_lacks_are_left_out(fake_krt, tmp_path): ...  # krt.flags["qfn_fanout.py"] without --fab-overrides -> not passed

def test_failed_step_is_skipped_and_the_chain_goes_on(fake_krt, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_MODE", "crash"); monkeypatch.setenv("FAKE_KRT_CRASH", "route_diff.py")
    r = run_chain_for(QFN_USB_GND_BOARD, tmp_path)
    s = {x.step: x for x in r.steps}["pair USB_D"]
    assert s.returncode == 1 and "skipped" in s.note and r.stopped is None
    assert {t.net for t in read_copper(r.board_text).tracks} >= {"SDA"}

def test_step_timeout_stops_the_chain(fake_krt, tmp_path, monkeypatch):    # sleep mode, step_timeout=1
    r = run_chain_for(BOARD, tmp_path, step_timeout=1.0)
    assert r.stopped == "timed_out" and r.seconds < 10

def test_cancel_stops_the_chain(fake_krt, tmp_path, monkeypatch): ...       # cancel after 0.5 s -> stopped "cancelled"

def test_progress_events(fake_krt, tmp_path):
    events = []; run_chain_for(TWO_SIGNALS_BOARD, tmp_path, events=events.append)
    assert {"event": "step", "step": "signals", "index": 1, "of": 1} in events
    assert {"event": "net", "step": "signals", "index": 1, "of": 2, "net": "A"} in events
    assert events[-1]["event"] == "step_done" and events[-1]["routed"] == 2

def test_hint_keepouts_live_only_in_their_step(fake_krt, tmp_path):
    plan = plan_route(BOARD_WITH_HOLES, PRO_2L, DRU_2L, hints=[RouteHint("A", (-5, -5, 5, 5), None, None, [], 3)])
    r = run_steps(locate(), chain_steps(plan, locate()) + hint_steps(plan, locate(), BOX), BOARD_WITH_HOLES, PRO_2L, tmp_path, ...)
    hint_in = (tmp_path / step_dir(r, "hint A (board.py line 3)") / "in.kicad_pcb").read_text()
    assert "pino-router:region:" in hint_in and "pino-router:hole:H1" in hint_in
    assert "pino-router:" not in r.board_text

def test_corridor_hint(fake_krt, tmp_path): ...     # hint input has gr_line on "User.1"; argv has --guide-corridor
def test_rip_is_explicit(fake_krt, tmp_path): ...   # hint argv has --rip-existing-nets with names, never "*"
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_route_chain.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.routing.chain'`

- [x] **Step 3: Write `chain.py`**

Step names and arguments (rule flags `R` = `--via-size V --via-drill D --clearance C --board-edge-clearance E --grid-step G`, from `plan.rules` and `plan.grid_step`; `F` = `--fab-overrides {FAB}`; `N` = `--no-fix-drc-settings`; F and N only where `krt.flags` lists them):

```
planes <net>      route_planes.py {IN} {OUT} --nets <net> --plane-layers <layers> --track-width W --hole-to-hole-clearance H R F N
fanout <ref>      qfn_fanout.py {IN} -o {OUT} -c <ref> --width w --clearance c --via-size V --via-drill D
                  --board-edge-clearance E --grid-step G F
pair <name>       route_diff.py {IN} {OUT} --nets <P> <N> --track-width w --diff-pair-gap g --no-gnd-vias R F N
signals           route.py {IN} {OUT} --nets <signals> --track-width W --hole-to-hole-clearance H
                  [--power-nets <nets> --power-nets-widths <widths>] R F N            (left out when signals is empty)
planes repair     route_disconnected_planes.py {IN} {OUT} --nets <plane nets> --plane-layers <layers> R F N
hint <net> (board.py line <n>)
                  route.py {IN} {OUT} --nets <net> --track-width <net width> [--layers L…] [--rip-existing-nets <rip>]
                  [--guide-corridor] R F N           (no --keepout: the region travels as rule areas in {IN})
```

- Each step works in `work/<NN>-<slug>/` with `in.kicad_pcb` (the previous output, plus this step's router items; the hole keep-outs are added once before the first step), `in.kicad_pro` (pino's project file) and `out.kicad_pcb`. `work/fab-overrides.txt` holds `fab_overrides_text(plan.rules)`.
- After a step: the output loses that step's `pino-router:region:` items and its corridor; a missing output or a non-zero exit makes the step's input the next step's input (`note` "failed, skipped: <last log line>"). Timeout and cancel stop the chain.
- Step timeout = `min(step_timeout, deadline - now)`. Events: `step` at start (`index`, `of` over the whole job when `total` is given), `net` per `^\[(\d+)/(\d+)\] Routing (.+?)( \(id=\d+\))?$` line, `log` with the latest line at most every 0.5 s per step, `step_done` with `seconds`, `returncode`, `routed` (summary `successful`, else 0), `failed` (summary `failed_single`, else []).

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_route_chain.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/routing/chain.py kernel/tests/fake_krt kernel/tests/test_route_chain.py
git commit -m "kernel: router chain of planes, fanout, pairs, signals, plane repair and route hints"
```

**Plan fixes (implementation):**
- The chain tests run on the 4-layer case board (GND plane on In1.Cu), since a 2-layer board has no plane steps under the director's call.
- `StepRun.folder` (the step's folder under `work/`) is additive; the tests find a step's input by it. Each step folder also keeps `log.txt`.
- Only `--fab-overrides` and `--no-fix-drc-settings` are dropped when a script's `--help` lacks them; the rule flags always go.
- A step whose exit is 0 but writes no output is skipped with the note "no output, skipped".
- The director's "both orders' router share on the 2-layer reference board" needs the real router: it is measured in Task 12.

---

### Task 7: Route checks: DRC by the router, unrouted nets, router share, copper checks

**Files:**
- Create: `kernel/src/pino_kernel/routing/checks.py` (ports `UF` and `groups` from pcb-kit `pcbkit/checks/route_check.py` with the MIT header; the shape contacts are rebuilt on Task 4's geometry), `kernel/tests/fixtures/route_reports/{baseline.json,routed.json}`
- Modify: `NOTICE` (ported files list)
- Test: `kernel/tests/test_route_checks.py`

**Interfaces:**
- Consumes: `drc_findings` (engine Task 14), `Copper`, `PadShape`, `Fill` (Task 4), `RoutePlan`, `net_class_widths` (Task 5), `Finding`, `At`.
- Produces:
  - `unrouted_nets(report: dict) -> dict[str, int]` (net to unconnected item count; the net is the first `[...]` in each item's `description`).
  - `router_drc(report: dict, baseline: dict, footprint_refs: Mapping[str, str]) -> list[Finding]`: violations of `report` whose `(type, sorted item uuids)` is not in `baseline`, through `drc_findings`, without `schematic_parity` (the fast build owns parity) and without `unconnected_items` (counted apart).
  - `Share(nets: int, before: int, after_router: int, after_finish: int, router_seconds: float, finish_seconds: float)` with `router_share() -> float | None` (`(after_router - before) / (nets - before)`, `None` when `nets == before`) and `to_json() -> dict` = `{"nets", "done_before", "router": {"routed", "of", "share", "seconds"}, "finish": {"routed", "seconds"}}` (`share` rounded to 3 places or null). The counts are complete nets: nets with two or more pads and no unconnected item.
  - `NECK_LENGTH = 2.5` (mm, KRT's neck-down length), `PAIR_TOLERANCE = 0.02`, `PAIR_MIN_COUPLED = 0.5`, `TOUCH = 0.02`.
  - `copper_findings(copper: Copper, plan: RoutePlan, widths: Mapping[str, float]) -> list[Finding]`; source `copper`; codes: `copper_floating` (warning: a connected group of a net with no pad; counts, mm of track, area of fill), `copper_stub` (warning: a free track end walked back to what it hangs off; length in mm), `copper_loop` (info: one-layer loops on a net without fills), `pour_one_pad` (warning: fill islands of a net reach only one of its pads), `track_too_thin` (error: a segment narrower than its net's class width by more than 0.001 mm, unless it lies wholly within `NECK_LENGTH` of a pad of that net whose smaller side is narrower than the class width), `pair_gap` (error: parallel runs of a pair on one layer whose edge gap differs from the plan's gap by more than `PAIR_TOLERANCE`, outside the neck zone), `pair_uncoupled` (warning: coupled length below `PAIR_MIN_COUPLED` of the positive net's length). Every finding has `at` in board space and `nets`.
  - `unrouted_findings(report: dict, copper: Copper) -> list[Finding]`: one error `net_unrouted` (source `route`) per net: "net SDA: 2 connections left (U4.10 to U6.3, …)", `at` the first item's position.

- [x] **Step 1: Write the failing tests**

```python
def test_unrouted_nets_by_the_name_in_brackets():
    assert unrouted_nets(load("routed.json")) == {"SDA": 1, "GPIO4": 2}

def test_router_drc_drops_baseline_and_parity():
    found = router_drc(load("routed.json"), load("baseline.json"), REFS)
    assert {f.code for f in found} == {"clearance", "track_dangling"} and all(f.source == "drc" for f in found)

def test_share_counts_router_work_only():
    s = Share(nets=31, before=2, after_router=25, after_finish=31, router_seconds=4.0, finish_seconds=2.7)
    assert s.router_share() == pytest.approx(23 / 29)
    assert s.to_json()["router"] == {"routed": 23, "of": 29, "share": 0.793, "seconds": 4.0}

def test_nothing_to_route_has_no_share():
    s = Share(nets=3, before=3, after_router=3, after_finish=3, router_seconds=0.0, finish_seconds=0.0)
    assert s.router_share() is None and s.to_json()["router"]["share"] is None

def test_floating_via_and_stub():
    found = copper_findings(read_copper(ORPHAN_VIA_AND_STUB), PLAN, WIDTHS)
    assert {f.code for f in found} == {"copper_floating", "copper_stub"}
    assert "1.2 mm" in next(f for f in found if f.code == "copper_stub").message

def test_pour_reaching_one_pad(): ...
def test_loop_on_one_layer(): ...

def test_thin_power_track_but_a_neck_at_a_small_pad_is_fine():
    found = copper_findings(read_copper(VBUS_THIN_MIDDLE_AND_NECK_AT_QFN), PLAN, {"VBUS": 0.5})
    thin = [f for f in found if f.code == "track_too_thin"]
    assert len(thin) == 1 and "0.25 mm" in thin[0].message and "0.5 mm" in thin[0].message

def test_pair_gap_and_uncoupled():
    found = copper_findings(read_copper(PAIR_AT_031), plan_with_pair(gap=0.2), WIDTHS)
    assert [f.code for f in found if f.code.startswith("pair_")] == ["pair_gap"] and "0.31" in found[0].message
    assert [f.code for f in copper_findings(read_copper(PAIR_APART), plan_with_pair(gap=0.2), WIDTHS)] == ["pair_uncoupled"]

def test_unrouted_findings_name_the_pins():
    f = unrouted_findings(load("routed.json"), read_copper(ROUTED_BOARD))
    assert [x.nets for x in f] == [("GPIO4",), ("SDA",)] and "U4.10" in f[1].message and f[1].at.space == "board"
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_route_checks.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.routing.checks'`

- [x] **Step 3: Write `checks.py`**

Groups per net come from the ported union-find over tracks, arcs, vias, pads and fill islands with Task 4's contact rule. Stubs walk as pcb-kit's do: from each free end, back while the run has exactly one way on. Two segments of a pair are parallel within 1 degree with overlapping projections and a centre distance below `width + gap + 0.5`; their edge gap is the centre distance minus the width.

- [x] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_route_checks.py -v`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add NOTICE kernel/src/pino_kernel/routing/checks.py kernel/tests/fixtures/route_reports kernel/tests/test_route_checks.py kernel/tests/copper_boards.py
git commit -m "kernel: router DRC against the unrouted board, router share and copper checks (groups ported from pcb-kit, MIT)"
```

**Plan fixes (implementation):**
- The build's `drc.json` holds unconnected items as positions only (the engine's `normalize`), so `unrouted_nets(report, copper=None)` and `unrouted_findings` name a net and its pins from the pad (or track or via) under each position when the report has no description. `complete_nets(report, copper)` gives (nets with two or more pads, complete ones) for `Share`.
- `TOUCH` is `pcb.copper.TOUCH` (one contact rule for cleanup and these checks). Locked tracks are never `track_too_thin` (a kept route's width is board.py's call).
- `pair_gap` is one finding per pair, naming how many coupled runs are off and their gap range. Test boards build their own pads; the pair tests filter the `pair_` codes.

---

### Task 8: The route job and `pino-kernel route`

**Files:**
- Create: `kernel/src/pino_kernel/routing/job.py`, `kernel/src/pino_kernel/routing/result.py`, `kernel/src/pino_kernel/routing/history.py`, `kernel/schema/route-result-1.schema.json`
- Modify: `kernel/src/pino_kernel/cli.py` (`route`), `kernel/tests/fake_kicad_cli.py` (when `FAKE_KICAD_DRC` names a JSON file, `pcb drc` copies it to its `-o` path; with `--save-board` the board is left as it is)
- Test: `kernel/tests/test_route_job.py`

**Interfaces:**
- Consumes: Tasks 1 and 4 to 7; `KicadCli`, `discover`, `Timing`, `MAX_FINDINGS`, `MAX_MESSAGE`, `MAX_HEADLINE` (engine).
- Produces:
  - `result.SCHEMA = "pino.route/1"`; `RouteResult(schema, kernel_version, router: dict, key: str | None, build: str | None, number: int, state: str, verdict: str, headline: str, complete: bool, counts: dict[str, int], share: dict | None, findings: list[Finding], truncated: int, steps: list[StepRun], timings: list[Timing], artifacts: dict, cached: bool)` with `to_json()` and `from_json()`. `state` in `done|failed|cancelled|timed_out|busy`; `verdict` in `ok|errors|failed`; `counts` keys `nets, unrouted, tracks, vias, track_mm, drc_errors, drc_warnings, copper_errors, copper_warnings`; `router` = `{"name": "KiCadRoutingTools", "version", "commit"}`.
  - `result.route_headline(number: int, build_number: int | None, state: str, counts: dict, share: dict | None, problem: str | None) -> str`: `"Route r3 (h7): router 23/29 nets in 36 s, finish 6, 0 left, DRC clean"`, `"Route r3 (h7): router 23/29 nets in 36 s, 2 left, 3 DRC errors"`, `"Route r3 (h7): nothing to route"`, `"Route r3 (h7): cancelled after 12 s"`, `"Route r3: KiCadRoutingTools missing: run pino-kernel router install"`.
  - `history.RouteHistory(project: Path)` with `next_number() -> int`, `record(number, key, build, state, complete) -> None`, `latest_done() -> dict | None`; file `.pino/routes.json` = `{"schema": "pino.routes/1", "routes": [{"number", "key", "build", "state", "complete", "at"}]}`, newest 100, atomic writes under `fcntl.flock` on `.pino/routes.lock`.
  - `RouteOptions(timeout: float = 900.0, step_timeout: float = 300.0, install: bool = True, cache: bool = True, keep_steps: bool = False)`; `KEEP_ROUTES = 10`.
  - `RouteOutcome(board_text: str, copper: Copper, drc: dict, share: Share, steps: list[StepRun], findings: list[Finding], timings: list[Timing], stopped: str | None)`.
  - `route_board(work: Path, board_text: str, pro_text: str, dru_text: str | None, plan: RoutePlan, *, kicad: KicadCli, krt: Krt, project_files: Mapping[str, Path], baseline: dict | None, options: RouteOptions, events: Events, cancel: threading.Event) -> RouteOutcome`.
  - `route_project(project: Path, *, build: str | None = None, options: RouteOptions = RouteOptions(), events: Events = lambda e: None, cancel: threading.Event | None = None) -> RouteResult`.
  - `latest_build(project: Path) -> str | None` (newest `builds.json` entry whose verdict is not `failed` and whose folder holds `board.kicad_pcb`).
  - `pino-kernel route <project> [--build HASH] [--timeout S] [--step-timeout S] [--no-install] [--no-cache] [--keep-steps] [--events]`: without `--events`, stdout is the `RouteResult` JSON only; with it, one event per line and last `{"event": "done", "result": {…}}`. Exit 0 `ok`, 1 `errors`, 2 `failed`, `timed_out` or `busy`, 130 `cancelled`. SIGTERM and SIGINT cancel.

- [ ] **Step 1: Write the failing tests**

`routed_project` (fixture): a `make_project(SMALL_BOARD_PY)` built with the fake kicad-cli and `FAKE_KICAD_DRC` pointing at a canned report, with `fake_krt` active.

```python
def test_route_folder_layout_and_result(routed_project):
    r = route_project(routed_project)
    d = routed_project / ".pino/routes" / r.key
    assert r.state == "done" and r.number == 1 and r.build == latest_build(routed_project)
    assert {x.name for x in d.iterdir()} == {"key.json", "plan.json", "route.json", "board.kicad_pcb", "copper.json", "filled", "drc.json", "log.txt"}
    assert {x.name for x in (d / "filled").iterdir()} >= {"board.kicad_pcb", "board.kicad_pro", "board.kicad_dru", "board.kicad_sch", "sym-lib-table", "fp-lib-table"}
    assert not list((routed_project / ".pino/routes").glob("*.tmp-*"))
    jsonschema.validate(json.loads(r.to_json()), ROUTE_SCHEMA)
    assert [t.step for t in r.timings] == ["router", "plan", "chain", "refill", "cleanup", "drc", "checks"]

def test_writes_only_under_dot_pino(routed_project): ...
def test_kept_copper_survives_routing(routed_project_with_kept): ...   # locked segments in the route's board keep their build UUIDs

def test_same_bytes_twice(routed_project, tmp_path):
    other = shutil.copytree(routed_project, tmp_path / "again"); a, b = route_project(routed_project), route_project(other)
    for name in ("board.kicad_pcb", "copper.json", "plan.json", "key.json", "filled/board.kicad_pcb"):
        assert digest(routed_project / ".pino/routes" / a.key / name) == digest(other / ".pino/routes" / b.key / name)

def test_cached_second_route(routed_project, argv_log):
    route_project(routed_project); n = len(argv_log()); r = route_project(routed_project)
    assert r.cached and r.number == 2 and len(argv_log()) == n

def test_busy_when_a_route_runs(routed_project): ...      # hold .pino/routes/job.lock -> state "busy", headline "a route is already running for this project"

def test_cancel_kills_the_router_and_cleans_up(routed_project, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep"); monkeypatch.setenv("FAKE_KRT_PIDFILE", str(tmp_path / "pid"))
    cancel = threading.Event(); threading.Timer(1.0, cancel.set).start()
    r = route_project(routed_project, cancel=cancel)
    assert r.state == "cancelled" and not list((routed_project / ".pino/routes").glob("*.tmp-*"))
    with pytest.raises(ProcessLookupError): os.kill(int((tmp_path / "pid").read_text()), 0)
    assert RouteHistory(routed_project).latest_done() is None

def test_timeout(routed_project, monkeypatch): ...         # sleep mode, timeout=2 -> state "timed_out", verdict "failed"

def test_router_missing_is_a_failed_route(routed_project, monkeypatch, tmp_path):
    monkeypatch.delenv("PINO_KRT_DIR"); monkeypatch.setenv("PINO_CACHE_DIR", str(tmp_path / "empty"))
    r = route_project(routed_project, options=RouteOptions(install=False))
    assert r.state == "failed" and r.findings[0].code == "router_missing" and "router install" in r.headline

def test_no_build_yet(make_project, fake_krt):
    r = route_project(make_project(SMALL_BOARD_PY)); assert r.state == "failed" and "save board.py first" in r.headline

def test_route_with_nothing_to_route(fake_krt, nothing_to_route_project):   # every net kept by keep_route
    r = route_project(nothing_to_route_project)
    assert r.state == "done" and r.share["router"]["share"] is None and "nothing to route" in r.headline

def test_route_in_a_path_with_spaces(tmp_path, fixture_libs, fake_krt, argv_log):
    p = built_project(tmp_path / "my board ação")
    assert route_project(p).state == "done"
    assert all(any("my board ação" in a for a in c["argv"]) for c in argv_log() if c["script"] == "route.py")

def test_cli_events_then_result(routed_project):
    p = run_cli("route", str(routed_project), "--events")
    lines = [json.loads(l) for l in p.stdout.splitlines()]
    assert lines[0]["event"] == "step" and lines[-1]["event"] == "done" and p.returncode in (0, 1)

def test_cli_sigterm_cancels(routed_project, monkeypatch): ...   # Popen, wait for the first "step" event of route.py, SIGTERM -> exit 130, last line state "cancelled", pid gone
def test_old_routes_are_pruned(routed_project, monkeypatch): ... # KEEP_ROUTES=2, four placements routed -> 2 folders plus the latest done
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_route_job.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.routing.job'`

- [ ] **Step 3: Write the job, the result, the history, the schema and the CLI**

`route_board`, with its timing names in this order:

```
"router"   ensure() the router (allow_install = options.install); RouterMissing -> stopped "failed", its finding
"plan"     the plan given; plan warnings become findings
"chain"    hole keep-outs, chain_steps(), run_steps()
"refill"   merge_copper(board_text, rewrite_uuids(copper_nodes(chain))) into work/refill/ with project_files;
           kicad.drc(refill=True, save=True); unrouted_nets() -> Share.after_router; Share.before from baseline
"hints"    only when plan.hints: hint_steps() on the chain output, merge, "refill after hints" as above
"cleanup"  cleanup() on the latest refilled board's copper (it has the fills), then rewrite_uuids()
"drc"      the cleaned board into filled/ with project_files; kicad.drc(refill=True, save=True, parity=True)
"checks"   router_drc(drc, baseline), unrouted_findings, copper_findings, step failures as findings
           (source "router", code "router_step_failed", warning, with the step's last log line)
```

`route_project`: take the job lock (`.pino/routes/job.lock`, `LOCK_EX | LOCK_NB`; it holds `{"key", "pid", "started"}`), pick the build (`build` or `latest_build`), compute `plan_for_build` and `route_key`, return the cached result when `.pino/routes/<key>/route.json` is complete and `options.cache`, else run `route_board` in `.pino/routes/<key>.tmp-<pid>-<thread id>/` with the baseline from the build's `drc.json` (or a DRC of the build's `filled/` copy when missing), write the folder, rename it onto `.pino/routes/<key>/`, record history, prune. Failed, cancelled and timed-out runs remove the temp folder and are recorded with their state. `complete` is `counts["unrouted"] == 0`; `verdict` is `failed` for those three states, `errors` when unrouted nets or error findings remain, else `ok`. Findings are sorted and capped as the build's are. `log.txt` keeps the last 200 KB of every step's output with step headers. `artifacts` are paths relative to the project.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_route_job.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/routing kernel/src/pino_kernel/cli.py kernel/schema/route-result-1.schema.json kernel/tests/fake_kicad_cli.py kernel/tests/test_route_job.py kernel/tests/conftest.py
git commit -m "kernel: route job keyed by its inputs, cached, cancellable, with pino-kernel route"
```

---

### Task 9: Routing in the build result, and stale copper (interface change: BuildResult)

**Files:**
- Create: `kernel/src/pino_kernel/routing/state.py`
- Modify: `kernel/src/pino_kernel/result.py`, `kernel/src/pino_kernel/build.py`, `kernel/schema/build-result-1.schema.json`
- Test: `kernel/tests/test_routing_state.py`, `kernel/tests/test_result.py` (schema case)

**Interfaces:**
- Consumes: `plan_for_build`, `route_key`, `RouteKey`, `stale_reasons` (Task 5); `RouteHistory`, `RouteResult` (Task 8); `BuildResult`, `headline`, `build` (engine Task 16).
- Produces:
  - `routing_state(project: Path, key: RouteKey) -> dict`: `{"state": "none"|"running"|"current"|"stale", "key": str, "route": str | None, "route_key": str | None, "number": int | None, "stale_because": list[str], "complete": bool | None, "unrouted": int | None, "router_share": float | None, "router_seconds": float | None, "drc_errors": int | None, "copper_errors": int | None, "verdict": str | None}`. Precedence: `current` (a done route for this key) over `running` (the job lock is held) over `stale` (another key's latest done route) over `none`. `running` and `stale` point `route` at the latest done route, for faded copper; `stale_because` from `stale_reasons` of the two `key.json`s.
  - `BuildResult` gains `routing: dict | None` (last field). The build's last timing step is `"routing"` (after `"diff"`); it is left out, with `routing` null, when the build failed or wrote no board. Cached results get `routing` computed again on every call.
  - When `routing.state` is `current`, `counts["unrouted"]` is the route's; otherwise the fast build's.
  - `headline` gains a clause, cut to 160 characters: `"; routed r3, 0 left, DRC clean"`, `"; routed r3, 2 left, 3 DRC errors"`, `"; routing"`, `"; copper stale (parts moved)"`.
  - `waiting`: none `["routing: not started"]`; running `["routing: running"]`; stale `["routing: stale (parts moved)"]`; current with nets left `["routing: 2 nets left"]`; current and complete `[]`.
  - The engine constraint becomes: two builds of the same input differ only in `number`, `timings`, `changes`, `cached`, `routing`, and the `counts["unrouted"]`, `headline` and `waiting` values routing drives.

- [ ] **Step 1: Write the failing tests**

```python
def test_no_route_yet(routed_project):
    r = build(routed_project, KICAD_FAKE)
    assert r.routing["state"] == "none" and r.waiting == ["routing: not started"] and r.timings[-1].step == "routing"

def test_current_route_sets_unrouted_and_headline(routed_project):
    route = route_project(routed_project); r = build(routed_project, KICAD_FAKE)
    assert r.routing["state"] == "current" and r.routing["key"] == route.key
    assert r.counts["unrouted"] == route.counts["unrouted"] and "routed r1" in r.headline

def test_value_change_keeps_copper_current(routed_project):
    route_project(routed_project); edit(routed_project, '"10k"', '"4.7k"')
    assert build(routed_project, KICAD_FAKE).routing["state"] == "current"

def test_move_marks_copper_stale_and_never_reuses_it(routed_project):
    first = build(routed_project, KICAD_FAKE); route_project(routed_project); move_a_part(routed_project)
    r = build(routed_project, KICAD_FAKE)
    assert r.routing["state"] == "stale" and r.routing["stale_because"] == ["parts moved"]
    assert r.counts["unrouted"] == first.counts["unrouted"] and "copper stale (parts moved)" in r.headline
    assert r.routing["route"].startswith(".pino/routes/") and r.waiting == ["routing: stale (parts moved)"]

def test_save_during_route_marks_it_stale(routed_project, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_SLOW", "2")                   # fake route.py sleeps 2 s before writing
    t = threading.Thread(target=route_project, args=(routed_project,)); t.start(); wait_for_lock(routed_project)
    move_a_part(routed_project); during = build(routed_project, KICAD_FAKE); t.join()
    after = build(routed_project, KICAD_FAKE)
    assert during.routing["state"] == "running"
    assert after.routing["state"] == "stale" and after.routing["stale_because"] == ["parts moved"]
    assert not list((routed_project / ".pino/routes").glob("*.tmp-*"))

def test_cached_build_recomputes_routing(routed_project): ...   # build (none), route, build again (cached True) -> current
def test_headline_stays_within_160(routed_project): ...          # long stale reasons -> len(headline) <= 160

# test_result.py
def test_result_with_routing_matches_schema(routed_project): ...   # jsonschema.validate for none, current and stale
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_routing_state.py tests/test_result.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.routing.state'`

- [ ] **Step 3: Write `state.py` and wire it into the build**

`result.json` in the build folder keeps `routing` as it was at build time; the returned result always has it fresh. The fast build never merges route findings: they stay in `route.json`, and the `check` tool (stage 6) reads both.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_routing_state.py tests/test_result.py tests/test_build.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/routing/state.py kernel/src/pino_kernel/result.py kernel/src/pino_kernel/build.py kernel/schema/build-result-1.schema.json kernel/tests/test_routing_state.py kernel/tests/test_result.py
git commit -m "kernel: routing state in the build result, stale copper named and never reused"
```

---

### Task 10: Serve mode runs route jobs (interface change: serve protocol)

**Files:**
- Create: `kernel/src/pino_kernel/serve.py`
- Modify: `kernel/src/pino_kernel/cli.py` (`serve` calls `serve.main`), `kernel/README.md` (protocol)
- Test: `kernel/tests/test_serve_jobs.py` (the engine's `test_cli.py` stays as it is and must pass)

**Interfaces:**
- Consumes: `pino-kernel route` (Task 8), `routing_state` (Task 9), engine serve ops.
- Produces:
  - `serve.main(stdin=sys.stdin, stdout=sys.stdout) -> int`.
  - `serve.JobRunner` with `start(id, argv: list[str]) -> None` (spawns `[sys.executable, "-m", "pino_kernel.cli", *argv, "--events"]`, `start_new_session=True`; relays each event line as `{"id": id, "event": {…}}` and the `done` line as `{"id": id, "ok": true, "result": {…}}`; a child that dies without `done` gives `{"id": id, "ok": false, "error": "route job stopped: <last stderr line>"}`), `cancel(id) -> bool` (SIGTERM to the child's group, SIGKILL after 5 s), `wait_all(timeout: float) -> None`.
  - Ordered ops (one FIFO worker, answered in request order among themselves): `ping` (pong adds `"serve": 2, "route_schema": "pino.route/1"`), `build`, `route_status` (`{"id", "op": "route_status", "project"}` -> `{"id", "ok": true, "status": routing_state(...)}`, computed from the latest build), unknown ops, bad lines, `shutdown`.
  - Job ops (started from the FIFO worker, then streamed): `{"id", "op": "route", "project", "options": {"build": null, "timeout": 900, "step_timeout": 300, "install": true, "cache": true}}`. Task 11 adds `route_net` and `nudge` with `route: true`.
  - Out of order: `{"id", "op": "route_cancel", "job": <id>}` -> `{"id", "ok": true, "cancelled": true | false}` at once, from the reader thread.
  - `shutdown` and end of input cancel running jobs, wait up to 10 s, then answer (shutdown) and exit 0. Every output line is written whole under one lock and flushed.

- [ ] **Step 1: Write the failing tests**

```python
def serve(lines, **kw): ...    # Popen of "serve", writes lines (dicts as JSON), returns parsed output lines in order

def test_route_streams_events_then_one_result(routed_project):
    out = serve([{"id": 7, "op": "route", "project": str(routed_project)}, {"id": 8, "op": "shutdown"}], wait_for=7)
    mine = [o for o in out if o.get("id") == 7]
    assert all("event" in o for o in mine[:-1]) and mine[-1]["ok"] and mine[-1]["result"]["state"] == "done"
    assert sum("result" in o for o in mine) == 1

def test_build_answers_while_a_route_runs(routed_project, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_SLOW", "3")
    out = serve([{"id": 1, "op": "route", "project": str(routed_project)},
                 {"id": 2, "op": "build", "project": str(routed_project), "options": {"kicad": False}}, {"id": 3, "op": "shutdown"}])
    order = [o["id"] for o in out if "result" in o]
    assert order.index(2) < order.index(1)

def test_route_cancel(routed_project, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep"); monkeypatch.setenv("FAKE_KRT_PIDFILE", str(tmp_path / "pid"))
    out = serve([{"id": 1, "op": "route", "project": str(routed_project)}, ("after_first_event", {"id": 2, "op": "route_cancel", "job": 1}),
                 {"id": 3, "op": "shutdown"}])
    assert {"id": 2, "ok": True, "cancelled": True} in out
    assert next(o for o in out if o.get("id") == 1 and "result" in o)["result"]["state"] == "cancelled"
    with pytest.raises(ProcessLookupError): os.kill(int((tmp_path / "pid").read_text()), 0)

def test_cancel_unknown_job(): ...        # {"cancelled": false}
def test_shutdown_cancels_running_jobs(routed_project, monkeypatch, tmp_path): ...   # sleep mode; shutdown -> exit 0 within 15 s, route result "cancelled", pid gone
def test_end_of_input_also_cancels(routed_project, monkeypatch, tmp_path): ...
def test_route_status(routed_project): ... # status["state"] == "none", then "current" after a route
def test_ping_says_serve_2(): ...
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_serve_jobs.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.serve'`

- [ ] **Step 3: Write `serve.py` and move the loop out of `cli.py`**

- [ ] **Step 4: Run the tests to verify they pass, the engine's serve test included**

Run: `uv run --directory kernel pytest tests/test_serve_jobs.py tests/test_cli.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/serve.py kernel/src/pino_kernel/cli.py kernel/README.md kernel/tests/test_serve_jobs.py
git commit -m "kernel: serve mode runs route jobs with streamed progress and cancel"
```

---

### Task 11: Claude's finishing tools: route one net, nudge a part, keep a route

**Files:**
- Create: `kernel/src/pino_kernel/routing/trials.py`, `kernel/src/pino_kernel/routing/snippets.py`, `kernel/schema/trial-result-1.schema.json`
- Modify: `kernel/src/pino_kernel/routing/result.py` (`TrialResult`), `kernel/src/pino_kernel/cli.py`, `kernel/src/pino_kernel/serve.py`
- Test: `kernel/tests/test_trials.py`

**Interfaces:**
- Consumes: `route_board`, `RouteOptions`, `latest_build` (Task 8); `run_steps`, `hint_steps` (Task 6); `routing_state` (Task 9); `read_copper`, `merge_copper` (Task 4); `courtyard_overlaps`, `fit_findings`, `score`, `write_board`, `FootprintLibrary`, `Placed`, `placement_from_json` (engine).
- Produces:
  - `result.TrialResult(schema="pino.trial/1", kind: str, base: dict, number: int, ok: bool, headline: str, before: dict, after: dict, findings: list[Finding], truncated: int, snippet: str, replaces_line: int | None, artifacts: dict, seconds: float)`; `kind` in `route_net|nudge|keep`; `base` = `{"build": h, "route": key | None}`. Trials live in `.pino/trials/<n>/` (`n` from `.pino/trials/next` under a flock), newest 20 kept.
  - `snippets.board_var(board_py: str) -> str` (the name assigned from `Board(` or `pino.Board(`, else `b`), `hint_snippet(var, net, region, layers, corridor, rip) -> str`, `place_snippet(var, ref, pose: PartPose) -> str`, `keep_snippets(var, copper: Copper, net: str) -> list[str]`. Numbers through `num()`. Pins as `b.part("U4")[10]` (or `["A6"]` for a non-numeric pad).
  - `trials.route_net(project: Path, net: str, *, region=None, layers=None, corridor=None, rip: Sequence[str] = (), options=RouteOptions(), events=..., cancel=None) -> TrialResult`: base board = the current route's `board.kicad_pcb` when routing is current, else the latest build's board (headline then says "no current route: tried on the unrouted board"); runs the one hint step, merges, refills and runs DRC. `before`/`after` = `{"net_complete": bool, "unrouted_nets": int, "drc_errors": int}`; `ok` when the net is complete and no new DRC errors; `snippet` = `hint_snippet(...)` (only the arguments given).
  - `trials.nudge(project: Path, ref: str, *, by: tuple[float, float] = (0.0, 0.0), rot: float | None = None, back: bool | None = None, route: bool = False, options=..., events=..., cancel=None) -> TrialResult`: new pose = the build's pose plus `by`; findings = `courtyard_overlaps` and `fit_findings` that name `ref`; `before`/`after` = `{"crossings", "length_mm", "score"}` from `score`, plus `{"unrouted", "router_share"}` when `route` (the whole chain on `write_board` of the new placement, in the trial folder); `snippet` = `place_snippet(...)`; `replaces_line` = the line of `ref`'s current `Intent`, or `None`; `ok` when no error finding names `ref` (and, with `route`, unrouted did not grow).
  - `trials.keep(project: Path, net: str) -> TrialResult`: needs routing `current` (else `ok` false, headline "route first: the copper of SDA is stale"); turns the net's unlocked copper into `keep_route` lines: paths between pads and branch points, split where the width changes, `via(x, y, to=…)` at layer changes; a net with arcs is refused in plain words. `snippet` ends with the note line `# needs: from pino import via` when a via is used.
  - CLI: `pino-kernel route-net <project> --net N [--region x0,y0,x1,y1] [--layers L …] [--corridor x,y …] [--rip P …] [--events]`; `pino-kernel nudge <project> --part REF [--by dx,dy] [--rot DEG] [--back | --front] [--route] [--events]`; `pino-kernel keep <project> --net N`. Exit 0 `ok`, 1 not ok, 2 failed.
  - Serve: `{"op": "route_net", "project", "net", "region", "layers", "corridor", "rip"}` (job op); `{"op": "nudge", "project", "part", "by", "rot", "back", "route"}` (job op when `route`, else ordered); `{"op": "keep", "project", "net"}` (ordered).

- [ ] **Step 1: Write the failing tests**

```python
def test_route_net_trial_reports_and_snippet(routed_project, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_FAIL", "SDA"); route_project(routed_project); monkeypatch.delenv("FAKE_KRT_FAIL")
    t = route_net(routed_project, "SDA", region=(-5, -5, 5, 5), rip=["*"])
    assert (t.before["net_complete"], t.after["net_complete"], t.ok) == (False, True, True)
    assert t.snippet == 'b.route_hint("SDA", region=(-5, -5, 5, 5), rip=["*"])'
    assert {x.name for x in (routed_project / t.artifacts["folder"]).iterdir()} >= {"board.kicad_pcb", "copper.json", "trial.json"}

def test_the_hint_replays_what_the_trial_found(routed_project, monkeypatch):
    t = route_net_after_failed_sda(routed_project, monkeypatch)
    append(routed_project / "board.py", t.snippet); build(routed_project, KICAD_FAKE); r = route_project(routed_project)
    assert tracks_of(routed_project / r.artifacts["board"], "SDA") == tracks_of(routed_project / t.artifacts["board"], "SDA")

def test_nudge_checks_and_snippet(routed_project):
    t = nudge(routed_project, "R1", by=(1.0, 0.0))
    x, y = pose_of(routed_project, "R1")
    assert t.snippet == f'b.place(b.part("R1"), at=({num(x + 1)}, {num(y)}), rot=0)' and t.kind == "nudge"
    assert {"crossings", "length_mm", "score"} <= set(t.after)

def test_nudge_onto_another_part_is_not_ok(routed_project): ...     # by puts R1 on U1 -> courtyard_overlap names R1, ok False
def test_nudge_replaces_the_intent_line(routed_project): ...        # R1 has b.place(..., at=...) on line 30 -> replaces_line == 30
def test_nudge_with_route_compares_router_share(routed_project): ...  # before and after hold "router_share" and "unrouted"

def test_keep_snippets_by_pins_and_vias(routed_project_with_vbus_via):
    t = keep(routed_project_with_vbus_via, "VBUS")
    assert t.ok and t.snippet.splitlines() == [
        'b.keep_route("VBUS", frm=b.part("J1")[1], to=b.part("U1")[1], layer="F.Cu", width=0.5, points=[(1, 2), via(3, 2, to="B.Cu"), (5, 2)])',
        "# needs: from pino import via"]

def test_keep_round_trip(routed_project_with_vbus_via):
    t = keep(routed_project_with_vbus_via, "VBUS"); append_with_import(routed_project_with_vbus_via / "board.py", t.snippet)
    r = build(routed_project_with_vbus_via, KICAD_FAKE)
    assert locked_tracks(r, "VBUS") == pytest.approx(routed_tracks_before(routed_project_with_vbus_via, "VBUS"), abs=1e-6)

def test_keep_refuses_stale_copper(routed_project): ...   # after a move -> ok False, headline starts "route first"
def test_board_var_detection():
    assert [board_var(t) for t in ("board = Board(\n", "import pino\npcb = pino.Board(\n", "x = 1\n")] == ["board", "pcb", "b"]
def test_trial_result_schema(routed_project): ...
def test_serve_route_net_and_keep(routed_project): ...    # route_net streams events and one result; keep answers in order
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run --directory kernel pytest tests/test_trials.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'pino_kernel.routing.trials'`

- [ ] **Step 3: Write `trials.py`, `snippets.py`, the CLI subcommands and the serve ops**

The trials never write `board.py`; they read it only for `board_var` and use `Intent.line` from `circuit.json`. A hint appended last replays after every earlier hint, so a trial on the current route's board is what the next route gives.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run --directory kernel pytest tests/test_trials.py tests/test_serve_jobs.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add kernel/src/pino_kernel/routing kernel/src/pino_kernel/cli.py kernel/src/pino_kernel/serve.py kernel/schema/trial-result-1.schema.json kernel/tests/test_trials.py
git commit -m "kernel: finishing tools: route one net, nudge a part, keep a route, as board.py lines"
```

---

### Task 12: The pass mark: two boards fully routed and DRC clean

**Files:**
- Modify: `kernel/tests/fixtures/reference/board.py` (a `b.diff_pair` for the USB data nets, named `USB_D+` and `USB_D-` if they are not yet), `kernel/README.md`, `.github/workflows/kernel.yml`
- Create: `kernel/tests/fixtures/reference/finish.py`, `kernel/tests/fixtures/four_layer/source.json`, `kernel/tests/fixtures/four_layer/finish.json`, `kernel/tests/test_pass_mark.py`
- Test: `kernel/tests/test_pass_mark.py`

**Interfaces:**
- Consumes: everything above; `KicadCli.run` for `pcb upgrade`.
- Produces:
  - `finish.py`: `board.py` lines (route hints, placement changes, kept routes) that finish the reference route; the test appends them to a copy of the fixture's `board.py`.
  - `four_layer/source.json`: `{"repo": "https://github.com/sqfmi/watchy-hardware", "commit": "5f147972aa2148d4971f3c41fc3ce39ff8c48131", "files": ["Watchy.kicad_pcb", "Watchy.kicad_pro"], "license": "MIT", "sha256": {…}}`, fetched from `https://raw.githubusercontent.com/sqfmi/watchy-hardware/<commit>/<file>`.
  - `four_layer/finish.json`: `{"pairs": [["USB_D+", "USB_D-"]], "moves": [{"ref", "dx", "dy"}], "hints": [{"net", "region", "layers", "corridor", "rip"}]}`.

- [ ] **Step 1: Write the failing tests**

```python
pytestmark = [pytest.mark.kicad_cli, pytest.mark.kicad_libs, pytest.mark.krt]

def test_reference_router_share_is_recorded(ref, record_property):
    build(ref); r = route_project(ref)
    record_property("reference_router_share", r.share["router"]["share"]); record_property("reference_router_seconds", r.share["router"]["seconds"])
    assert r.state == "done" and r.share["router"]["seconds"] < 300 and r.share["router"]["share"] >= 0.5

def test_reference_board_fully_routed_and_clean(ref, record_property):
    append(ref / "board.py", (FIXTURES / "reference/finish.py").read_text())
    b = build(ref); assert b.verdict == "ok", errors(b)
    r = route_project(ref)
    assert r.state == "done" and r.complete and r.counts["unrouted"] == 0
    assert r.counts["drc_errors"] == 0 and r.counts["copper_errors"] == 0, [f.to_json() for f in r.findings if f.severity == "error"]
    assert r.share["router"]["seconds"] < 300
    record_property("reference_share_with_finish", r.share); record_property("reference_route_seconds", sum(t.seconds for t in r.timings))
    again = build(ref)
    assert again.routing["state"] == "current" and "0 left, DRC clean" in again.headline

def test_reference_route_is_deterministic(ref, tmp_path):
    other = shutil.copytree(FIXTURES / "reference", tmp_path / "again")
    for p in (ref, other): append(p / "board.py", FINISH); build(p)
    a, b = route_project(ref), route_project(other)
    assert a.key == b.key and digest(ref / ".pino/routes" / a.key / "board.kicad_pcb") == digest(other / ".pino/routes" / b.key / "board.kicad_pcb")

@pytest.mark.network
def test_four_layer_board_fully_routed_and_clean(four_layer, kicad, tmp_path, record_property):
    # four_layer: fetched (skip with "offline: the 4-layer test board is fetched from GitHub" on URLError), sha256 checked,
    # pcb upgrade, strip_copper, the moves from finish.json applied with move_footprint
    plan = plan_route(four_layer.text, four_layer.pro, None, pairs=FINISH_PAIRS, hints=FINISH_HINTS)
    out = route_board(tmp_path / "work", four_layer.text, four_layer.pro, None, plan, kicad=kicad, krt=locate(),
                      project_files=four_layer.files, baseline=four_layer.baseline_drc, options=RouteOptions(),
                      events=lambda e: None, cancel=threading.Event())
    record_property("four_layer_share", out.share.to_json())
    assert out.stopped is None and sum(unrouted_nets(out.drc).values()) == 0
    assert [f for f in out.findings if f.severity == "error"] == []
    assert out.share.router_seconds < 300
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PINO_TEST_NETWORK=1 uv run --directory kernel pytest tests/test_pass_mark.py -v -rP`
Expected: the share test passes and records its number; the two "fully routed" tests FAIL with nets left (or SKIP with the `krt` marker message when the router is not installed: run `uv run --directory kernel pino-kernel router install` first; it installs into the user cache).

- [ ] **Step 3: Finish both routes the way Claude would**

Use the trial tools on the failures, in this order: `route_net` with `rip` and a region around the blocked pins; another layer; then `nudge` of the part in the way (with `route`). Write each winning snippet into `finish.py` (reference) or `finish.json` (four-layer). Fix kernel bugs found here in the module that owns them, with a unit test there first. Look at `kicad-cli pcb render` pictures of both routed boards (top and bottom, rendered to `tmp_path`, never opened in a window) and say in the report what you saw and what they do not show. If a board cannot reach zero unrouted nets and zero DRC errors after an honest finish, stop and report the numbers; do not loosen the assertions (the pass mark is Luis's call).

- [ ] **Step 4: Write the README section and the CI step**

- `kernel/README.md`, "Routing": the chain, the router (KRT at its commit, installed on first use into `<cache>/krt/`, `pino-kernel router install`, `PINO_KRT_DIR`/`PINO_KRT_PYTHON`, `PINO_CACHE_DIR`), the route folder, keys and stale copper, the finishing tools and their serve ops, the hole-clearance fix, the recorded shares and times from Step 2 and 3, and the pcbnew list (unchanged: none). Run the humanizer skill on it.
- `.github/workflows/kernel.yml`, job `kernel-kicad`: cache `~/.cache/pino/krt` keyed on the KRT commit, run `uv run --directory kernel pino-kernel router install`, then the whole suite with `PINO_TEST_NETWORK=1`. Job `kernel` adds `and not krt and not network` to its marker filter.

- [ ] **Step 5: Run the whole suite**

Run: `PINO_TEST_NETWORK=1 uv run --directory kernel pytest -v -rP`
Expected: PASS, with the `kicad_cli`, `kicad_libs`, `krt` and `network` tests run (not skipped) on this machine; the recorded shares and times appear in the output.

- [ ] **Step 6: Commit**

```bash
git add kernel/tests/fixtures/reference kernel/tests/fixtures/four_layer kernel/tests/test_pass_mark.py kernel/README.md .github/workflows/kernel.yml
git commit -m "kernel: reference and 4-layer boards fully routed and DRC clean; router share and time recorded"
```

---

## Self-review

**Spec and scope coverage:**

1. KRT managed by pino (pinned commit, user cache venv, first-use install, version check, missing-router finding, NOTICE): Task 1.
2. Route job (input a fast build's board, `.pino/routes/<hash>/`, key of nets, placement, rules and `keep_route` data, cancellable, progress lines, timeouts, `pino-kernel route`, serve request with streamed progress): Tasks 5 (key), 8 (job and CLI), 10 (serve).
3. Router chain (QFN fanout, pairs from declarations, the rest, fab overrides): Tasks 5 and 6. Planes first and plane repair are added after KRT's own documented order; Task 2 adds `diff_pair` and Task 3 suggests undeclared pairs.
4. Post-route (stub cleanup, deterministic UUIDs, zone refill, DRC JSON with parity, unrouted nets, dangling copper, widths per class, pair spacing, router share and time): Tasks 4, 7 and 8.
5. Stale copper, never silently reused: Task 9.
6. Finishing tools (`keep_route`, fixed vias, route one net in a region, nudge, serve requests): Tasks 2, 3, 11; `keep` closes the loop from routed copper back to `board.py`.
7. Pass mark (reference board and the 4-layer board, fully routed, DRC clean, share and time recorded): Task 12.
- Spec 5.3 "Claude finishes by writing tracks into board.py (fixed tracks, or routes through a region)": `keep_route`/`fixed_via` and `route_hint`. Luis's stroke marks map to `corridor` (KRT's guide corridor) when the marks stage builds them.
- Spec 5.8 ("never waive a finding yourself"): no tool here waives, loosens a rule or drops a finding; Task 12 forbids loosening the pass mark.
- Spec 3 (no pcbnew, no windows, writes only under `.pino/`): Global Constraints, `test_no_display_and_no_window_flags`, `test_writes_only_under_dot_pino`, hygiene tests.

**Step scan:** each step names its file, signature, values or command. The parts the tests do not pin are written out: the chain's arguments (Task 6), the job's step order (Task 8), the key parts (Task 5), the fanout rule and the contact rule (Tasks 4 and 5).

**Type consistency:** `RoutePlan`, `RouterRules`, `RouteKey`, `ChainStep`, `StepRun`, `Share`, `RouteOutcome`, `RouteResult`, `TrialResult`, `Copper` and its item types, `KeptRoute`, `RouteHint`, `PairSpec`, `Krt` and `RouteOptions` keep the same names and fields in every task that uses them. Engine names are used as the engine plan defines them.

**Review Focus:** five entries, each with its test in the owning task (8, 9, 1, 8 and 10, 7 and 8).

**Proportion:** test bodies are assertions; module bodies are left to the implementer except the chain arguments, the job steps and the key parts.

## Calls made in this plan (for Luis to check)

- Planes (`route_planes.py`) run first and `route_disconnected_planes.py` last, following KRT's own plan; the spike measured routing GND as tracks. If planes do worse on the reference board, Task 12 says so and the plan's order is the thing to change.
- `pino.build/1` keeps its name and gains `routing`; route findings stay in `route.json` and are not merged into the build's findings.
- Region hints are rectangles; a polygon region from a mark is reduced to its box by the caller.
- Hole clearance: vias are grown to `drill + 2 * (hole clearance - min clearance)` and NPTH holes get router keep-outs; nothing is filed upstream.
- Pair defaults (width and gap from the positive net's class), `PAIR_TOLERANCE` 0.02 mm and `PAIR_MIN_COUPLED` 0.5 are first guesses.
- The 4-layer board is Watchy, which is in KRT's own stress corpus; an untouched 4-layer board (the spike suggested beepy) is still to do.

## Director's calls (2026-11-26, Luis asleep, recommendations taken)

- Ground: on 4-layer boards a GND plane on an inner layer, KRT's own planes-first order; on 2-layer boards GND as tracks, as the spike measured. Task 6 records both orders' router share on the 2-layer reference board.
- The build result stays at schema version 1 with an added `routing` field: nothing consumes it yet.
- Pass mark stays strict: if hints and nudges cannot take Watchy to 100 percent DRC clean, stop and report the gap; do not loosen it.
- KRT pin: use the release whose prebuilt binary matches the pinned commit; if none does, pin the release tag's commit instead and say so. No cargo builds on first use.
- Region hints are rectangles in v1; pair tolerances start from KRT's defaults.
