"""The release job: a routed, clean build into fab/v<version>/.

    gates     the newest build is finished, current with board.py and error free; its route is current, complete,
              DRC and copper clean; and the board fits JLC's economic or standard assembly
    parts     stock asked again; a part without a number, or an extended part without why=, is an error here
    gerbers   the newest build's board with the route's copper, refilled and checked (DRC with parity), exported
    bom, cpl  JLC's two assembly files
    version   1.0.0 first, minor for a circuit change, patch otherwise; the same files make nothing
    write     the folder, written beside its name and renamed into it

The export board is the newest build's own board plus the route's copper: values, DNP flags and silkscreen are not
part of the route key, so the routed board file may be older than the BOM and CPL. Nothing is written outside
<project>/.pino/ and a new <project>/fab/v<version>/, and a folder that is there is never touched.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import shutil
import sys
import threading
import time
import traceback
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Callable

from .. import __version__
from ..build import _footprint_refs, sources_digest
from ..checks.parts import assembled, lcsc_of, parts_findings
from ..checks.reports import drc_findings
from ..circuit import Circuit, placement_from_json
from ..fab import PROFILES, FabProfile
from ..findings import At, Finding
from ..history import History
from ..kicad_cli import KicadCli
from ..libraries import LibrariesNotFound, discover
from ..parts.cache import PartsCache, parts_root
from ..parts.jlcsearch import Jlcsearch, PartLookup
from ..parts.transport import OfflineError, transport_from_env
from ..pcb.copper import copper_nodes, merge_copper, rewrite_uuids
from ..pcb.writer import fab_of
from ..result import BuildResult, Timing, plural
from ..routing.result import RouteResult
from ..routing.state import build_routing, route_running
from .gerbers import ExportError, export, slug, zip_bytes
from .jlc import CplRow, board_parts, bom_rows, cpl_rows, write_bom, write_cpl
from .readme import readme
from .result import RELEASE_SCHEMA, ReleaseResult, empty_counts, order_and_cap
from .rotations import load_rules
from .versions import (BUMPS, FAB_SCHEMA, circuit_changes, circuit_fingerprint, circuit_summary, fab_fingerprint,
                       manifests, next_version)

REFRESH_BUDGET = 20.0  # seconds to ask jlcsearch again about every part
STANDARD_MIN_BOARD = (70.0, 70.0)  # JLC's standard (two-sided) assembly
STEPS = ("gates", "parts", "gerbers", "bom", "cpl", "version", "write")
# build files the export board's DRC needs beside it
_PROJECT_FILES = ("board.kicad_pro", "board.kicad_dru", "board.kicad_sch", "sym-lib-table", "fp-lib-table")
_LEFTOVER = re.compile(r"^v\d+\.\d+\.\d+\.tmp-\d+$")
# gate errors whose headline says what to do
_SAY = {
    "release_no_build": "build the board first: save board.py",
    "release_build_failed": "board.py's last build failed: fix it first",
    "release_build_stale": "board.py or a file it reads changed since the last build: build again",
    "release_build_unchecked": "the last build ran without kicad-cli, so ERC and DRC never ran",
    "release_not_routed": "route the board first",
    "release_routing": "a route is running: wait for it to finish",
}


@dataclass
class ReleaseOptions:
    bump: str | None = None
    dry_run: bool = False
    network: bool = True


@dataclass
class Readiness:
    ready: bool
    build: dict | None = None
    route: dict | None = None
    blockers: list[Finding] = field(default_factory=list)
    warnings: list[Finding] = field(default_factory=list)
    next_version: str | None = None
    bump: str | None = None
    why: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {"ready": self.ready, "build": self.build, "route": self.route,
                "blockers": [f.to_json() for f in self.blockers], "warnings": [f.to_json() for f in self.warnings],
                "next_version": self.next_version, "bump": self.bump, "why": list(self.why)}


@dataclass
class _Board:
    """What the gates found: the newest build and its route, as far as they exist."""

    build: dict | None = None  # {number, hash}
    route: dict | None = None  # {number, key}
    folder: Path | None = None
    result: BuildResult | None = None
    circuit: Circuit | None = None
    poses: dict = field(default_factory=dict)
    route_folder: Path | None = None


def _gate(code: str, message: str, severity: str = "error", **kw) -> Finding:
    return Finding("release", code, severity, message, **kw)


def outline_size(circuit: Circuit) -> tuple[float, float]:
    return circuit.outline.width, circuit.outline.height


def _newest_entry(project: Path) -> dict | None:
    return next((b for b in reversed(History(project).entries()) if b.get("verdict") != "running"), None)


def _build_gates(project: Path, board: _Board) -> list[Finding]:
    entry = _newest_entry(project) if (project / ".pino" / "builds.json").is_file() else None
    if entry is None:
        return [_gate("release_no_build", "there is no build yet: save board.py first")]
    if entry.get("verdict") == "failed" or not entry.get("hash"):
        return [_gate("release_build_failed", f"build h{entry.get('number')} failed: fix board.py and build again")]
    folder = project / ".pino" / "build" / entry["hash"]
    try:
        board.result = BuildResult.from_json((folder / "result.json").read_text(encoding="utf-8"))
        board.circuit = Circuit.from_json((folder / "circuit.json").read_text(encoding="utf-8"))
        poses = json.loads((folder / "placement.json").read_text(encoding="utf-8"))["poses"]
        board.poses = placement_from_json(json.dumps(poses))
    except (OSError, ValueError, KeyError):
        return [_gate("release_no_build", f"build h{entry.get('number')} cannot be read: build again")]
    board.folder = folder
    board.build = {"number": entry.get("number"), "hash": entry["hash"]}
    out = []
    if entry.get("sources") != sources_digest(project):
        out.append(_gate("release_build_stale", f"board.py or a file it reads changed since build "
                                                f"h{entry.get('number')}: build again"))
    if board.result.kicad_cli is None:
        out.append(_gate("release_build_unchecked", f"build h{entry.get('number')} ran without kicad-cli, so ERC and "
                                                    "DRC never ran: install KiCad 10 and build again"))
    errors = [f for f in board.result.findings if f.severity == "error"]
    if errors:
        count = board.result.counts.get("errors", len(errors))
        out.append(_gate("release_build_errors", f"build h{entry.get('number')} has {plural(count, 'error')}: "
                                                 f"{errors[0].message}", at=errors[0].at, refs=errors[0].refs))
    return out


def _route_gates(project: Path, board: _Board) -> list[Finding]:
    if board.folder is None:
        return []
    running = [_gate("release_routing", "a route is running: release when it is done")] if route_running(project) \
        else []
    routing = build_routing(project, board.folder)
    if routing is None or routing["state"] == "none":
        return running or [_gate("release_not_routed", "the board is not routed: route it first")]
    if routing["state"] == "running":
        return running or [_gate("release_routing", "a route is running: release when it is done")]
    if routing["state"] == "stale":
        why = ", ".join(routing["stale_because"])
        return running + [_gate("release_stale", f"copper is stale ({why}): route again")]
    folder = project / routing["route"]
    try:
        result = RouteResult.from_json((folder / "route.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError):
        return running + [_gate("release_not_routed", "the route cannot be read: route again")]
    board.route = {"number": routing["number"], "key": routing["route_key"]}
    board.route_folder = folder
    out = list(running)
    if not result.complete or result.counts.get("unrouted"):
        nets = sorted({n for f in result.findings if f.code == "net_unrouted" for n in f.nets})
        left = ", ".join(nets) if nets else plural(result.counts.get("unrouted", 0), "connection")
        out.append(_gate("release_incomplete", f"the route left nets unrouted ({left})", nets=tuple(nets)))
    bad = result.counts.get("drc_errors", 0) + result.counts.get("copper_errors", 0)
    if bad:
        first = next((f for f in result.findings if f.severity == "error" and f.source in ("drc", "copper")), None)
        out.append(_gate("release_drc", f"the routed board has {plural(bad, 'DRC or copper error')}"
                                        f"{': ' + first.message if first else ''}", at=first.at if first else None))
    return out


def _assembly_gates(circuit: Circuit, profile: FabProfile) -> list[Finding]:
    out = []
    assembly = profile.assembly
    placed = [p for p in circuit.parts if assembled(p)]
    width, height = outline_size(circuit)
    short, long = sorted((width, height))
    least, most = sorted(assembly.min_board), sorted(assembly.max_board)
    if placed and not (short >= least[0] and long >= least[1] and short <= most[0] and long <= most[1]):
        out.append(_gate("assembly_board_size",
                         f"the board is {width:g} x {height:g} mm: JLC assembles boards from {assembly.min_board[0]:g} "
                         f"x {assembly.min_board[1]:g} to {assembly.max_board[0]:g} x {assembly.max_board[1]:g} mm"))
    low, high = assembly.thickness
    if placed and not low <= profile.board_thickness <= high:
        out.append(_gate("assembly_thickness", f"economic assembly takes boards {low:g} to {high:g} mm thick; this "
                                               f"one is {profile.board_thickness:g} mm", "warning"))
    return out


def _sides_gate(circuit: Circuit, poses: dict) -> list[Finding]:
    sides = {bool(poses[p.ref].back) for p in circuit.parts if assembled(p) and p.ref in poses}
    if len(sides) < 2:
        return []
    return [_gate("assembly_two_sides",
                  f"parts to assemble sit on both sides, so JLC needs standard assembly, which takes boards of at "
                  f"least {STANDARD_MIN_BOARD[0]:g} x {STANDARD_MIN_BOARD[1]:g} mm", "warning")]


def _no_lookups(url: str, timeout: float):
    raise OfflineError("offline: release was asked not to look parts up")


def _lookups(circuit: Circuit, network: bool) -> dict[str, PartLookup]:
    numbers = [n for n in (lcsc_of(p) for p in circuit.parts if assembled(p)) if n]
    client = Jlcsearch(transport_from_env() if network else _no_lookups, PartsCache(parts_root()))
    if not network:
        return client.parts(numbers, budget=2.0)
    return client.parts(numbers, budget=REFRESH_BUDGET, max_age=timedelta(0))


def _part_gates(circuit: Circuit, poses: dict, lookups: dict[str, PartLookup]) -> list[Finding]:
    """The parts checks as release sees them: strict, and stock that cannot be confirmed is always said."""
    out = []
    for f in parts_findings(circuit, poses, lookups, strict=True):
        if f.code == "part_stock_unknown":
            f = Finding(f.source, f.code, "warning", f.message, f.at, f.refs)
        if f.severity in ("error", "warning"):
            out.append(Finding("release", f.code, f.severity, f.message, f.at, f.refs))
    return out


def _rotation_infos(rows: list[CplRow], poses: dict) -> list[Finding]:
    out = []
    for r in rows:
        if not r.needs_check:
            continue
        if r.override:
            why = "its rotation comes from board.py"
        elif r.rule is None:
            why = "pino has no rule for its footprint"
        else:
            why = "its rule was never checked there"
        pose = poses.get(r.ref)
        at = At("board", pose.x, pose.y, "B.Cu" if pose.back else "F.Cu") if pose else None
        out.append(_gate("rotation_unchecked", f"Check {r.ref}'s rotation in JLC's preview: {why}", "info", at=at,
                         refs=(r.ref,)))
    return out


def _last_release(project: Path, board: _Board) -> tuple[str | None, str | None, list[str]]:
    """What a release would be called, without exporting: the same build and route as the newest release's make the
    same files."""
    found = manifests(project)
    last = found[0] if found else None
    if last and last.get("build", {}).get("hash") == board.build["hash"] \
            and last.get("route", {}).get("key") == board.route["key"]:
        return None, None, [f"the same files as v{last['version']}"]
    summary = circuit_summary(board.circuit)
    circuit_fp = circuit_fingerprint(summary)
    changes = circuit_changes(last["circuit"], summary) if last and "circuit" in last else None
    return next_version(last, circuit_fp, "not exported yet", None, changes=changes)


def readiness(project: Path, *, network: bool = False) -> Readiness:
    """Whether a release would go through, as far as can be told without exporting."""
    project = Path(project).resolve()
    board = _Board()
    found = _build_gates(project, board) + _route_gates(project, board)
    if board.circuit is not None:
        found += _assembly_gates(board.circuit, fab_of(board.circuit)) + _sides_gate(board.circuit, board.poses)
        found += _part_gates(board.circuit, board.poses, _lookups(board.circuit, network))
    kept, _ = order_and_cap(found)
    blockers = [f for f in kept if f.severity == "error"]
    out = Readiness(not blockers, board.build, board.route, blockers, [f for f in kept if f.severity == "warning"])
    if not blockers:
        out.next_version, out.bump, out.why = _last_release(project, board)
    return out


def _refusal(errors: list[Finding]) -> str:
    first = errors[0]
    if first.code in _SAY:
        return f"Release refused: {_SAY[first.code]}"
    if first.code == "release_stale":
        return f"Release refused: {first.message}"
    if first.code in ("release_incomplete", "release_drc"):
        return f"Release refused: {first.message}"
    short = ", ".join(f.message.split(":")[0] for f in errors[:3])
    return f"Release refused: {plural(len(errors), 'error')} ({short}{', ...' if len(errors) > 3 else ''})"


class _Cancelled(Exception):
    pass


class _Failed(Exception):
    pass


class _Refused(Exception):
    def __init__(self, found: list[Finding]):
        self.found = found


class _Steps:
    def __init__(self, events: Callable[[dict], None], cancel: threading.Event):
        self.events, self.cancel = events, cancel
        self.times: list[Timing] = []

    def run(self, step: str, fn, *args):
        self.check()
        self.events({"event": "step", "step": step})
        started = time.perf_counter()
        try:
            return fn(*args)
        finally:
            self.times.append(Timing(step, time.perf_counter() - started))

    def check(self) -> None:
        if self.cancel.is_set():
            raise _Cancelled


def release_project(project: Path, options: ReleaseOptions = ReleaseOptions(),
                    events: Callable[[dict], None] = lambda e: None,
                    cancel: threading.Event | None = None) -> ReleaseResult:
    project = Path(project).resolve()
    if options.bump is not None and options.bump not in BUMPS:
        raise ValueError("a version bump is patch, minor or major")
    dot = project / ".pino"
    dot.mkdir(parents=True, exist_ok=True)
    with open(dot / "release.lock", "a+") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return ReleaseResult(RELEASE_SCHEMA, __version__, "busy",
                                 headline="Release: a release is already running for this project")
        try:
            return _release_locked(project, options, _Steps(events, cancel or threading.Event()))
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def _release_locked(project: Path, options: ReleaseOptions, steps: _Steps) -> ReleaseResult:
    result = ReleaseResult(RELEASE_SCHEMA, __version__, "failed", timings=steps.times)
    found: list[Finding] = []
    work = project / ".pino" / "release" / f"work-{os.getpid()}-{threading.get_ident()}"
    # we hold the release lock: a work folder or a half-written fab folder left now is from a killed release
    shutil.rmtree(work.parent, ignore_errors=True)
    for stale in (project / "fab").glob("v*.tmp-*") if _own_fab(project) else ():
        if _LEFTOVER.match(stale.name):
            shutil.rmtree(stale, ignore_errors=True)
    try:
        _release(project, options, steps, work, result, found)
    except _Cancelled:
        result.state, result.headline = "cancelled", "Release cancelled: nothing was written"
    except _Refused as e:
        found = e.found
        result.state = "refused"
        result.headline = _refusal([f for f in order_and_cap(found)[0] if f.severity == "error"])
    except (_Failed, ExportError) as e:
        result.state, result.headline = "failed", f"Release failed: {e}"
        found.append(_gate("release_failed", str(e)))
    except Exception as e:  # noqa: BLE001 - an engine fault is a failed release in words, never a traceback
        traceback.print_exc(file=sys.stderr)
        result.state, result.headline = "failed", "Release failed inside the engine"
        found.append(Finding("kernel", "internal_error", "error", f"{type(e).__name__}: {e}"))
    finally:
        shutil.rmtree(work.parent, ignore_errors=True)
    result.findings, result.truncated = order_and_cap(found)
    if result.state != "released":
        result.version, result.folder, result.files = None, None, []
    return result


def _own_fab(project: Path) -> bool:
    return not (project / "fab").is_symlink()


def _export_board(project: Path, board: _Board, work: Path, stem: str, steps: _Steps,
                  found: list[Finding]) -> tuple[dict[str, bytes], str]:
    """(the Gerbers and drill files, the export board's text)."""
    try:
        libs = discover()
    except LibrariesNotFound as e:
        raise _Failed(str(e)) from None
    argv = KicadCli.find()
    if not argv:
        raise _Failed("kicad-cli not found: install KiCad 10 or set PINO_KICAD_CLI")
    kicad = KicadCli(libs, project / ".pino" / "kicad", argv)
    build_text = (board.folder / "board.kicad_pcb").read_text(encoding="utf-8")
    routed = (board.route_folder / "board.kicad_pcb").read_text(encoding="utf-8")
    merged = merge_copper(build_text, rewrite_uuids(copper_nodes(routed)))
    drc = work / "drc"
    drc.mkdir(parents=True)
    for name in _PROJECT_FILES:
        if (board.folder / name).is_file():
            shutil.copy(board.folder / name, drc / name)
    (drc / "board.kicad_pcb").write_text(merged, encoding="utf-8")
    run = kicad.drc(drc / "board.kicad_pcb", work / "drc.json", refill=True, save=True, parity=True,
                    cancel=steps.cancel)
    steps.check()
    if not run.ok or not (work / "drc.json").is_file():
        raise _Failed(f"kicad-cli DRC failed: {run.last_line() or f'exit code {run.returncode}'}")
    report = json.loads((work / "drc.json").read_text(encoding="utf-8"))
    checked, unrouted = drc_findings(report, _footprint_refs(merged))
    errors = [f for f in checked if f.severity == "error"]
    if errors or unrouted:
        what = errors[0].message if errors else f"{plural(unrouted, 'connection')} not routed"
        raise _Refused(found + [_gate("release_drc", f"the board to export has DRC errors: {what}",
                                      at=errors[0].at if errors else None)])
    filled = (drc / "board.kicad_pcb").read_text(encoding="utf-8")
    plot = work / "plot"
    plot.mkdir()
    (plot / f"{stem}.kicad_pcb").write_text(filled, encoding="utf-8")
    for suffix in ("kicad_pro", "kicad_dru"):
        if (drc / f"board.{suffix}").is_file():
            shutil.copy(drc / f"board.{suffix}", plot / f"{stem}.{suffix}")
    files = export(kicad, plot, stem, board.circuit.layers, cancel=steps.cancel)
    steps.check()
    return files, filled


def _release(project: Path, options: ReleaseOptions, steps: _Steps, work: Path, result: ReleaseResult,
             found: list[Finding]) -> None:
    board = _Board()

    def gates():
        out = _build_gates(project, board) + _route_gates(project, board)
        if board.circuit is not None:
            profile = fab_of(board.circuit)
            out += _assembly_gates(board.circuit, profile) + _sides_gate(board.circuit, board.poses)
        return out

    found += steps.run("gates", gates)
    result.build, result.route = board.build, board.route
    lookups: dict[str, PartLookup] = {}

    def parts():
        if board.circuit is None:
            return []
        lookups.update(_lookups(board.circuit, options.network))
        return _part_gates(board.circuit, board.poses, lookups)

    found += steps.run("parts", parts)
    if any(f.severity == "error" for f in found):
        raise _Refused(found)
    circuit = board.circuit
    stem = slug(circuit.name)
    gerbers, board_text = steps.run("gerbers", _export_board, project, board, work, stem, steps, found)

    def make_bom():  # a BOM line counts the parts the CPL places, so the rows come first
        rows = cpl_rows(board_parts(board_text), circuit, load_rules())
        lines = bom_rows(rows, circuit)
        return rows, lines, write_bom(lines).encode("utf-8")

    rows, lines, bom = steps.run("bom", make_bom)
    cpl = steps.run("cpl", lambda: write_cpl(rows).encode("utf-8"))
    found += _rotation_infos(rows, board.poses)
    result.counts = _counts(circuit, rows, lines, lookups, gerbers)

    def version():
        releases = manifests(project)
        last = releases[0] if releases else None
        summary = circuit_summary(circuit)
        circuit_fp = circuit_fingerprint(summary)
        fab_fp = fab_fingerprint({**{f"gerbers/{n}": d for n, d in gerbers.items()}, "bom.csv": bom, "cpl.csv": cpl})
        changes = circuit_changes(last["circuit"], summary) if last and "circuit" in last else None
        number, part, why = next_version(last, circuit_fp, fab_fp, options.bump, changes=changes)
        return last, summary, circuit_fp, fab_fp, number, part, why

    last, summary, circuit_fp, fab_fp, number, part, why = steps.run("version", version)
    result.previous, result.bump, result.why = last["version"] if last else None, part, why
    if number is None:
        result.state = "unchanged"
        result.headline = f"Nothing to release: h{board.build['number']} makes the same files as v{last['version']}"
        return
    result.version = number
    manifest = {"schema": FAB_SCHEMA, "version": number, "previous": result.previous, "bump": part, "why": why,
                "board": circuit.name, "slug": stem, "profile": fab_of(circuit).name, "build": board.build,
                "route": board.route, "kernel": __version__, "kicad_cli": board.result.kicad_cli,
                "circuit": summary, "circuit_fingerprint": circuit_fp, "fab_fingerprint": fab_fp}
    stem_v = f"{stem}-v{number}"
    contents = {f"{stem_v}-gerbers.zip": zip_bytes(gerbers), f"{stem_v}-bom.csv": bom, f"{stem_v}-cpl.csv": cpl,
                **{f"gerbers/{name}": data for name, data in gerbers.items()}}
    contents["README.md"] = readme(manifest, rows, circuit, lookups, PROFILES[manifest["profile"]]).encode("utf-8")
    result.folder = f"fab/v{number}"
    result.files = steps.run("write", _write, project, number, manifest, contents)
    result.state = "released"
    hand = f", {result.counts['hand_fit']} by hand" if result.counts["hand_fit"] else ""
    result.headline = (f"Release v{number} (h{board.build['number']}, r{board.route['number']}): JLC places "
                       f"{plural(len(rows), 'part')} in {plural(len(lines), 'BOM line')}{hand}: fab/v{number}/")


def _counts(circuit: Circuit, rows, lines, lookups, gerbers) -> dict[str, int]:
    counts = empty_counts()
    counts["assembled"], counts["bom_lines"] = len(rows), len(lines)
    counts["hand_fit"] = sum(p.hand_fit and not p.dnp for p in circuit.parts)
    counts["dnp"] = sum(p.dnp for p in circuit.parts)
    for line in lines:  # part types, as JLC prices them
        info = lookups[line.lcsc].info if line.lcsc in lookups else None
        if info:
            counts[info.klass] += 1
    counts["drills"] = sum(name.endswith(".drl") for name in gerbers)
    counts["gerbers"] = len(gerbers) - counts["drills"]
    return counts


def _entry(relative: str, data: bytes) -> dict:
    return {"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _write(project: Path, number: str, manifest: dict, contents: dict[str, bytes]) -> list[dict]:
    """The folder, whole or not at all, and never over anything that is there."""
    fab = project / "fab"
    if not _own_fab(project):
        raise _Failed("fab is a link: pino writes only inside the project")
    final = fab / f"v{number}"
    taken = f"fab/v{number} is already there: pino never writes over a release"
    if os.path.lexists(final):
        raise _Failed(taken)
    files = [_entry(f"fab/v{number}/{name}", contents[name]) for name in sorted(contents)]
    text = json.dumps({**manifest, "files": files}, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    made_fab = not fab.exists()
    tmp = fab / f"v{number}.tmp-{os.getpid()}"
    try:
        (tmp / "gerbers").mkdir(parents=True)
        for name, data in {**contents, "manifest.json": text.encode("utf-8")}.items():
            (tmp / name).write_bytes(data)
        try:
            final.mkdir()  # claims the name: it fails if anything took it since the check
        except FileExistsError:
            raise _Failed(taken) from None
        os.rename(tmp, final)  # onto the empty folder just made
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        if made_fab and fab.is_dir() and not any(fab.iterdir()):
            fab.rmdir()
    return files + [_entry(f"fab/v{number}/manifest.json", text.encode("utf-8"))]
