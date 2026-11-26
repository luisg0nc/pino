"""A route asked for after a change that only moved labels keeps the copper of the newest route: no router, the copper
put on the new board, the zones filled, DRC run again and the model exported, stored as a route of its own."""

import hashlib
import json
import shutil
import threading
import time
from pathlib import Path

import jsonschema
import pytest

from helpers import SMALL_BOARD_PY, small_board_py
from pino_kernel.build import BuildOptions, build
from pino_kernel.pcb.copper import read_copper
from pino_kernel.routing.history import RouteHistory
from pino_kernel.routing.job import RouteOptions, latest_build, route_project
from pino_kernel.routing.state import build_routing
from pino_kernel.sexpr import dump, find_all, parse

KERNEL = Path(__file__).resolve().parents[1]
ROUTE_SCHEMA = json.loads((KERNEL / "schema" / "route-result-1.schema.json").read_text())
LABELLED = SMALL_BOARD_PY + 'b.label(r1, side="left")\n'


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def folder_digests(folder: Path) -> dict[str, str]:
    return {str(p.relative_to(folder)): digest(p) for p in sorted(folder.rglob("*")) if p.is_file()}


def rebuild(project: Path, text: str) -> None:
    (project / "board.py").write_text(text, encoding="utf-8")
    assert build(project, BuildOptions(kicad=True)).verdict != "failed"


def references(path: Path) -> dict[str, str]:
    return {str(p[2]): dump(p) for fp in find_all(parse(path.read_text()), "footprint")
            for p in find_all(fp, "property") if p[1] == "Reference"}


def router_calls(argv_log) -> int:
    return len([c for c in argv_log() if c["script"] != "startup_checks.py"])


def test_a_label_only_change_keeps_the_copper_and_the_router_does_not_run(routed_project, argv_log):
    first = route_project(routed_project)
    calls = router_calls(argv_log)
    rebuild(routed_project, LABELLED)
    assert build_routing(routed_project, routed_project / ".pino/build" / latest_build(routed_project))[
        "stale_because"] == ["labels moved"]

    r = route_project(routed_project)
    assert r.state == "done" and r.key != first.key and r.number == 2 and not r.cached
    assert router_calls(argv_log) == calls
    assert r.reused == {"number": 1, "key": first.key}
    assert "copper of r1 kept (labels moved)" in r.headline
    jsonschema.validate(json.loads(r.to_json()), ROUTE_SCHEMA)
    assert [t.step for t in r.timings] == ["router", "plan", "copper", "drc", "checks", "glb"]
    assert r.counts == first.counts and r.share == first.share and r.verdict == first.verdict

    old, new = routed_project / ".pino/routes" / first.key, routed_project / ".pino/routes" / r.key
    assert {x.name for x in new.iterdir()} == {x.name for x in old.iterdir()}
    assert read_copper((new / "board.kicad_pcb").read_text()) == read_copper((old / "board.kicad_pcb").read_text())
    # the new board is the new build's, labels and all, with the old copper on it
    built = references(routed_project / ".pino/build" / latest_build(routed_project) / "board.kicad_pcb")
    assert references(new / "board.kicad_pcb") == built != references(old / "board.kicad_pcb")
    assert json.loads((new / "board.glb").read_text())["board"] == digest(new / "filled/board.kicad_pcb")
    assert (new / "log.txt").read_text() == (old / "log.txt").read_text()

    routing = build_routing(routed_project, routed_project / ".pino/build" / latest_build(routed_project))
    assert routing["state"] == "current" and routing["number"] == 2
    again = route_project(routed_project)
    assert again.cached and again.reused == r.reused and router_calls(argv_log) == calls


def test_labels_moved_twice_take_the_copper_of_the_newest_route(routed_project, argv_log):
    route_project(routed_project)
    rebuild(routed_project, LABELLED)
    second = route_project(routed_project)
    calls = router_calls(argv_log)
    rebuild(routed_project, SMALL_BOARD_PY + 'b.label(r1, side="bottom")\n')
    third = route_project(routed_project)
    assert third.reused == {"number": 2, "key": second.key} and router_calls(argv_log) == calls


MOVED = SMALL_BOARD_PY + "b.place(r1, at=(6, 4))\n"
OTHER_CHANGES = {
    "parts moved": MOVED,
    "parts moved and labels": MOVED + 'b.label(r1, side="left")\n',
    "connections changed": SMALL_BOARD_PY.replace('b.net("STATUS", u2.IO1, r1[1])', 'b.net("STATUS", u2.IO1, u2.IO2, r1[1])')
    .replace("b.nc(u2.IO2)\n", ""),
    "outline changed": small_board_py(outline="(32, 20)"),
    "rules changed": SMALL_BOARD_PY + 'b.net_class("power", ["VBUS"], width=0.4)\n',
    "fab changed": small_board_py(layers=4),  # the fab profile goes by the layers
}


@pytest.mark.parametrize("change", sorted(OTHER_CHANGES))
def test_any_other_change_routes_again(routed_project, argv_log, change):
    first = route_project(routed_project)
    calls = router_calls(argv_log)
    rebuild(routed_project, OTHER_CHANGES[change])
    reasons = build_routing(routed_project, routed_project / ".pino/build" / latest_build(routed_project))[
        "stale_because"]
    assert reasons and reasons != ["labels moved"]
    r = route_project(routed_project)
    assert r.state == "done" and r.key != first.key and r.reused is None
    assert router_calls(argv_log) > calls and "kept" not in r.headline


