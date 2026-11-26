import fcntl
import json
import threading
import time
from pathlib import Path

import jsonschema

from pino_kernel.build import BuildOptions, build
from pino_kernel.routing.job import route_project

KERNEL = Path(__file__).resolve().parents[1]
BUILD_SCHEMA = json.loads((KERNEL / "schema" / "build-result-1.schema.json").read_text())
KICAD_FAKE = BuildOptions(kicad=True)


def edit(project: Path, old: str, new: str) -> None:
    text = (project / "board.py").read_text(encoding="utf-8")
    assert old in text
    (project / "board.py").write_text(text.replace(old, new), encoding="utf-8")


def move_a_part(project: Path) -> None:
    with open(project / "board.py", "a", encoding="utf-8") as fh:
        fh.write("b.place(r1, at=(3, 3))\n")


def lock_held(project: Path) -> bool:
    path = project / ".pino/routes/job.lock"
    if not path.exists():
        return False
    with open(path, "a+") as fh:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
    return False


def wait_for_lock(project: Path, timeout: float = 20.0) -> None:
    end = time.monotonic() + timeout
    while not lock_held(project):
        assert time.monotonic() < end, "the route never took its lock"
        time.sleep(0.02)


def test_no_route_yet(routed_project, kicad_fake):
    r = build(routed_project, KICAD_FAKE)
    assert r.routing["state"] == "none" and r.waiting == ["routing: not started"] and r.timings[-1].step == "routing"
    assert r.routing["route"] is None and len(r.routing["key"]) == 12


def test_current_route_sets_unrouted_and_headline(routed_project, kicad_fake):
    route = route_project(routed_project)
    r = build(routed_project, KICAD_FAKE)
    assert r.routing["state"] == "current" and r.routing["key"] == route.key and r.routing["route_key"] == route.key
    assert r.counts["unrouted"] == route.counts["unrouted"] and "routed r1" in r.headline
    assert r.routing["number"] == 1 and r.routing["complete"] is True and r.waiting == []
    assert r.routing["route"] == f".pino/routes/{route.key}" and r.routing["verdict"] == route.verdict


def test_value_change_keeps_copper_current(routed_project, kicad_fake):
    route_project(routed_project)
    edit(routed_project, '"10k"', '"4.7k"')
    r = build(routed_project, KICAD_FAKE)
    assert r.routing["state"] == "current" and not r.cached


def test_move_marks_copper_stale_and_never_reuses_it(routed_project, kicad_fake):
    first = build(routed_project, KICAD_FAKE)
    route_project(routed_project)
    move_a_part(routed_project)
    r = build(routed_project, KICAD_FAKE)
    assert r.routing["state"] == "stale" and r.routing["stale_because"] == ["parts moved"]
    assert r.counts["unrouted"] == first.counts["unrouted"] and "copper stale (parts moved)" in r.headline
    assert r.routing["route"].startswith(".pino/routes/") and r.waiting == ["routing: stale (parts moved)"]
    assert r.routing["route_key"] != r.routing["key"]


def test_save_during_route_marks_it_stale(routed_project, kicad_fake, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_SLOW", "2")
    t = threading.Thread(target=route_project, args=(routed_project,))
    t.start()
    wait_for_lock(routed_project)
    move_a_part(routed_project)
    during = build(routed_project, KICAD_FAKE)
    t.join()
    after = build(routed_project, KICAD_FAKE)
    assert during.routing["state"] == "running" and during.waiting == ["routing: running"] and "; routing" in during.headline
    assert after.routing["state"] == "stale" and after.routing["stale_because"] == ["parts moved"]
    assert not list((routed_project / ".pino/routes").glob("*.tmp-*"))


def test_cached_build_recomputes_routing(routed_project, kicad_fake):
    assert build(routed_project, KICAD_FAKE).routing["state"] == "none"
    route_project(routed_project)
    again = build(routed_project, KICAD_FAKE)
    assert again.cached and again.routing["state"] == "current"


def test_headline_stays_within_160(routed_project, kicad_fake):
    route_project(routed_project)
    edit(routed_project, 'b.nc(u2.IO2)', 'b.nc(u2.IO2)\nb.place(r1, at=(3, 3))\nb.net_class("power", ["VBUS"], width=0.6)\nb.zone("GND", layer="B.Cu")')
    r = build(routed_project, KICAD_FAKE)
    assert r.routing["state"] == "stale" and len(r.routing["stale_because"]) >= 3 and len(r.headline) <= 160


def test_failed_build_has_no_routing(make_project, fixture_libs):
    r = build(make_project("x = (\n"), BuildOptions(kicad=False))
    assert r.routing is None and "routing" not in [t.step for t in r.timings]


def test_result_with_routing_matches_schema(routed_project, kicad_fake):
    jsonschema.validate(json.loads(build(routed_project, KICAD_FAKE).to_json()), BUILD_SCHEMA)
    route_project(routed_project)
    jsonschema.validate(json.loads(build(routed_project, KICAD_FAKE).to_json()), BUILD_SCHEMA)
    move_a_part(routed_project)
    jsonschema.validate(json.loads(build(routed_project, KICAD_FAKE).to_json()), BUILD_SCHEMA)
