"""The fast build: board.py to a KiCad project in .pino/build/<hash>/, checks, and a result.

Steps, in this order in `timings` whatever order they finish in:

    libraries, run board.py, hash, place, write schematic, write board,
    erc, netlist, schematic svg   (one worker)
    drc, svg, glb, render         (another worker; drc refills a copy in filled/ and checks parity)
    checks, diff

The build folder is written under a temporary name and renamed into place when complete, so a
half-written build is never seen. The engine writes only under <project>/.pino/.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from . import __version__, ids
from .checks.courtyards import courtyard_overlaps
from .checks.expect import check_expects
from .checks.fit import fit_findings
from .checks.netlist import Netlist, compare, net_names, read_netlist
from .checks.reports import drc_findings, erc_findings
from .circuit import Circuit, placement_to_json
from .diff import changes as diff_changes
from .findings import At, Finding
from .history import History
from .kicad_cli import CliRun, KicadCli
from .normalize import normalize
from .libraries import Libraries, LibrariesNotFound, discover
from .pcb.footprint import FootprintLibrary, FootprintNotFound, model_findings, pad_world, pin_pad_findings
from .pcb.writer import copper_layers, fab_of, write_board
from .placement.placer import place
from .placement.ratsnest import PadPoint, ratsnest
from .result import (SCHEMA, BuildResult, Timing, cap_changes, headline, sort_and_cap)
from .run_board import run_board
from .schematic.layout import Model
from .schematic.lint import lint
from .schematic.writer import DrawingError, write_schematic
from .sexpr import find, find_all, parse
from .symbols import SymbolLibrary

KEEP_BUILDS = 20
SVG_LAYERS_EXTRA = ["F.SilkS", "B.SilkS", "F.Mask", "B.Mask", "Edge.Cuts"]
USER_NAMES = {"F.SilkS": "F.Silkscreen", "B.SilkS": "B.Silkscreen", "F.CrtYd": "F.Courtyard", "B.CrtYd": "B.Courtyard",
              "F.Adhes": "F.Adhesive", "B.Adhes": "B.Adhesive"}
WAITING = ["routing: not started"]


@dataclass
class BuildOptions:
    timeout: float = 30.0
    render: bool = False
    kicad: bool = True
    cache: bool = True


class _Clock:
    def __init__(self):
        self.times: dict[str, Timing] = {}
        self.lock = threading.Lock()

    def run(self, step, fn, *args, **kw):
        t = time.perf_counter()
        try:
            return fn(*args, **kw)
        finally:
            with self.lock:
                self.times[step] = Timing(step, time.perf_counter() - t)


ORDER = ["libraries", "run board.py", "hash", "place", "write schematic", "write board", "erc", "netlist",
         "schematic svg", "drc", "svg", "glb", "render", "checks", "diff"]


def _rel(project: Path, path: Path) -> str:
    return path.relative_to(project).as_posix()


def _counts(findings, circuit, unrouted, crossings) -> dict[str, int]:
    return {"errors": sum(f.severity == "error" for f in findings),
            "warnings": sum(f.severity == "warning" for f in findings),
            "infos": sum(f.severity == "info" for f in findings),
            "parts": len(circuit.parts) if circuit else 0, "nets": len(circuit.nets) if circuit else 0,
            "unrouted": unrouted, "crossings": crossings}


def _failed(number, problem_text, findings, timings, kicad_version, changes=None) -> BuildResult:
    findings, truncated = sort_and_cap(findings)
    counts = _counts(findings, None, 0, 0)
    return BuildResult(SCHEMA, __version__, kicad_version, number, None, "failed",
                       headline(number, "failed", counts, problem_text), counts, findings, truncated, {},
                       timings, changes or {"circuit": [], "layout": []}, None, list(WAITING), False)


def _symbols_used(circuit: Circuit) -> list[str]:
    used = {p.symbol for p in circuit.parts} | {n.symbol for n in circuit.nets if n.kind != "signal" and n.symbol}
    if any(n.external for n in circuit.nets):
        used.add("power:PWR_FLAG")
    return sorted(used)


def _digest(circuit_json: str, kicad_version: str | None, symbols: SymbolLibrary, footprints: FootprintLibrary,
            circuit: Circuit, options: BuildOptions) -> str:
    h = hashlib.sha256()
    h.update(circuit_json.encode("utf-8"))
    h.update(f"\0kernel {__version__}\0kicad-cli {kicad_version or 'none'}\0render {options.render}\0".encode())
    for lib_id in _symbols_used(circuit):
        try:
            d = symbols.source_digest(lib_id)
        except Exception:  # noqa: BLE001 - a missing symbol shows up in the writers
            d = "missing"
        h.update(f"sym {lib_id} {d}\0".encode())
    for lib_id in sorted({p.footprint for p in circuit.parts}):
        try:
            d = footprints.source_digest(lib_id)
            # whether each 3D model is there changes the findings and the GLB
            models = [f"{m}={'yes' if footprints.model_exists(m) else 'no'}" for m in footprints.load(lib_id).models]
        except (FootprintNotFound, OSError):
            d, models = "missing", []
        h.update(f"fp {lib_id} {d} {' '.join(models)}\0".encode())
    return h.hexdigest()[:12]


def _footprint_refs(pcb_text: str) -> dict[str, str]:
    """Every uuid inside a footprint (the footprint, its pads, texts and drawings) to its reference."""
    out = {}
    for fp in find_all(parse(pcb_text), "footprint"):
        ref = next((str(p[2]) for p in find_all(fp, "property") if p[1] == "Reference"), "")

        def walk(n):
            for c in n:
                if isinstance(c, list) and c:
                    if c[0] == "uuid":
                        out[str(c[1])] = ref
                    walk(c)
        walk(fp)
    return out


def _symbol_refs(circuit: Circuit) -> dict[str, str]:
    out = {}
    for p in circuit.parts:
        out[ids.symbol_uuid(p.key)] = p.ref
        for pin in p.pins:
            out[ids.uid("pin", p.key, pin.number)] = p.ref
    return out


def _netlist_of(circuit: Circuit) -> Netlist:
    """The circuit's own nets as a netlist, for the pin checks when KiCad's export is not there."""
    return Netlist({}, {n.name: frozenset((p.ref, p.number) for p in n.pins) for n in circuit.nets})


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def _svg_files(out_dir: Path, layers: list[str]) -> dict[str, Path]:
    """kicad-cli names layer SVGs by the layer's user name; give each a plain name per layer."""
    found = {}
    for layer in layers:
        canonical = out_dir / f"board-{layer.replace('.', '_')}.svg"
        for name in (layer, USER_NAMES.get(layer, layer)):
            cand = out_dir / f"board-{name.replace('.', '_')}.svg"
            if cand.is_file():
                if cand != canonical:
                    cand.replace(canonical)
                found[layer] = canonical
                break
    return found


