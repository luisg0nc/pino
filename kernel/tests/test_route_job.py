import fcntl
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import jsonschema
import pytest

from helpers import SMALL_BOARD_PY
from pino_kernel.build import build
from pino_kernel.pcb.copper import read_copper
from pino_kernel.routing import job
from pino_kernel.routing.history import RouteHistory
from pino_kernel.routing.job import RouteOptions, latest_build, route_project
from pino_kernel.routing.result import RouteResult, route_headline
from pino_kernel.sexpr import dump, find_all, parse

KERNEL = Path(__file__).resolve().parents[1]
ROUTE_SCHEMA = json.loads((KERNEL / "schema" / "route-result-1.schema.json").read_text())


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


def files_outside_dot_pino(project: Path) -> dict[str, str]:
    return {str(p.relative_to(project)): digest(p) for p in project.rglob("*")
            if p.is_file() and ".pino" not in p.relative_to(project).parts}


KEPT_BOARD_PY = '''from pino import Board

b = Board("kept", layers=2, outline=(30, 20))
blk = b.block("r", "two resistors")
r1 = blk.path("R1", "pino_test:R", "1k")
r2 = blk.path("R2", "pino_test:R", "1k")
b.place(r1, at=(-5, 0))
b.place(r2, at=(5, 0))
b.net("N1", r1[2], r2[1])
b.net("N2", r1[1], r2[2])
b.keep_route("N1", frm=r1[2], to=r2[1], layer="F.Cu")
b.keep_route("N2", frm=r1[1], to=r2[2], layer="B.Cu")
'''


def test_route_folder_layout_and_result(routed_project):
    r = route_project(routed_project)
    d = routed_project / ".pino/routes" / r.key
    assert r.state == "done" and r.number == 1 and r.build == latest_build(routed_project)
    assert {x.name for x in d.iterdir()} == {"key.json", "plan.json", "route.json", "board.kicad_pcb", "copper.json",
                                            "filled", "drc.json", "log.txt", "board.glb"}
    assert {x.name for x in (d / "filled").iterdir()} >= {"board.kicad_pcb", "board.kicad_pro", "board.kicad_dru",
                                                         "board.kicad_sch", "sym-lib-table", "fp-lib-table"}
    assert not list((routed_project / ".pino/routes").glob("*.tmp-*"))
    jsonschema.validate(json.loads(r.to_json()), ROUTE_SCHEMA)
    assert [t.step for t in r.timings] == ["router", "plan", "chain", "refill", "cleanup", "drc", "checks", "glb"]
    assert r.verdict == "ok" and r.complete and r.counts["tracks"] > 0 and r.router["version"] == "0.17.7"
    assert RouteResult.from_json((d / "route.json").read_text()).key == r.key
    assert r.artifacts["board"] == f".pino/routes/{r.key}/board.kicad_pcb"
    assert "== signals" in (d / "log.txt").read_text()


def test_writes_only_under_dot_pino(routed_project):
    before = files_outside_dot_pino(routed_project)
    route_project(routed_project)
    assert files_outside_dot_pino(routed_project) == before


def test_kept_copper_survives_routing(built_project):
    p = built_project(KEPT_BOARD_PY.replace('b.keep_route("N2", frm=r1[1], to=r2[2], layer="B.Cu")\n', ""))
    b = latest_build(p)
    built = {t.uuid for t in read_copper((p / ".pino/build" / b / "board.kicad_pcb").read_text()).tracks if t.locked}
    r = route_project(p)
    routed = read_copper((p / r.artifacts["board"]).read_text())
    assert built and {t.uuid for t in routed.tracks if t.locked} == built
    assert {t.net for t in routed.tracks if not t.locked} == {"N2"}


def test_same_bytes_twice(routed_project, tmp_path):
    other = Path(shutil.copytree(routed_project, tmp_path / "again"))
    a, b = route_project(routed_project), route_project(other)
    assert a.key == b.key
    for name in ("board.kicad_pcb", "copper.json", "plan.json", "key.json", "filled/board.kicad_pcb", "board.glb"):
        assert digest(routed_project / ".pino/routes" / a.key / name) == digest(other / ".pino/routes" / b.key / name)


def test_cached_second_route(routed_project, argv_log):
    route_project(routed_project)
    n = len(argv_log())
    r = route_project(routed_project)
    assert r.cached and r.number == 2 and len(argv_log()) == n and r.state == "done"


