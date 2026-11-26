"""Claude's finishing tools: try one net with the router, try a part somewhere else, keep routed copper.

Each trial works in `.pino/trials/<n>/` (the newest 20 are kept) and hands back board.py lines; pino never edits
board.py. A route_net trial runs the same hint step the next route will run, on the current route's board (or the
unrouted board when there is no current route), so the hint it returns replays what it found.
"""

from __future__ import annotations

import fcntl
import json
import shutil
import threading
import time
from pathlib import Path
from typing import Sequence

from ..checks.courtyards import courtyard_overlaps
from ..checks.fit import fit_findings
from ..circuit import Circuit, PartPose, RouteHint, placement_from_json
from ..findings import Finding
from ..kicad_cli import KicadCli
from ..libraries import LibrariesNotFound, discover
from ..pcb.copper import copper_json, copper_nodes, merge_copper, read_copper, rewrite_uuids
from ..pcb.footprint import FootprintLibrary, pad_world
from ..pcb.writer import fab_of, placed_parts, write_board
from ..placement.ratsnest import PadPoint, score
from ..result import sort_and_cap
from .chain import Events, hint_steps, run_steps
from .checks import router_drc, unrouted_nets
from .job import PROJECT_FILES, RouteOptions, _drc_into, _footprint_refs, latest_build, route_board
from .krt import RouterMissing, ensure, krt_env
from .plan import board_box, plan_route
from .result import TRIAL_SCHEMA, TrialResult
from .snippets import board_var, hint_snippet, keep_snippets, place_snippet
from .state import build_routing

KEEP_TRIALS = 20


class TrialError(Exception):
    """A trial that cannot run; its message is the headline."""


def _new_trial(project: Path) -> tuple[int, Path]:
    trials = Path(project) / ".pino" / "trials"
    trials.mkdir(parents=True, exist_ok=True)
    with open(trials / "lock", "a+") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            n = int((trials / "next").read_text().strip())
        except (OSError, ValueError):
            n = 1
        (trials / "next").write_text(f"{n + 1}\n")
        folder = trials / str(n)
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir()
        numbered = sorted((int(d.name), d) for d in trials.iterdir() if d.is_dir() and d.name.isdigit())
        for _, d in numbered[:-KEEP_TRIALS]:
            shutil.rmtree(d, ignore_errors=True)
    return n, folder


