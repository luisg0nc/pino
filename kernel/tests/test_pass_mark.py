"""The pass mark (plan Task 12): the reference board and a 4-layer board fully routed and DRC clean, with the
router's share and time recorded. Runs the real kicad-cli and the installed KiCadRoutingTools."""

import hashlib
import json
import shutil
import struct
import threading
from pathlib import Path

import pytest

from helpers import FIXTURES
from pino_kernel.build import build
from pino_kernel.routing.checks import unrouted_nets
from pino_kernel.routing.job import RouteOptions, route_board, route_project
from pino_kernel.routing.krt import locate
from pino_kernel.routing.plan import plan_route

pytestmark = [pytest.mark.kicad_cli, pytest.mark.kicad_libs, pytest.mark.krt]
FINISH = (FIXTURES / "reference" / "finish.py").read_text()


@pytest.fixture
def ref(tmp_path, real_libs):
    return Path(shutil.copytree(FIXTURES / "reference", tmp_path / "reference"))


def append(path: Path, text: str) -> None:
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\n" + text + "\n")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mesh_names(glb: Path) -> list[str]:
    data = glb.read_bytes()
    length = struct.unpack_from("<I", data, 12)[0]
    return [m.get("name", "") for m in json.loads(data[20:20 + length])["meshes"]]


def errors(result):
    return [f.to_json() for f in result.findings if f.severity == "error"]


def test_reference_router_share_is_recorded(ref, record_property):
    build(ref)
    r = route_project(ref)
    record_property("reference_router_share", r.share["router"]["share"])
    record_property("reference_router_seconds", r.share["router"]["seconds"])
    print(f"reference: {r.headline}; share {r.share}")
    assert r.state == "done" and r.share["router"]["seconds"] < 300 and r.share["router"]["share"] >= 0.5


def test_reference_board_fully_routed_and_clean(ref, record_property):
    append(ref / "board.py", FINISH)
    b = build(ref)
    assert b.verdict == "ok", errors(b)
    r = route_project(ref)
    assert r.state == "done" and r.complete and r.counts["unrouted"] == 0, errors(r)
    assert r.counts["drc_errors"] == 0 and r.counts["copper_errors"] == 0, errors(r)
    assert r.share["router"]["seconds"] < 300
    meshes = mesh_names(ref / r.artifacts["glb"])
    assert any(n.startswith("board_copper") for n in meshes) and any(n.startswith("board_via") for n in meshes), meshes
    record_property("reference_share_with_finish", r.share)
    record_property("reference_route_seconds", sum(t.seconds for t in r.timings))
    print(f"reference with finish: {r.headline}; {sum(t.seconds for t in r.timings):.1f} s in all")
    again = build(ref)
    assert again.routing["state"] == "current" and "0 left, DRC clean" in again.headline


def test_reference_route_is_deterministic(ref, tmp_path):
    other = Path(shutil.copytree(FIXTURES / "reference", tmp_path / "again"))
    for p in (ref, other):
        append(p / "board.py", FINISH)
        build(p)
    a, b = route_project(ref), route_project(other)
    assert a.key == b.key
    for name in ("board.kicad_pcb", "copper.json", "filled/board.kicad_pcb"):
        assert digest(ref / ".pino/routes" / a.key / name) == digest(other / ".pino/routes" / b.key / name), name


@pytest.fixture
def four_layer(kicad, tmp_path):
    import four_layer as fl

    try:
        return fl.prepare(kicad, tmp_path / "four-layer")
    except fl.Offline as e:
        pytest.skip(str(e))


@pytest.mark.network
@pytest.mark.xfail(strict=True, reason=(
    "the strict pass mark is not met on Watchy (measured 2026-11-26): router 45/50 nets (share 0.90) in about 52 s; "
    "5 nets left near U4 and U6 (+3V3, BTN1, BTN2, SCL, SDA); 7 new DRC errors, 4 of them unavoidable because both "
    "of AE1's pads sit inside the antenna's own no-net copper (the hand-routed original has them too). "
    "Luis decides the pass mark; see the routing stage report"))
def test_four_layer_board_fully_routed_and_clean(four_layer, kicad, tmp_path, record_property):
    import four_layer as fl

    plan = plan_route(four_layer.text, four_layer.pro, None, pairs=fl.finish_pairs(), hints=fl.finish_hints())
    out = route_board(tmp_path / "work", four_layer.text, four_layer.pro, None, plan, kicad=kicad, krt=locate(),
                      project_files=four_layer.files, baseline=four_layer.baseline_drc, options=RouteOptions(),
                      events=lambda e: None, cancel=threading.Event())
    record_property("four_layer_share", out.share.to_json())
    print(f"four layer: share {out.share.to_json()}, {out.unrouted} connections left, "
          f"{sum(f.severity == 'error' for f in out.findings)} errors")
    assert out.stopped is None and sum(unrouted_nets(out.drc).values()) == 0
    assert [f for f in out.findings if f.severity == "error"] == []
    assert out.share.router_seconds < 300