def test_no_cache_routes_again(routed_project, argv_log):
    route_project(routed_project)
    n = len(argv_log())
    r = route_project(routed_project, options=RouteOptions(cache=False))
    assert not r.cached and len(argv_log()) > n


def test_route_exports_a_model_of_the_routed_filled_board(routed_project):
    """The 3D view of a routed board: the build's flags, on the board with the route's copper and filled zones, and
    with kicad-cli's date taken out as in a build."""
    r = route_project(routed_project)
    d = routed_project / ".pino/routes" / r.key
    assert r.artifacts["glb"] == f".pino/routes/{r.key}/board.glb"
    model = json.loads((d / "board.glb").read_text())
    assert model["board"] == digest(d / "filled/board.kicad_pcb")
    assert {"--include-tracks", "--include-pads", "--include-zones", "--include-silkscreen",
            "--include-soldermask"} <= set(model["flags"])
    assert set(model["generated_at"]) == {"0"}
    assert not list((d / "filled").glob("*.kicad_prl"))
    jsonschema.validate(json.loads(r.to_json()), ROUTE_SCHEMA)


def test_a_failed_model_export_keeps_the_route(routed_project, monkeypatch):
    monkeypatch.setenv("FAKE_KICAD_GLB_FAIL", "no model for you")
    r = route_project(routed_project)
    assert r.state == "done" and r.complete and r.verdict == "ok" and "glb" not in r.artifacts
    found = [f for f in r.findings if f.code == "kicad_cli_failed"]
    assert [f.severity for f in found] == ["warning"] and "no model for you" in found[0].message
    assert not (routed_project / ".pino/routes" / r.key / "board.glb").exists()


def without_model(project: Path, key: str) -> Path:
    """The kept route as one made before routes had a model."""
    d = project / ".pino/routes" / key
    (d / "board.glb").unlink()
    kept = json.loads((d / "route.json").read_text())
    del kept["artifacts"]["glb"]
    kept["timings"] = [t for t in kept["timings"] if t["step"] != "glb"]
    (d / "route.json").write_text(json.dumps(kept))
    return d


def glb_warnings(result) -> list:
    return [f for f in result.findings if f.code == "kicad_cli_failed"]


def test_a_cached_route_with_no_model_gets_one_without_routing_again(routed_project, argv_log):
    first = route_project(routed_project)
    d = without_model(routed_project, first.key)
    copper = digest(d / "board.kicad_pcb")
    n = len(argv_log())
    r = route_project(routed_project)
    assert r.cached and r.number == 2 and r.key == first.key and len(argv_log()) == n
    assert r.artifacts["glb"] == f".pino/routes/{r.key}/board.glb" and digest(d / "board.kicad_pcb") == copper
    model = json.loads((d / "board.glb").read_text())
    assert model["board"] == digest(d / "filled/board.kicad_pcb") and set(model["generated_at"]) == {"0"}
    # the app reads route.json, so the stored result lists the model too
    assert RouteResult.from_json((d / "route.json").read_text()).artifacts["glb"] == r.artifacts["glb"]
    assert [t.step for t in r.timings if not t.cached] == ["router", "plan", "glb"]
    assert [t.step for t in r.timings].count("glb") == 1
    assert not list(d.glob("*.tmp*")) and not list((d / "filled").glob("*.kicad_prl"))
    jsonschema.validate(json.loads(r.to_json()), ROUTE_SCHEMA)


def test_a_model_export_that_fails_on_a_cached_route_is_a_warning_until_it_works(routed_project, argv_log, monkeypatch):
    monkeypatch.setenv("FAKE_KICAD_GLB_FAIL", "no model for you")
    first = route_project(routed_project)
    n = len(argv_log())
    r = route_project(routed_project)
    d = routed_project / ".pino/routes" / first.key
    assert r.cached and r.state == "done" and r.verdict == "ok" and "glb" not in r.artifacts and len(argv_log()) == n
    for kept in (r, RouteResult.from_json((d / "route.json").read_text())):
        assert [f.severity for f in glb_warnings(kept)] == ["warning"]
        assert glb_warnings(kept)[0].message.startswith("kicad-cli glb failed")
    monkeypatch.delenv("FAKE_KICAD_GLB_FAIL")
    r = route_project(routed_project)
    assert r.cached and "glb" in r.artifacts and not glb_warnings(r) and len(argv_log()) == n
    assert not glb_warnings(RouteResult.from_json((d / "route.json").read_text()))


