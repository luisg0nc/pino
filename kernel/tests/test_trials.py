import json
import re
import subprocess
import sys
from pathlib import Path

import jsonschema
import pytest

from copper_boards import track, via
from helpers import SMALL_BOARD_PY
from pino_kernel.build import BuildOptions, build
from pino_kernel.pcb.copper import copper_nodes, merge_copper, read_copper
from pino_kernel.routing.job import latest_build, route_project
from pino_kernel.routing.snippets import board_var
from pino_kernel.routing.trials import keep, nudge, route_net
from pino_kernel.sexpr import num

KERNEL = Path(__file__).resolve().parents[1]
TRIAL_SCHEMA = json.loads((KERNEL / "schema" / "trial-result-1.schema.json").read_text())
KICAD_FAKE = BuildOptions(kicad=True)


@pytest.fixture
def auto_drc(monkeypatch):
    monkeypatch.setenv("FAKE_KICAD_DRC", "auto")


@pytest.fixture
def trial_project(built_project, auto_drc):
    return built_project()


def append(path: Path, text: str) -> None:
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\n" + text + "\n")


def tracks_of(path: Path, net: str):
    return sorted((t.layer, min(t.a, t.b), max(t.a, t.b), t.width) for t in read_copper(path.read_text()).tracks
                  if t.net == net)


def poses(project: Path):
    b = latest_build(project)
    return json.loads((project / ".pino/build" / b / "placement.json").read_text())["poses"]


def pose_of(project: Path, ref: str):
    p = poses(project)[ref]
    return p["x"], p["y"]