def _remove(path: Path) -> None:
    shutil.rmtree(path, ignore_errors=True)


def _prune(history: History, build_dir: Path, keep: int, current: str | None, previous: str | None) -> None:
    keep_set = set(history.recent_hashes(keep)) | {h for h in (current, previous) if h}
    if not build_dir.is_dir():
        return
    for d in sorted(build_dir.iterdir()):
        if d.is_dir() and ".tmp-" not in d.name and ".old-" not in d.name and d.name not in keep_set:
            _remove(d)


def build(project: Path, options: BuildOptions = BuildOptions()) -> BuildResult:
    project = Path(project).resolve()
    dot = project / ".pino"
    build_dir = dot / "build"
    history = History(project)
    number = history.next_number()
    clock = _Clock()

    def timings():
        return [clock.times[s] for s in ORDER if s in clock.times]

    # -- libraries
    try:
        libs: Libraries = clock.run("libraries", discover)
    except LibrariesNotFound as e:
        f = Finding("kernel", "libraries_not_found", "error", str(e))
        result = _failed(number, "KiCad's libraries were not found", [f], timings(), None)
        history.record(number, None, "failed")
        return result

    cli_argv = KicadCli.find() if options.kicad else None
    cli = KicadCli(libs, dot / "kicad", cli_argv) if cli_argv else None
    kicad_version = cli.version() if cli else None
    if cli and not kicad_version:
        cli, kicad_version = None, None

    # -- run board.py
    run = clock.run("run board.py", run_board, project, libraries=libs, timeout=options.timeout)
    if run.circuit is None:
        findings = [Finding("board.py", "board_py", "error", p.message,
                            At("source", file=p.file or "board.py", line=p.line)) for p in run.problems]
        first = run.problems[0] if run.problems else None
        where = f" at line {first.line}" if first and first.line else ""
        text = f"board.py failed{where}: {first.message}" if first else "board.py failed"
        result = _failed(number, text, findings, timings(), kicad_version)
        history.record(number, None, "failed")
        return result
    circuit = run.circuit
    circuit_json = circuit.to_json()

    symbols = SymbolLibrary(libs.symbols)
    footprints = FootprintLibrary(libs)

    # -- hash and cache
    digest = clock.run("hash", _digest, circuit_json, kicad_version, symbols, footprints, circuit, options)
    final = build_dir / digest
    prev = history.previous(digest)
    prev_pcb = None
    if prev:
        p = build_dir / prev["hash"] / "board.kicad_pcb"
        prev_pcb = p.read_text(encoding="utf-8") if p.is_file() else None
    cached_file = final / "result.json"
    if options.cache and cached_file.is_file():
        try:
            stored = BuildResult.from_json(cached_file.read_text(encoding="utf-8"))
        except (ValueError, KeyError, json.JSONDecodeError):
            stored = None
        if stored is not None:
            pcb = (final / "board.kicad_pcb").read_text(encoding="utf-8") if (final / "board.kicad_pcb").is_file() else ""
            stored.number = number
            stored.cached = True
            stored.changes = cap_changes(diff_changes(prev_pcb, pcb)) if pcb else stored.changes
            stored.headline = headline(number, stored.verdict, stored.counts, None if stored.verdict != "failed" else
                                       stored.headline.split(": ", 1)[-1])
            fresh = timings()
            stored.timings = fresh + [Timing(t.step, t.seconds, True) for t in stored.timings
                                      if t.step not in {f.step for f in fresh}]
            history.record(number, digest, stored.verdict)
            return stored

    tmp = build_dir / f"{digest}.tmp-{os.getpid()}-{threading.get_ident()}"
    _remove(tmp)
    tmp.mkdir(parents=True)
    try:
        return _build_into(project, tmp, final, digest, number, circuit, circuit_json, libs, symbols, footprints,
                           cli, kicad_version, options, clock, timings, history, prev, prev_pcb, run.log)
    finally:
        _remove(tmp)