def test_a_cached_route_is_still_answered_without_kicad_cli(routed_project, monkeypatch):
    d = without_model(routed_project, route_project(routed_project).key)
    monkeypatch.setattr(job.KicadCli, "find", staticmethod(lambda *a, **k: None))
    r = route_project(routed_project)
    assert r.cached and r.state == "done" and "glb" not in r.artifacts and not (d / "board.glb").exists()


def test_a_cancel_while_a_cached_route_gets_its_model_leaves_the_route(routed_project):
    d = without_model(routed_project, route_project(routed_project).key)
    kept = (d / "route.json").read_text()
    cancel = threading.Event()
    cancel.set()
    r = route_project(routed_project, cancel=cancel)
    assert r.state == "cancelled" and (d / "route.json").read_text() == kept
    assert not (d / "board.glb").exists() and not list(d.glob("*.tmp*"))


def test_busy_when_a_route_runs(routed_project):
    (routed_project / ".pino/routes").mkdir(parents=True, exist_ok=True)
    with open(routed_project / ".pino/routes/job.lock", "a+") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        r = route_project(routed_project)
    assert r.state == "busy" and "a route is already running for this project" in r.headline and r.verdict == "failed"


def test_cancel_kills_the_router_and_cleans_up(routed_project, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep")
    monkeypatch.setenv("FAKE_KRT_PIDFILE", str(tmp_path / "pid"))
    cancel = threading.Event()
    threading.Timer(1.0, cancel.set).start()
    r = route_project(routed_project, cancel=cancel)
    assert r.state == "cancelled" and not list((routed_project / ".pino/routes").glob("*.tmp-*"))
    assert gone(int((tmp_path / "pid").read_text()))
    assert RouteHistory(routed_project).latest_done() is None
    assert "cancelled after" in r.headline


def test_timeout(routed_project, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep")
    r = route_project(routed_project, options=RouteOptions(timeout=2.0))
    assert r.state == "timed_out" and r.verdict == "failed" and not list((routed_project / ".pino/routes").glob("*.tmp-*"))


def test_failed_step_is_a_warning(routed_project, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_MODE", "crash")
    r = route_project(routed_project)
    assert r.state == "done" and any(f.code == "router_step_failed" and f.severity == "warning" for f in r.findings)


def test_router_missing_is_a_failed_route(routed_project, monkeypatch, tmp_path):
    monkeypatch.delenv("PINO_KRT_DIR")
    monkeypatch.setenv("PINO_CACHE_DIR", str(tmp_path / "empty"))
    r = route_project(routed_project, options=RouteOptions(install=False))
    assert r.state == "failed" and r.findings[0].code == "router_missing" and "router install" in r.headline


def test_no_build_yet(make_project, fake_krt):
    r = route_project(make_project(SMALL_BOARD_PY))
    assert r.state == "failed" and "save board.py first" in r.headline


def test_route_with_nothing_to_route(built_project):
    r = route_project(built_project(KEPT_BOARD_PY))
    assert r.state == "done" and r.share["router"]["share"] is None and "nothing to route" in r.headline


def test_route_in_a_path_with_spaces(built_project, argv_log):
    p = built_project(name="my board ação")
    assert route_project(p).state == "done"
    calls = [c for c in argv_log() if c["script"] == "route.py"]
    assert calls and all(any("my board ação" in a for a in c["argv"]) for c in calls)
    fab = calls[0]["argv"][calls[0]["argv"].index("--fab-overrides") + 1]
    assert "my board ação" in fab and Path(fab).name == "fab-overrides.txt"


def test_headlines():
    counts = {"unrouted": 0, "drc_errors": 0, "copper_errors": 0}
    share = {"router": {"routed": 23, "of": 29, "share": 0.793, "seconds": 36.2}, "finish": {"routed": 6, "seconds": 2}}
    assert route_headline(3, 7, "done", counts, share, None) == "Route r3 (h7): router 23/29 nets in 36 s, finish 6, 0 left, DRC clean"
    share["finish"]["routed"] = 0
    assert route_headline(3, 7, "done", {**counts, "unrouted": 2, "drc_errors": 3}, share, None) == \
        "Route r3 (h7): router 23/29 nets in 36 s, 2 left, 3 DRC errors"
    none = {"router": {"routed": 0, "of": 0, "share": None, "seconds": 0}, "finish": {"routed": 0, "seconds": 0}}
    assert route_headline(3, 7, "done", counts, none, None) == "Route r3 (h7): nothing to route"
    assert route_headline(3, 7, "cancelled", counts, None, "cancelled after 12 s") == "Route r3 (h7): cancelled after 12 s"
    assert route_headline(3, None, "failed", counts, None, "KiCadRoutingTools missing: run pino-kernel router install") == \
        "Route r3: KiCadRoutingTools missing: run pino-kernel router install"
    assert len(route_headline(3, 7, "failed", counts, None, "x" * 400)) <= 160


def run_cli(*args, **kw):
    return subprocess.run([sys.executable, "-m", "pino_kernel.cli", *args], capture_output=True, text=True, timeout=120, **kw)


def test_cli_prints_the_result(routed_project):
    p = run_cli("route", str(routed_project))
    r = json.loads(p.stdout)
    assert r["schema"] == "pino.route/1" and p.returncode == 0 and r["state"] == "done"


def test_cli_events_then_result(routed_project):
    p = run_cli("route", str(routed_project), "--events")
    lines = [json.loads(line) for line in p.stdout.splitlines()]
    assert lines[0]["event"] == "step" and lines[-1]["event"] == "done" and p.returncode in (0, 1)
    assert lines[-1]["result"]["schema"] == "pino.route/1"


def test_cli_sigterm_cancels(routed_project, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep")
    monkeypatch.setenv("FAKE_KRT_PIDFILE", str(tmp_path / "pid"))
    proc = subprocess.Popen([sys.executable, "-m", "pino_kernel.cli", "route", str(routed_project), "--events"],
                            stdout=subprocess.PIPE, text=True, start_new_session=True)
    try:
        for line in proc.stdout:
            e = json.loads(line)
            if e.get("event") == "step" and e.get("step") == "signals":
                break
        deadline = time.monotonic() + 10
        while not (tmp_path / "pid").exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        proc.send_signal(signal.SIGTERM)
        rest = proc.stdout.read().splitlines()
        code = proc.wait(timeout=20)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert code == 130 and json.loads(rest[-1])["result"]["state"] == "cancelled"
    assert gone(int((tmp_path / "pid").read_text()))


def test_old_routes_are_pruned(built_project, monkeypatch):
    monkeypatch.setattr(job, "KEEP_ROUTES", 2)
    p = built_project()
    from pino_kernel.build import BuildOptions

    for k in range(4):
        text = SMALL_BOARD_PY + f"b.place(r1, at=({k * 2 - 4}, 4))\n"
        (p / "board.py").write_text(text, encoding="utf-8")
        assert build(p, BuildOptions(kicad=True)).verdict != "failed"
        assert route_project(p).state == "done"
    folders = [d for d in (p / ".pino/routes").iterdir() if d.is_dir()]
    latest = RouteHistory(p).latest_done()["key"]
    assert len(folders) == 2 and latest in {d.name for d in folders}


def test_cancel_during_drc_kills_kicad_and_cleans_up(routed_project, monkeypatch, tmp_path):
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
    assert not list((routed_project / ".pino/routes").glob("*.tmp-*"))
    assert gone(int((tmp_path / "kpid").read_text()))


def test_leftovers_of_a_killed_route_are_cleared(routed_project):
    routes = routed_project / ".pino/routes"
    (routes / "0123456789ab.tmp-999-1").mkdir(parents=True)
    h = RouteHistory(routed_project)
    stuck = h.next_number()
    r = route_project(routed_project)
    assert r.state == "done" and not list(routes.glob("*.tmp-*"))
    assert next(e for e in h.entries() if e["number"] == stuck)["state"] == "failed"


def test_an_engine_fault_is_a_failed_route(routed_project, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(job, "route_board", boom)
    r = route_project(routed_project)
    assert r.state == "failed" and r.findings[0].code == "internal_error" and "kaboom" in r.findings[0].message
    assert all(e["state"] != "running" for e in RouteHistory(routed_project).entries())
    assert not list((routed_project / ".pino/routes").glob("*.tmp-*"))


def test_the_routed_board_keeps_the_labels(built_project):
    project = built_project(SMALL_BOARD_PY.replace("b.nc_rest(u2)\n", 'b.nc_rest(u2)\nb.label(r1, side="left")\n'))
    r = route_project(project)
    assert r.state == "done"

    def references(path):
        out = {}
        for fp in find_all(parse(path.read_text()), "footprint"):
            for p in find_all(fp, "property"):
                if p[1] == "Reference":
                    out[str(p[2])] = dump(p)
        return out

    built = references(project / ".pino/build" / latest_build(project) / "board.kicad_pcb")
    routed = references(project / ".pino/routes" / r.key / "board.kicad_pcb")
    assert routed == built and "R1" in routed