def route_net_after_failed_status(project: Path, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_FAIL", "STATUS")
    route_project(project)
    monkeypatch.delenv("FAKE_KRT_FAIL")
    return route_net(project, "STATUS", region=(-5, -5, 5, 5), rip=["*"])


def test_route_net_trial_reports_and_snippet(trial_project, monkeypatch):
    t = route_net_after_failed_status(trial_project, monkeypatch)
    assert (t.before["net_complete"], t.after["net_complete"], t.ok) == (False, True, True)
    assert t.snippet == 'b.route_hint("STATUS", region=(-5, -5, 5, 5), rip=["*"])' and t.kind == "route_net"
    assert {x.name for x in (trial_project / t.artifacts["folder"]).iterdir()} >= {"board.kicad_pcb", "copper.json", "trial.json"}
    # the fake router joins only a net's first two pads, so the nets of three or more pads stay open
    assert t.base["route"] is not None and t.before["unrouted_nets"] == t.after["unrouted_nets"] + 1


def test_route_net_without_a_current_route(trial_project):
    t = route_net(trial_project, "STATUS")
    assert t.base["route"] is None and "no current route: tried on the unrouted board" in t.headline
    assert t.after["net_complete"] and t.snippet == 'b.route_hint("STATUS")'


def test_the_hint_replays_what_the_trial_found(trial_project, monkeypatch):
    t = route_net_after_failed_status(trial_project, monkeypatch)
    append(trial_project / "board.py", t.snippet)
    build(trial_project, KICAD_FAKE)
    r = route_project(trial_project)
    assert r.state == "done"
    assert tracks_of(trial_project / r.artifacts["board"], "STATUS") == tracks_of(trial_project / t.artifacts["board"], "STATUS")


def test_nudge_checks_and_snippet(trial_project):
    t = nudge(trial_project, "R1", by=(1.0, 0.0))
    x, y = pose_of(trial_project, "R1")
    rot = poses(trial_project)["R1"]["rot"]
    assert t.snippet == f'b.place(b.part("R1"), at=({num(x + 1)}, {num(y)}), rot={num(rot)})' and t.kind == "nudge"
    assert {"crossings", "length_mm", "score"} <= set(t.after) and {"crossings", "length_mm", "score"} <= set(t.before)
    assert t.replaces_line is None


def test_nudge_onto_another_part_is_not_ok(trial_project):
    (rx, ry), (ux, uy) = pose_of(trial_project, "R1"), pose_of(trial_project, "U2")
    t = nudge(trial_project, "R1", by=(ux - rx, uy - ry))
    assert not t.ok and any(f.code == "courtyard_overlap" and "R1" in f.refs for f in t.findings)


def test_nudge_replaces_the_intent_line(built_project, auto_drc):
    text = SMALL_BOARD_PY + "b.place(r1, at=(6, 4))\n"
    line = text.splitlines().index("b.place(r1, at=(6, 4))") + 1
    p = built_project(text)
    t = nudge(p, "R1", by=(0.5, 0.0))
    assert t.replaces_line == line and t.snippet.startswith('b.place(b.part("R1"), at=(6.5, 4), rot=')


def test_nudge_with_route_compares_router_share(trial_project):
    route_project(trial_project)
    t = nudge(trial_project, "R1", by=(0.0, 0.0), route=True)
    assert {"router_share", "unrouted"} <= set(t.before) and {"router_share", "unrouted"} <= set(t.after)
    assert t.after["unrouted"] == t.before["unrouted"] and t.ok


@pytest.fixture
def routed_project_with_vbus_via(trial_project):
    """A current route whose VBUS copper runs J1.1 -> (1, 2) -> via (3, 2) to B.Cu -> (5, 2) -> U1.1, 0.5 mm wide."""
    r = route_project(trial_project)
    path = trial_project / r.artifacts["board"]
    text = path.read_text()
    pads = {(p.ref, p.number): p.centre for p in read_copper(text).pads}
    j1, u1 = pads[("J1", "1")], pads[("U1", "1")]
    keep_nodes = [n for n in copper_nodes(text) if str(n[-2][1]) != "VBUS"]
    from copper_boards import _copper
    new = [_copper(*track("VBUS", j1, (1, 2), 0.5)), _copper(*track("VBUS", (1, 2), (3, 2), 0.5)),
           _copper(*via("VBUS", (3, 2))), _copper(*track("VBUS", (3, 2), (5, 2), 0.5, "B.Cu")),
           _copper(*track("VBUS", (5, 2), u1, 0.5, "B.Cu"))]
    path.write_text(merge_copper(text, keep_nodes + new), encoding="utf-8")
    return trial_project


def test_keep_snippets_by_pins_and_vias(routed_project_with_vbus_via):
    t = keep(routed_project_with_vbus_via, "VBUS")
    assert t.ok and t.kind == "keep" and t.snippet.splitlines() == [
        'b.keep_route("VBUS", frm=b.part("J1")[1], to=b.part("U1")[1], layer="F.Cu", width=0.5, points=[(1, 2), via(3, 2, to="B.Cu"), (5, 2)])',
        "# needs: from pino import via"]


def test_keep_round_trip(routed_project_with_vbus_via):
    p = routed_project_with_vbus_via
    route_board = p / ".pino/routes" / route_project(p).key / "board.kicad_pcb"
    before = tracks_of(route_board, "VBUS")
    t = keep(p, "VBUS")
    text = (p / "board.py").read_text()
    (p / "board.py").write_text("from pino import via\n" + text + "\n" + t.snippet + "\n", encoding="utf-8")
    r = build(p, KICAD_FAKE)
    assert r.verdict != "failed", r.headline
    built = read_copper((p / r.artifacts["board"]).read_text())
    locked = sorted((x.layer, min(x.a, x.b), max(x.a, x.b), x.width) for x in built.tracks
                    if x.locked and x.net == "VBUS")
    assert len(locked) == len(before)
    for a, b in zip(locked, before):
        assert a[0] == b[0] and a[3] == b[3] and a[1] == pytest.approx(b[1], abs=1e-6) and a[2] == pytest.approx(b[2], abs=1e-6)


def test_keep_refuses_stale_copper(trial_project):
    route_project(trial_project)
    append(trial_project / "board.py", "b.place(r1, at=(3, 3))")
    build(trial_project, KICAD_FAKE)
    t = keep(trial_project, "STATUS")
    assert not t.ok and t.headline.startswith("route first")


def test_keep_refuses_arcs(trial_project):
    r = route_project(trial_project)
    path = trial_project / r.artifacts["board"]
    from copper_boards import _copper, arc
    text = path.read_text()
    path.write_text(merge_copper(text, copper_nodes(text) + [_copper(*arc("STATUS", (0, 0), (1, 1), (2, 0)))]), encoding="utf-8")
    t = keep(trial_project, "STATUS")
    assert not t.ok and "arc" in t.headline


def test_board_var_detection():
    assert [board_var(t) for t in ("board = Board(\n", "import pino\npcb = pino.Board(\n", "x = 1\n")] == ["board", "pcb", "b"]


def test_trial_result_schema(trial_project):
    for t in (route_net(trial_project, "STATUS"), nudge(trial_project, "R1", by=(1.0, 0.0))):
        jsonschema.validate(json.loads(t.to_json()), TRIAL_SCHEMA)
        assert (trial_project / t.artifacts["folder"] / "trial.json").is_file()
    assert re.fullmatch(r"\.pino/trials/\d+", t.artifacts["folder"])


def test_cli_trials(trial_project):
    def cli(*args):
        return subprocess.run([sys.executable, "-m", "pino_kernel.cli", *args], capture_output=True, text=True, timeout=120)

    p = cli("nudge", str(trial_project), "--part", "R1", "--by=1,0")
    assert json.loads(p.stdout)["kind"] == "nudge" and p.returncode in (0, 1)
    p = cli("route-net", str(trial_project), "--net", "STATUS", "--region=-5,-5,5,5", "--rip", "*")
    assert json.loads(p.stdout)["snippet"] == 'b.route_hint("STATUS", region=(-5, -5, 5, 5), rip=["*"])'
    p = cli("keep", str(trial_project), "--net", "STATUS")
    assert p.returncode == 1 and json.loads(p.stdout)["headline"].startswith("route first")


def test_serve_route_net_and_keep(trial_project):
    from test_serve_jobs import serve

    out = serve([{"id": 1, "op": "route_net", "project": str(trial_project), "net": "STATUS"},
                 {"id": 2, "op": "keep", "project": str(trial_project), "net": "STATUS"},
                 {"id": 3, "op": "nudge", "project": str(trial_project), "part": "R1", "by": [1, 0]},
                 {"id": 4, "op": "shutdown"}], wait_for=1)
    mine = [o for o in out if o.get("id") == 1]
    assert any("event" in o for o in mine) and mine[-1]["ok"] and mine[-1]["result"]["kind"] == "route_net"
    two = next(o for o in out if o.get("id") == 2)
    assert two["ok"] and two["result"]["kind"] == "keep" and not two["result"]["ok"]
    three = next(o for o in out if o.get("id") == 3)
    assert three["result"]["kind"] == "nudge"
    assert [o["id"] for o in out if o.get("id") in (2, 3)] == [2, 3]