def _build_into(project, tmp, final, digest, number, circuit, circuit_json, libs, symbols, footprints, cli,
                kicad_version, options, clock, timings, history, prev, prev_pcb, log) -> BuildResult:
    findings: list[Finding] = []

    def fail(text, more):
        result = _failed(number, text, more, timings(), kicad_version)
        history.record(number, digest, "failed")
        return result

    # -- place
    try:
        placed_result = clock.run("place", place, circuit, footprints)
    except FootprintNotFound as e:
        return fail(f"a footprint was not found: {e}", [Finding("kernel", "footprint_not_found", "error", str(e))])
    findings += placed_result.findings

    # -- write schematic
    try:
        sch = clock.run("write schematic", write_schematic, circuit, symbols)
    except DrawingError as e:
        return fail("the schematic writer refused a drawing", [
            Finding("kernel", "drawing_error", "error", f"the schematic layout would short nets: {e}")])

    # -- write board
    def write_files():
        pads = pin_pad_findings(circuit, footprints)
        files = write_board(circuit, placed_result.placement, footprints)
        _write(tmp / "circuit.json", circuit_json)
        nets: dict[str, list] = {}
        for p in files.placed:
            for q in pad_world(p):
                if q.net:
                    side = "X" if q.through else ("B" if p.back else "F")
                    nets.setdefault(q.net, []).append(PadPoint(q.x, q.y, side, p.ref, q.number))
        planes = {n.name for n in circuit.nets if n.kind == "gnd"} | {z.net for z in circuit.zones}
        edges = [[e[0], list(e[1]), list(e[2]), e[3]] for e in ratsnest(nets, planes)]
        placement_doc = {"poses": json.loads(placement_to_json(placed_result.placement)), "edges": edges}
        _write(tmp / "placement.json", json.dumps(placement_doc, indent=1, sort_keys=True) + "\n")
        _write(tmp / "sheet.json", json.dumps(sch.sheet, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
        _write(tmp / "board.kicad_sch", sch.kicad_sch)
        _write(tmp / "sym-lib-table", sch.sym_lib_table)
        _write(tmp / "fp-lib-table", sch.fp_lib_table)
        _write(tmp / "board.kicad_pcb", files.kicad_pcb)
        _write(tmp / "board.kicad_pro", files.kicad_pro)
        _write(tmp / "board.kicad_dru", files.kicad_dru)
        return pads, files

    try:
        pad_found, files = clock.run("write board", write_files)
    except FootprintNotFound as e:
        return fail(f"a footprint was not found: {e}", [Finding("kernel", "footprint_not_found", "error", str(e))])
    findings += pad_found

    # -- kicad-cli, two workers
    runs: dict[str, CliRun] = {}
    cu = [name for _, name in copper_layers(circuit.layers)]
    svg_layers = cu + SVG_LAYERS_EXTRA
    svg_found: dict[str, Path] = {}

    def schematic_worker():
        runs["erc"] = clock.run("erc", cli.erc, tmp / "board.kicad_sch", tmp / "erc.json")
        runs["netlist"] = clock.run("netlist", cli.netlist, tmp / "board.kicad_sch", tmp / "netlist.xml")
        out = tmp / "schematic-svg"
        runs["schematic svg"] = clock.run("schematic svg", cli.sch_svg, tmp / "board.kicad_sch", out)
        made = sorted(out.glob("*.svg")) if out.is_dir() else []
        if made:
            made[0].replace(tmp / "schematic.svg")
        _remove(out)
        for name in ("erc.json", "netlist.xml", "schematic.svg"):
            normalize(tmp / name)

    def board_worker():
        filled = tmp / "filled"
        filled.mkdir(exist_ok=True)
        for name in ("board.kicad_pcb", "board.kicad_pro", "board.kicad_dru", "board.kicad_sch", "sym-lib-table",
                     "fp-lib-table"):
            shutil.copy(tmp / name, filled / name)
        runs["drc"] = clock.run("drc", cli.drc, filled / "board.kicad_pcb", tmp / "drc.json", refill=True, save=True,
                                parity=True)
        board_file = filled / "board.kicad_pcb"
        runs["svg"] = clock.run("svg", cli.pcb_svg, board_file, tmp / "svg", svg_layers)
        svg_found.update(_svg_files(tmp / "svg", svg_layers))
        runs["glb"] = clock.run("glb", cli.glb, board_file, tmp / "board.glb")
        if options.render:
            runs["render"] = clock.run("render", cli.render, board_file, tmp / "render-top.png")
        for extra in filled.glob("*.kicad_prl"):
            extra.unlink()
        for f in [tmp / "drc.json", tmp / "board.glb", *svg_found.values()]:
            normalize(f)

    if cli is not None:
        with ThreadPoolExecutor(2) as ex:
            for fut in [ex.submit(schematic_worker), ex.submit(board_worker)]:
                fut.result()
        for step in ORDER:
            r = runs.get(step)
            if r is not None and not r.ok:
                findings.append(Finding("kernel", "kicad_cli_failed", "error",
                                        f"kicad-cli {step} failed: {r.last_line() or f'exit code {r.returncode}'}"))
    elif options.kicad:
        findings.append(Finding("kernel", "kicad_cli_missing", "warning",
                                "kicad-cli not found, so ERC, the KiCad netlist check, DRC with zone fill, "
                                "the layer pictures and the 3D model were skipped. Install KiCad 10, or set PINO_KICAD_CLI."))

    # -- checks
    unrouted = 0

    def checks():
        nonlocal unrouted
        out: list[Finding] = []
        pads = {(p.ref, q.number): (q.x, q.y) for p in files.placed for q in pad_world(p)}
        netlist = None
        if (tmp / "netlist.xml").is_file():
            try:
                netlist = read_netlist(tmp / "netlist.xml")
            except Exception as e:  # noqa: BLE001
                out.append(Finding("kernel", "netlist_unreadable", "error", f"KiCad's netlist could not be read: {e}"))
        if netlist is not None:
            out += compare(circuit, netlist) + net_names(circuit, netlist)
        out += check_expects(circuit, netlist or _netlist_of(circuit), pads)
        if (tmp / "erc.json").is_file():
            out += erc_findings(json.loads((tmp / "erc.json").read_text(encoding="utf-8")), _symbol_refs(circuit))
        if (tmp / "drc.json").is_file():
            found, unrouted = drc_findings(json.loads((tmp / "drc.json").read_text(encoding="utf-8")),
                                           _footprint_refs(files.kicad_pcb))
            out += found
        out += courtyard_overlaps(files.placed)
        out += fit_findings(circuit, files.placed, fab_of(circuit))
        out += model_findings(files.placed, footprints)
        out += lint(sch.canvas, circuit, symbols)
        for ref, numbers in circuit.nc_rest.items():
            part = circuit.part(ref)
            names = {p.number: p.name for p in part.pins}
            listed = ", ".join(f"{n} ({names.get(n, '?')})" for n in numbers)
            out.append(Finding("board.py", "nc_rest", "info",
                               f"{ref}: {len(numbers)} pin{'s' if len(numbers) != 1 else ''} left open by nc_rest: {listed}",
                               At("source", file="board.py", line=part.line), refs=(ref,)))
        return out

    findings += clock.run("checks", checks)
    changes = clock.run("diff", lambda: cap_changes(diff_changes(prev_pcb, files.kicad_pcb)))

    kept, truncated = sort_and_cap(findings)
    counts = _counts(findings, circuit, unrouted, placed_result.score.crossings)
    verdict = "errors" if counts["errors"] else "ok"

    rel = lambda name: _rel(project, final / name)
    artifacts = {}
    for key, name in (("circuit", "circuit.json"), ("placement", "placement.json"), ("schematic", "board.kicad_sch"),
                      ("board", "board.kicad_pcb"), ("project", "board.kicad_pro"), ("rules", "board.kicad_dru"),
                      ("sym_lib_table", "sym-lib-table"), ("fp_lib_table", "fp-lib-table"),
                      ("filled", "filled/board.kicad_pcb"), ("erc", "erc.json"), ("netlist", "netlist.xml"),
                      ("drc", "drc.json"), ("schematic_svg", "schematic.svg"), ("sheet", "sheet.json"),
                      ("glb", "board.glb"),
                      ("render", "render-top.png")):
        if (tmp / name).is_file():
            artifacts[key] = rel(name)
    if svg_found:
        artifacts["svg"] = {layer: rel(f"svg/{path.name}") for layer, path in sorted(svg_found.items())}
    score = placed_result.score
    result = BuildResult(SCHEMA, __version__, kicad_version, number, digest, verdict,
                         headline(number, verdict, counts, None), counts, kept, truncated, artifacts, timings(), changes,
                         {"score": round(score.total, 3), "crossings": score.crossings, "length_mm": round(score.length, 3)},
                         list(WAITING), False)
    _write(tmp / "result.json", result.to_json())
    history.mark(number, digest)

    # -- into place: rename the finished folder; if another build of the same input won, use that one
    if final.exists():
        if options.cache:
            _remove(tmp)
        else:
            old = final.with_name(f"{final.name}.old-{os.getpid()}-{threading.get_ident()}")
            try:
                final.replace(old)
                tmp.replace(final)
            except OSError:
                pass
            _remove(old)
    else:
        try:
            tmp.replace(final)
        except OSError:
            _remove(tmp)
    history.record(number, digest, verdict)
    _prune(history, final.parent, KEEP_BUILDS, digest, prev["hash"] if prev else None)
    return result
