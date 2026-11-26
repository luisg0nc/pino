"""The route job: a fast build's board through the router chain into `.pino/routes/<key>/`.

    router    the router found (or installed)
    plan      the route plan and its key
    chain     planes, fanout, pairs, signals, plane repair
    refill    the router's copper merged into pino's board, hashed UUIDs, zones refilled, DRC counts the nets
    hints     board.py's route hints on the chain's output, refilled again (only when there are hints)
    cleanup   stubs, duplicates and dead ends off the router's copper
    drc       the cleaned board refilled with DRC and schematic parity, with pino's own project files
    checks    DRC the routing added, nets left, copper checks, failed steps

A route runs in `<key>.tmp-<pid>-<thread>/` and is renamed into place when it is done, so a half-written folder is
never read. One route runs per project (`.pino/routes/job.lock`).
"""

from __future__ import annotations

import datetime
import fcntl
import json
import os
import shutil
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

from .. import __version__
from ..findings import Finding
from ..history import History
from ..kicad_cli import KicadCli
from ..libraries import LibrariesNotFound, discover
from ..normalize import normalize
from ..pcb.cleanup import cleanup
from ..pcb.copper import Copper, copper_json, copper_nodes, merge_copper, read_copper, rewrite_uuids
from ..result import Timing, sort_and_cap
from .chain import Events, StepRun, chain_steps, hint_steps, run_steps
from .checks import Share, complete_nets, copper_findings, router_drc, unrouted_findings, unrouted_nets
from .history import RouteHistory
from .key import route_key
from .krt import KRT_COMMIT, KRT_VERSION, Krt, RouterMissing, ensure, krt_env
from .plan import RoutePlan, board_box, net_class_widths, plan_for_build
from .result import SCHEMA, RouteResult, empty_counts, route_headline

KEEP_ROUTES = 10
LOG_PER_STEP = 200_000  # characters of each step's output kept in log.txt
PROJECT_FILES = ("board.kicad_pro", "board.kicad_dru", "board.kicad_sch", "sym-lib-table", "fp-lib-table")
ROUTER = {"name": "KiCadRoutingTools", "version": KRT_VERSION, "commit": KRT_COMMIT}


@dataclass
class RouteOptions:
    timeout: float = 900.0
    step_timeout: float = 300.0
    install: bool = True
    cache: bool = True
    keep_steps: bool = False


@dataclass
class RouteOutcome:
    board_text: str
    copper: Copper
    drc: dict
    share: Share
    steps: list[StepRun]
    findings: list[Finding]
    timings: list[Timing]
    stopped: str | None  # None | cancelled | timed_out | failed
    filled_text: str = ""
    problem: str | None = None
    unrouted: int = 0
    plan: RoutePlan | None = None


class _Clock:
    def __init__(self):
        self.times: list[Timing] = []

    def run(self, step, fn, *args, **kw):
        t = time.perf_counter()
        try:
            return fn(*args, **kw)
        finally:
            self.times.append(Timing(step, time.perf_counter() - t))


def _footprint_refs(pcb_text: str) -> dict[str, str]:
    from ..build import _footprint_refs as refs

    return refs(pcb_text)