def test_no_cache_routes_again_even_when_only_labels_moved(routed_project, argv_log):
    route_project(routed_project)
    calls = router_calls(argv_log)
    rebuild(routed_project, LABELLED)
    r = route_project(routed_project, options=RouteOptions(cache=False))
    assert r.reused is None and router_calls(argv_log) > calls


def test_the_kept_copper_is_checked_again_on_the_new_board(routed_project, monkeypatch, tmp_path):
    first = route_project(routed_project)
    assert first.counts["drc_warnings"] == 0
    rebuild(routed_project, LABELLED)
    # what kicad-cli's DRC says of the new board, labels and copper: a label on the copper's silk
    clean = json.loads(Path(__import__("os").environ["FAKE_KICAD_DRC"]).read_text())
    report = dict(clean, violations=[{
        "description": "Silkscreen overlap", "severity": "warning", "type": "silk_overlap",
        "items": [{"description": "Reference field of R1", "pos": {"x": 95, "y": 98}, "uuid": "s1"},
                  {"description": "Segment of U2 on F.Silkscreen", "pos": {"x": 96, "y": 98}, "uuid": "s2"}]}])
    (tmp_path / "relabelled.json").write_text(json.dumps(report))
    monkeypatch.setenv("FAKE_KICAD_DRC", str(tmp_path / "relabelled.json"))
    r = route_project(routed_project)
    assert r.reused is not None and r.counts["drc_warnings"] == 1
    assert [f.code for f in r.findings if f.source == "drc"] == ["silk_overlap"]
    assert json.loads((routed_project / r.artifacts["drc"]).read_text())["violations"][0]["type"] == "silk_overlap"


def test_same_bytes_twice(routed_project, tmp_path):
    other = Path(shutil.copytree(routed_project, tmp_path / "again"))
    keys = []
    for p in (routed_project, other):
        route_project(p)
        rebuild(p, LABELLED)
        keys.append(route_project(p).key)
    assert keys[0] == keys[1]
    a, b = (p / ".pino/routes" / keys[0] for p in (routed_project, other))
    assert folder_digests(a).keys() == folder_digests(b).keys()
    # log.txt is left out: it is the first route's log, which carries how long each router step took
    for name in ("board.kicad_pcb", "copper.json", "plan.json", "key.json", "drc.json", "filled/board.kicad_pcb",
                 "board.glb"):
        assert digest(a / name) == digest(b / name), name


def test_a_cancel_during_it_leaves_the_kept_route(routed_project, monkeypatch, tmp_path):
    first = route_project(routed_project)
    kept = routed_project / ".pino/routes" / first.key
    before = folder_digests(kept)
    rebuild(routed_project, LABELLED)
    monkeypatch.setenv("FAKE_KICAD_SLOW", "30")
    monkeypatch.setenv("FAKE_KICAD_PIDFILE", str(tmp_path / "kpid"))
    cancel = threading.Event()

    def cancel_when_drc_runs():
        end = time.monotonic() + 20
        while not (tmp_path / "kpid").exists() and time.monotonic() < end:
            time.sleep(0.05)
        cancel.set()

    threading.Thread(target=cancel_when_drc_runs, daemon=True).start()
    started = time.monotonic()
    r = route_project(routed_project, cancel=cancel)
    assert r.state == "cancelled" and time.monotonic() - started < 20
    assert folder_digests(kept) == before
    assert [d.name for d in (routed_project / ".pino/routes").iterdir() if d.is_dir()] == [first.key]
    assert RouteHistory(routed_project).latest_done()["key"] == first.key


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_the_reused_routes_drc_sees_the_new_labels_with_kicad_cli(make_project, real_libs, fake_krt, monkeypatch):
    """The real kicad-cli: R1's label put by hand on R2's pads shows in the reused route's DRC, as in its build's."""
    monkeypatch.delenv("PINO_KICAD_CLI", raising=False)
    text = '''from pino import Board

b = Board("relabel", layers=2, outline=(20, 12))
m = b.block("m", "Two resistors")
R0402 = "Resistor_SMD:R_0402_1005Metric"
r1 = m.path("R1", "Device:R", "1k", footprint=R0402)
r2 = m.path("R2", "Device:R", "1k", footprint=R0402)
b.net("A", r1[1], r2[1])
b.net("B", r1[2], r2[2])
b.place(r1, at=(-4, 0))
b.place(r2, at=(4, 0))
'''
    project = make_project(text)
    assert build(project).verdict != "failed"
    first = route_project(project)
    assert first.state == "done" and first.reused is None

    def silk(report_path: Path) -> list[str]:
        report = json.loads(report_path.read_text())
        return sorted(v["type"] for v in report["violations"]
                      if v["type"].startswith("silk") and any("R1" in it["description"] for it in v["items"]))

    assert silk(project / first.artifacts["drc"]) == []
    (project / "board.py").write_text(text + "b.label(r1, at=(8, 0))\n", encoding="utf-8")
    assert build(project).verdict != "failed"
    r = route_project(project)
    assert r.state == "done" and r.reused == {"number": 1, "key": first.key}
    assert silk(project / r.artifacts["drc"]) == silk(project / ".pino/build" / latest_build(project) / "drc.json")
    assert silk(project / r.artifacts["drc"]) != []