class _Ctx:
    def __init__(self, project: Path):
        self.project = Path(project).resolve()
        self.build = latest_build(self.project)
        if self.build is None:
            raise TrialError("no build yet: save board.py first")
        self.dir = self.project / ".pino" / "build" / self.build
        self.circuit = Circuit.from_json((self.dir / "circuit.json").read_text(encoding="utf-8"))
        self.routing = build_routing(self.project, self.dir) or {"state": "none", "route": None, "key": None}
        self.pro = (self.dir / "board.kicad_pro").read_text(encoding="utf-8")
        dru = self.dir / "board.kicad_dru"
        self.dru = dru.read_text(encoding="utf-8") if dru.is_file() else None
        self.files = {name: self.dir / name for name in PROJECT_FILES}
        board_py = self.project / "board.py"
        self.var = board_var(board_py.read_text(encoding="utf-8")) if board_py.is_file() else "b"

    @property
    def current(self) -> bool:
        return self.routing.get("state") == "current"

    def route_dir(self) -> Path | None:
        return self.project / self.routing["route"] if self.current else None

    def base(self) -> dict:
        return {"build": self.build, "route": self.routing.get("key") if self.current else None}

    def kicad(self) -> KicadCli:
        argv = KicadCli.find()
        if not argv:
            raise TrialError("kicad-cli not found: install KiCad 10 to try routes")
        try:
            libs = discover()
        except LibrariesNotFound:
            raise TrialError("KiCad's libraries were not found") from None
        return KicadCli(libs, self.project / ".pino" / "kicad", argv)

    def baseline(self) -> dict:
        try:
            return json.loads((self.dir / "drc.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}


def _result(kind, ctx, number, folder, ok, headline, before, after, findings, snippet, replaces, started,
            extra=None) -> TrialResult:
    kept, truncated = sort_and_cap(findings)
    rel = lambda name: (folder / name).relative_to(ctx.project).as_posix()
    artifacts = {"folder": folder.relative_to(ctx.project).as_posix()}
    for key, name in (("board", "board.kicad_pcb"), ("copper", "copper.json"), ("drc", "drc.json"),
                      ("filled", "filled/board.kicad_pcb")):
        if (folder / name).is_file():
            artifacts[key] = rel(name)
    t = TrialResult(TRIAL_SCHEMA, kind, ctx.base(), number, ok, headline, before, after, kept, truncated, snippet,
                    replaces, artifacts, time.monotonic() - started)
    (folder / "trial.json").write_text(t.to_json(), encoding="utf-8")
    return t


def _refused(kind: str, project: Path, headline: str) -> TrialResult:
    return TrialResult(TRIAL_SCHEMA, kind, {"build": None, "route": None}, 0, False, headline, {}, {}, [], 0, "",
                       None, {}, 0.0)


def _drc_errors(report: dict, baseline: dict, board_text: str) -> int:
    return sum(f.severity == "error" for f in router_drc(report, baseline, _footprint_refs(board_text)))


# --- route one net -------------------------------------------------------------------------------------------


def route_net(project: Path, net: str, *, region=None, layers=None, corridor=None, rip: Sequence[str] = (),
              options: RouteOptions = RouteOptions(), events: Events = lambda e: None,
              cancel: threading.Event | None = None) -> TrialResult:
    started = time.monotonic()
    cancel = cancel or threading.Event()
    try:
        ctx = _Ctx(project)
        krt = ensure(allow_install=options.install)
        kicad = ctx.kicad()
    except TrialError as e:
        return _refused("route_net", project, str(e))
    except RouterMissing:
        return _refused("route_net", project, "KiCadRoutingTools missing: run pino-kernel router install")
    number, folder = _new_trial(ctx.project)
    snippet = hint_snippet(ctx.var, net, region, layers, corridor, list(rip))
    route_dir = ctx.route_dir()
    base_text = ((route_dir or ctx.dir) / "board.kicad_pcb").read_text(encoding="utf-8")
    try:
        base_report = json.loads(((route_dir or ctx.dir) / "drc.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        base_report, _, _ = _drc_into(kicad, folder / "before", base_text, ctx.files, folder / "before" / "drc.json",
                                      parity=False)
        base_report = base_report or {}
    hint = RouteHint(net, None if region is None else tuple(float(v) for v in region),
                     None if not layers else list(layers),
                     None if not corridor else [(float(x), float(y)) for x, y in corridor], list(rip), None)
    plan = plan_route(base_text, ctx.pro, ctx.dru, pairs=ctx.circuit.pairs, hints=[hint])
    note = "" if ctx.current else "; no current route: tried on the unrouted board"
    if not plan.hints:
        return _result("route_net", ctx, number, folder, False, f"Trial t{number}: no net {net} has pads on the board",
                       {}, {}, plan.warnings, snippet, None, started)
    baseline = ctx.baseline()
    before_left = unrouted_nets(base_report, read_copper(base_text))
    before = {"net_complete": net not in before_left, "unrouted_nets": len(before_left),
              "drc_errors": _drc_errors(base_report, baseline, base_text)}
    r = run_steps(krt, hint_steps(plan, krt, board_box(base_text)), base_text, ctx.pro, folder / "work", plan=plan,
                  env=krt_env(kicad), step_timeout=options.step_timeout, deadline=time.monotonic() + options.timeout,
                  cancel=cancel, events=events)
    findings: list[Finding] = []
    if r.stopped:
        shutil.rmtree(folder / "work", ignore_errors=True)
        return _result("route_net", ctx, number, folder, False, f"Trial t{number}: {r.stopped.replace('_', ' ')}",
                       before, {}, findings, snippet, None, started)
    merged = merge_copper(base_text, rewrite_uuids(copper_nodes(r.board_text)))
    report, filled, problem = _drc_into(kicad, folder / "filled", merged, ctx.files, folder / "drc.json", parity=False)
    (folder / "board.kicad_pcb").write_text(merged, encoding="utf-8")
    if problem:
        return _result("route_net", ctx, number, folder, False, f"Trial t{number}: {problem}", before, {},
                       [Finding("kicad", "kicad_cli_failed", "error", problem)], snippet, None, started)
    copper = read_copper(filled)
    (folder / "copper.json").write_text(copper_json(copper), encoding="utf-8")
    after_left = unrouted_nets(report, copper)
    after = {"net_complete": net not in after_left, "unrouted_nets": len(after_left),
             "drc_errors": _drc_errors(report, baseline, merged)}
    for s in r.steps:
        if s.note:
            findings.append(Finding("router", "router_step_failed", "warning", f"router step {s.step} {s.note}"))
    findings += [f for f in router_drc(report, baseline, _footprint_refs(merged)) if net in f.nets or not f.nets]
    ok = after["net_complete"] and after["drc_errors"] <= before["drc_errors"]
    new = after["drc_errors"] - before["drc_errors"]
    words = (f"Trial t{number}: {net} " + ("routed" if after["net_complete"] else "still open") +
             f", {after['unrouted_nets']} net{'s' if after['unrouted_nets'] != 1 else ''} left, " +
             ("no new DRC errors" if new <= 0 else f"{new} new DRC error{'s' if new != 1 else ''}") + note)
    shutil.rmtree(folder / "work", ignore_errors=True)
    return _result("route_net", ctx, number, folder, ok, words, before, after, findings, snippet, None, started)


# --- nudge a part --------------------------------------------------------------------------------------------


def _score(circuit: Circuit, placed) -> dict:
    planes = {n.name for n in circuit.nets if n.kind == "gnd"} | {z.net for z in circuit.zones}
    nets: dict[str, list[PadPoint]] = {}
    for p in placed:
        for q in pad_world(p):
            if q.net and not q.net.startswith("unconnected-("):
                side = "X" if q.through else ("B" if p.back else "F")
                nets.setdefault(q.net, []).append(PadPoint(q.x, q.y, side, p.ref, q.number))
    s = score(nets, planes)
    return {"crossings": s.crossings, "length_mm": round(s.length, 3), "score": round(s.total, 3)}


def nudge(project: Path, ref: str, *, by: tuple[float, float] = (0.0, 0.0), rot: float | None = None,
          back: bool | None = None, route: bool = False, options: RouteOptions = RouteOptions(),
          events: Events = lambda e: None, cancel: threading.Event | None = None) -> TrialResult:
    started = time.monotonic()
    cancel = cancel or threading.Event()
    try:
        ctx = _Ctx(project)
    except TrialError as e:
        return _refused("nudge", project, str(e))
    doc = json.loads((ctx.dir / "placement.json").read_text(encoding="utf-8"))
    placement = placement_from_json(json.dumps(doc["poses"]))
    if ref not in placement:
        return _refused("nudge", project, f"no part {ref} on the board")
    number, folder = _new_trial(ctx.project)
    old = placement[ref]
    new = PartPose(round(old.x + float(by[0]), 6) + 0.0, round(old.y + float(by[1]), 6) + 0.0,
                   float(old.rot if rot is None else rot), bool(old.back if back is None else back))
    moved = {**placement, ref: new}
    footprints = FootprintLibrary(discover())
    placed_old = placed_parts(ctx.circuit, placement, footprints)
    placed_new = placed_parts(ctx.circuit, moved, footprints)
    findings = [f for f in courtyard_overlaps(placed_new) + fit_findings(ctx.circuit, placed_new, fab_of(ctx.circuit))
                if ref in f.refs]
    before, after = _score(ctx.circuit, placed_old), _score(ctx.circuit, placed_new)
    ok = not any(f.severity == "error" for f in findings)
    errors = [f for f in findings if f.severity == "error"]
    if route:
        try:
            krt = ensure(allow_install=options.install)
            kicad = ctx.kicad()
        except (TrialError, RouterMissing) as e:
            msg = str(e) if isinstance(e, TrialError) else "KiCadRoutingTools missing: run pino-kernel router install"
            return _result("nudge", ctx, number, folder, False, f"Trial t{number}: {msg}", before, after, findings,
                           place_snippet(ctx.var, ref, new), None, started)
        files = write_board(ctx.circuit, moved, footprints)
        plan = plan_route(files.kicad_pcb, files.kicad_pro, files.kicad_dru, pairs=ctx.circuit.pairs,
                          hints=ctx.circuit.route_hints)
        out = route_board(folder / "work", files.kicad_pcb, files.kicad_pro, files.kicad_dru, plan, kicad=kicad,
                          krt=krt, project_files=ctx.files, baseline=None, options=options, events=events,
                          cancel=cancel)
        before["unrouted"] = ctx.routing.get("unrouted") if ctx.current else None
        before["router_share"] = ctx.routing.get("router_share") if ctx.current else None
        after["unrouted"] = out.unrouted if not out.stopped else None
        share = out.share.router_share()
        after["router_share"] = None if share is None or out.stopped else round(share, 3)
        if not out.stopped:
            (folder / "board.kicad_pcb").write_text(out.board_text, encoding="utf-8")
            (folder / "copper.json").write_text(copper_json(out.copper), encoding="utf-8")
        findings += [f for f in out.findings if f.severity == "error"]
        grew = after["unrouted"] is None or (before["unrouted"] is not None and after["unrouted"] > before["unrouted"])
        ok = ok and not grew
        shutil.rmtree(folder / "work", ignore_errors=True)
    replaces = next((i.line for i in ctx.circuit.intents if i.target == ref), None)
    words = f"Trial t{number}: {ref} to ({new.x:g}, {new.y:g})"
    words += ", fits" if not errors else f", {len(errors)} problem{'s' if len(errors) != 1 else ''}"
    words += f", {after['crossings']} crossings (was {before['crossings']})"
    if route and after.get("unrouted") is not None:
        words += f", {after['unrouted']} left after routing"
    return _result("nudge", ctx, number, folder, ok, words, before, after, findings, place_snippet(ctx.var, ref, new),
                   replaces, started)


# --- keep routed copper --------------------------------------------------------------------------------------


def keep(project: Path, net: str) -> TrialResult:
    started = time.monotonic()
    try:
        ctx = _Ctx(project)
    except TrialError as e:
        return _refused("keep", project, str(e))
    number, folder = _new_trial(ctx.project)
    state = ctx.routing.get("state")
    if state != "current":
        why = f"the copper of {net} is stale" if state == "stale" else \
            "a route is running" if state == "running" else f"{net} has no routed copper yet"
        return _result("keep", ctx, number, folder, False, f"route first: {why}", {}, {}, [], "", None, started)
    copper = read_copper((ctx.route_dir() / "board.kicad_pcb").read_text(encoding="utf-8"))
    try:
        lines = keep_snippets(ctx.var, copper, net)
    except ValueError as e:
        return _result("keep", ctx, number, folder, False, f"keep {net}: {e}; route it without arcs first", {}, {},
                       [], "", None, started)
    if not lines:
        return _result("keep", ctx, number, folder, False, f"keep {net}: no routed copper of {net} to keep", {}, {},
                       [], "", None, started)
    snippet = "\n".join(lines)
    if any("via(" in line for line in lines):
        snippet += "\n# needs: from pino import via"
    return _result("keep", ctx, number, folder, True,
                   f"Trial t{number}: {len(lines)} keep_route line{'s' if len(lines) != 1 else ''} for {net}", {}, {},
                   [], snippet, None, started)


# --- serve ops -----------------------------------------------------------------------------------------------


def _floats(v, n: int | None, what: str) -> list[float]:
    try:
        out = [float(x) for x in v]
    except (TypeError, ValueError):
        raise ValueError(f"{what} takes numbers") from None
    if n is not None and len(out) != n:
        raise ValueError(f"{what} takes {n} numbers")
    return out


def route_net_argv(req: dict, project: Path) -> list[str]:
    net = req.get("net")
    if not isinstance(net, str) or not net:
        raise ValueError("route_net needs a net")
    argv = ["route-net", str(project), "--net", net]
    if req.get("region") is not None:
        argv.append("--region=" + ",".join(str(v) for v in _floats(req["region"], 4, "region")))
    if req.get("layers"):
        argv += ["--layers", *[str(x) for x in req["layers"]]]
    if req.get("corridor"):
        argv += [f"--corridor={x},{y}" for x, y in (_floats(p, 2, "corridor") for p in req["corridor"])]
    if req.get("rip"):
        argv += ["--rip", *[str(x) for x in req["rip"]]]
    return argv


def nudge_argv(req: dict, project: Path) -> list[str]:
    part = req.get("part")
    if not isinstance(part, str) or not part:
        raise ValueError("nudge needs a part")
    argv = ["nudge", str(project), "--part", part]
    if req.get("by") is not None:
        dx, dy = _floats(req["by"], 2, "by")
        argv.append(f"--by={dx},{dy}")
    if req.get("rot") is not None:
        argv.append(f"--rot={float(req['rot'])}")
    if req.get("back") is True:
        argv.append("--back")
    elif req.get("back") is False:
        argv.append("--front")
    if req.get("route"):
        argv.append("--route")
    return argv


def serve_ops(server) -> dict:
    from ..serve import _project

    def op_route_net(req):
        server.start_job(req, route_net_argv(req, _project(req, "route_net")))
        return None

    def op_nudge(req):
        project = _project(req, "nudge")
        argv = nudge_argv(req, project)
        if req.get("route"):
            server.start_job(req, argv)
            return None
        by = _floats(req["by"], 2, "by") if req.get("by") is not None else (0.0, 0.0)
        t = nudge(project, req["part"], by=tuple(by), rot=req.get("rot"), back=req.get("back"))
        return {"id": req.get("id"), "ok": True, "result": t.to_dict()}

    def op_keep(req):
        net = req.get("net")
        if not isinstance(net, str) or not net:
            raise ValueError("keep needs a net")
        return {"id": req.get("id"), "ok": True, "result": keep(_project(req, "keep"), net).to_dict()}

    return {"route_net": op_route_net, "nudge": op_nudge, "keep": op_keep}