def _drc_into(kicad: KicadCli, folder: Path, board_text: str, project_files: Mapping[str, Path], out: Path,
              *, parity: bool) -> tuple[dict | None, str, str | None]:
    """(report, the saved board text, problem): the board refilled and checked in `folder` with pino's files."""
    folder.mkdir(parents=True, exist_ok=True)
    for name, src in project_files.items():
        if Path(src).is_file():
            shutil.copy(src, folder / name)
    pcb = folder / "board.kicad_pcb"
    pcb.write_text(board_text, encoding="utf-8")
    run = kicad.drc(pcb, out, refill=True, save=True, parity=parity)
    for extra in folder.glob("*.kicad_prl"):
        extra.unlink()
    if not run.ok or not out.is_file():
        return None, board_text, f"kicad-cli DRC failed: {run.last_line() or f'exit code {run.returncode}'}"
    try:
        report = json.loads(out.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None, board_text, "kicad-cli DRC wrote a report pino cannot read"
    return report, pcb.read_text(encoding="utf-8"), None


def route_board(work: Path, board_text: str, pro_text: str, dru_text: str | None, plan: RoutePlan, *,
                kicad: KicadCli, krt: Krt, project_files: Mapping[str, Path], baseline: dict | None,
                options: RouteOptions, events: Events, cancel: threading.Event) -> RouteOutcome:
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    clock = _Clock()
    findings: list[Finding] = []
    start = time.monotonic()
    deadline = start + options.timeout
    base_copper = read_copper(board_text)
    nets, before = complete_nets(baseline or {"unconnected_items": []}, base_copper) if baseline is not None \
        else (complete_nets({"unconnected_items": []}, base_copper)[0], 0)

    def outcome(stopped, steps, problem=None, text=board_text, copper=base_copper, drc=None, share=None, filled=""):
        share = share or Share(nets, before, before, before, 0.0, 0.0)
        return RouteOutcome(text, copper, drc or {}, share, steps, findings, clock.times, stopped, filled, problem,
                            0, plan)

    clock.run("plan", lambda: findings.extend(plan.warnings))
    env = krt_env(kicad)
    chain = chain_steps(plan, krt)
    hints = hint_steps(plan, krt, board_box(board_text))
    total = len(chain) + len(hints)
    result = clock.run("chain", run_steps, krt, chain, board_text, pro_text, work / "steps", plan=plan, env=env,
                       step_timeout=options.step_timeout, deadline=deadline, cancel=cancel, events=events,
                       index0=0, total=total)
    steps = list(result.steps)
    if result.stopped:
        return outcome(result.stopped, steps)

    def refill(text: str, name: str):
        merged = merge_copper(board_text, rewrite_uuids(copper_nodes(text)))
        return _drc_into(kicad, work / name, merged, project_files, work / name / "drc.json", parity=False)

    report, refilled, problem = clock.run("refill", refill, result.board_text, "refill")
    if problem:
        findings.append(Finding("kicad", "kicad_cli_failed", "error", problem))
        return outcome("failed", steps, problem)
    after_router = complete_nets(report, read_copper(refilled))[1]
    after_finish = after_router
    finish_seconds = 0.0
    if hints:
        t0 = time.monotonic()

        def run_hints():
            r = run_steps(krt, hints, result.board_text, pro_text, work / "steps", plan=plan, env=env,
                          step_timeout=options.step_timeout, deadline=deadline, cancel=cancel, events=events,
                          index0=len(chain), total=total)
            steps.extend(r.steps)
            if r.stopped:
                return r, None, None, None
            rep, text, prob = refill(r.board_text, "refill-hints")
            return r, rep, text, prob

        hr, hreport, htext, problem = clock.run("hints", run_hints)
        finish_seconds = time.monotonic() - t0
        if hr.stopped:
            return outcome(hr.stopped, steps)
        if problem:
            findings.append(Finding("kicad", "kicad_cli_failed", "error", problem))
            return outcome("failed", steps, problem)
        report, refilled = hreport, htext

    def clean():
        text, rep = cleanup(refilled, read_copper(refilled))
        return merge_copper(board_text, rewrite_uuids(copper_nodes(text)))

    final = clock.run("cleanup", clean)
    report, filled, problem = clock.run("drc", _drc_into, kicad, work / "filled", final, project_files,
                                        work / "drc.json", parity=True)
    if problem:
        findings.append(Finding("kicad", "kicad_cli_failed", "error", problem))
        return outcome("failed", steps, problem, text=final)
    copper = read_copper(filled)

    def checks():
        out = router_drc(report, baseline or {}, _footprint_refs(final))
        out += unrouted_findings(report, copper)
        widths = net_class_widths(pro_text, sorted({p.net for p in copper.pads if p.net}))
        out += copper_findings(copper, plan, widths)
        for s in steps:
            if s.note.startswith(("failed", "no output")):
                out.append(Finding("router", "router_step_failed", "warning",
                                   f"router step {s.step} ({s.script}) {s.note}"))
        return out

    findings.extend(clock.run("checks", checks))
    after_finish = complete_nets(report, copper)[1]
    share = Share(nets, before, after_router, after_finish, result.seconds, finish_seconds)
    o = outcome(None, steps, text=final, copper=copper, drc=report, share=share, filled=filled)
    o.unrouted = sum(unrouted_nets(report, copper).values())
    return o


# --- the project job -----------------------------------------------------------------------------------------


def latest_build(project: Path) -> str | None:
    dot = Path(project) / ".pino"
    for b in reversed(History(project).entries()):
        h = b.get("hash")
        if h and b.get("verdict") not in ("failed", "running") and (dot / "build" / h / "board.kicad_pcb").is_file():
            return h
    return None


def _build_number(project: Path, build: str | None) -> int | None:
    if not build:
        return None
    for b in reversed(History(project).entries()):
        if b.get("hash") == build:
            return b.get("number")
    return None


def _counts(outcome: RouteOutcome, drc_found: list[Finding], copper_found: list[Finding]) -> dict[str, int]:
    c = outcome.copper
    mm = sum(((t.a[0] - t.b[0]) ** 2 + (t.a[1] - t.b[1]) ** 2) ** 0.5 for t in c.tracks)
    return {"nets": outcome.share.nets, "unrouted": outcome.unrouted, "tracks": len(c.tracks) + len(c.arcs),
            "vias": len(c.vias), "track_mm": int(round(mm)),
            "drc_errors": sum(f.severity == "error" for f in drc_found),
            "drc_warnings": sum(f.severity == "warning" for f in drc_found),
            "copper_errors": sum(f.severity == "error" for f in copper_found),
            "copper_warnings": sum(f.severity == "warning" for f in copper_found)}


def _write_log(folder: Path, steps: list[StepRun], work: Path) -> None:
    parts = []
    for s in steps:
        log = work / "steps" / s.folder / "log.txt"
        text = log.read_text(encoding="utf-8", errors="replace") if log.is_file() else ""
        parts.append(f"== {s.step} ({s.script}), exit {s.returncode}, {s.seconds:.1f} s\n{text[-LOG_PER_STEP:]}")
    (folder / "log.txt").write_text("\n".join(parts), encoding="utf-8")


def _prune(project: Path, history: RouteHistory, keep: int) -> None:
    routes = Path(project) / ".pino" / "routes"
    latest = history.latest_done()
    keep_set = set(history.recent_keys(keep)) | ({latest["key"]} if latest else set())
    for d in sorted(routes.iterdir()):
        if d.is_dir() and ".tmp-" not in d.name and d.name not in keep_set:
            shutil.rmtree(d, ignore_errors=True)


def route_project(project: Path, *, build: str | None = None, options: RouteOptions = RouteOptions(),
                  events: Events = lambda e: None, cancel: threading.Event | None = None) -> RouteResult:
    project = Path(project).resolve()
    cancel = cancel or threading.Event()
    routes = project / ".pino" / "routes"
    routes.mkdir(parents=True, exist_ok=True)
    lock = open(routes / "job.lock", "a+")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        return RouteResult(SCHEMA, __version__, dict(ROUTER), None, build, 0, "busy", "failed",
                           "Route: a route is already running for this project", False, empty_counts(), None, [], 0,
                           [], [], {}, False)
    try:
        return _route_locked(project, lock, build, options, events, cancel)
    finally:
        try:
            lock.seek(0)
            lock.truncate()
        except OSError:
            pass
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        lock.close()


def _route_locked(project: Path, lock, build: str | None, options: RouteOptions, events: Events,
                  cancel: threading.Event) -> RouteResult:
    routes = project / ".pino" / "routes"
    history = RouteHistory(project)
    number = history.next_number()
    started = time.monotonic()
    clock = _Clock()

    def note_lock(key: str | None) -> None:
        lock.seek(0)
        lock.truncate()
        lock.write(json.dumps({"key": key, "pid": os.getpid(), "started": datetime.datetime.now(
            datetime.timezone.utc).replace(microsecond=0).isoformat()}))
        lock.flush()

    note_lock(None)

    def failed(state: str, problem: str, found: list[Finding], key=None, build_hash=None, steps=(), share=None):
        kept, truncated = sort_and_cap(found)
        history.record(number, key, build_hash, state, None)
        return RouteResult(SCHEMA, __version__, dict(ROUTER), key, build_hash, number, state, "failed",
                           route_headline(number, _build_number(project, build_hash), state, {}, share, problem),
                           False, empty_counts(), share, kept, truncated, list(steps), clock.times, {}, False)

    try:
        krt = clock.run("router", ensure, allow_install=options.install,
                        on_line=lambda s: events({"event": "log", "step": "router install", "line": s[:300]}))
    except RouterMissing as e:
        return failed("failed", "KiCadRoutingTools missing: run pino-kernel router install", [e.finding])
    build_hash = build or latest_build(project)
    build_dir = project / ".pino" / "build" / (build_hash or "")
    if not build_hash or not (build_dir / "board.kicad_pcb").is_file():
        return failed("failed", "no build yet: save board.py first", [
            Finding("route", "no_build", "error", "there is no finished build of board.py to route; save board.py "
                                                  "first")])
    t0 = time.perf_counter()
    plan = plan_for_build(build_dir)
    board_text = (build_dir / "board.kicad_pcb").read_text(encoding="utf-8")
    pro_text = (build_dir / "board.kicad_pro").read_text(encoding="utf-8")
    dru_path = build_dir / "board.kicad_dru"
    dru_text = dru_path.read_text(encoding="utf-8") if dru_path.is_file() else None
    key = route_key(board_text, pro_text, dru_text, plan)
    plan_seconds = time.perf_counter() - t0
    note_lock(key.key)
    final = routes / key.key
    build_number = _build_number(project, build_hash)

    if options.cache and (final / "route.json").is_file():
        try:
            stored = RouteResult.from_json((final / "route.json").read_text(encoding="utf-8"))
        except (ValueError, KeyError, json.JSONDecodeError):
            stored = None
        if stored is not None and stored.state == "done":
            stored.number, stored.build, stored.cached = number, build_hash, True
            stored.headline = route_headline(number, build_number, "done", stored.counts, stored.share, None)
            stored.timings = clock.times + [Timing("plan", plan_seconds)] + \
                [Timing(t.step, t.seconds, True) for t in stored.timings if t.step not in ("router", "plan")]
            history.record(number, key.key, build_hash, "done", stored.complete)
            return stored

    try:
        libs = discover()
    except LibrariesNotFound as e:
        return failed("failed", "KiCad's libraries were not found", [
            Finding("kernel", "libraries_not_found", "error", str(e))], key.key, build_hash)
    argv = KicadCli.find()
    if not argv:
        return failed("failed", "kicad-cli not found: install KiCad 10 to route", [
            Finding("kernel", "kicad_cli_missing", "error", "routing refills zones and runs DRC with kicad-cli, "
                                                            "which was not found; install KiCad 10 or set "
                                                            "PINO_KICAD_CLI")], key.key, build_hash)
    kicad = KicadCli(libs, project / ".pino" / "kicad", argv)
    tmp = routes / f"{key.key}.tmp-{os.getpid()}-{threading.get_ident()}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    try:
        project_files = {name: build_dir / name for name in PROJECT_FILES}
        baseline = None
        if (build_dir / "drc.json").is_file():
            try:
                baseline = json.loads((build_dir / "drc.json").read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                baseline = None
        if baseline is None:
            filled_src = build_dir / "filled" / "board.kicad_pcb"
            text = filled_src.read_text(encoding="utf-8") if filled_src.is_file() else board_text
            baseline, _, _ = _drc_into(kicad, tmp / "baseline", text, project_files, tmp / "baseline" / "drc.json",
                                       parity=False)
        outcome = route_board(tmp / "work", board_text, pro_text, dru_text, plan, kicad=kicad, krt=krt,
                              project_files=project_files, baseline=baseline, options=options, events=events,
                              cancel=cancel)
        timings = clock.times + [Timing("plan", plan_seconds + sum(t.seconds for t in outcome.timings
                                                                   if t.step == "plan"))] + \
            [t for t in outcome.timings if t.step != "plan"]
        clock.times = timings
        if outcome.stopped:
            seconds = time.monotonic() - started
            problem = {"cancelled": f"cancelled after {seconds:.0f} s",
                       "timed_out": f"timed out after {seconds:.0f} s"}.get(outcome.stopped, outcome.problem)
            return failed(outcome.stopped, problem or "the route failed", outcome.findings, key.key, build_hash,
                          outcome.steps)
        drc_found = [f for f in outcome.findings if f.source == "drc"]
        copper_found = [f for f in outcome.findings if f.source == "copper"]
        counts = _counts(outcome, drc_found, copper_found)
        kept, truncated = sort_and_cap(outcome.findings)
        complete = counts["unrouted"] == 0
        verdict = "errors" if counts["unrouted"] or any(f.severity == "error" for f in outcome.findings) else "ok"
        share = outcome.share.to_json()
        rel = lambda name: (final / name).relative_to(project).as_posix()
        artifacts = {"folder": final.relative_to(project).as_posix(), "board": rel("board.kicad_pcb"),
                     "filled": rel("filled/board.kicad_pcb"), "copper": rel("copper.json"), "drc": rel("drc.json"),
                     "plan": rel("plan.json"), "key": rel("key.json"), "log": rel("log.txt")}
        headline = route_headline(number, build_number, "done", counts, share, None)
        result = RouteResult(SCHEMA, __version__, dict(ROUTER), key.key, build_hash, number, "done", verdict, headline,
                             complete, counts, share, kept, truncated, outcome.steps, timings, artifacts, False)
        (tmp / "key.json").write_text(key.to_json(), encoding="utf-8")
        (tmp / "plan.json").write_text(plan.to_json(), encoding="utf-8")
        (tmp / "board.kicad_pcb").write_text(outcome.board_text, encoding="utf-8")
        (tmp / "copper.json").write_text(copper_json(outcome.copper), encoding="utf-8")
        shutil.copytree(tmp / "work" / "filled", tmp / "filled")
        shutil.copy(tmp / "work" / "drc.json", tmp / "drc.json")
        normalize(tmp / "drc.json")
        _write_log(tmp, outcome.steps, tmp / "work")
        (tmp / "route.json").write_text(result.to_json(), encoding="utf-8")
        if options.keep_steps:
            (tmp / "work").rename(tmp / "steps")
        else:
            shutil.rmtree(tmp / "work", ignore_errors=True)
        shutil.rmtree(tmp / "baseline", ignore_errors=True)
        if final.exists():
            shutil.rmtree(final, ignore_errors=True)
        tmp.rename(final)
        history.record(number, key.key, build_hash, "done", complete)
        _prune(project, history, KEEP_ROUTES)
        return result
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
