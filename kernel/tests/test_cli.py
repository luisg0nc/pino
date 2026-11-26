import json
import subprocess
import sys

from helpers import SMALL_BOARD_PY
from pino_kernel import __version__


def run_cli(*args, **kw):
    return subprocess.run([sys.executable, "-m", "pino_kernel.cli", *args], capture_output=True, text=True, **kw)


def test_build_prints_one_json_result(make_project, fixture_libs):
    p = run_cli("build", str(make_project(SMALL_BOARD_PY)), "--no-kicad")
    r = json.loads(p.stdout)
    assert r["schema"] == "pino.build/1" and p.returncode == {"ok": 0, "errors": 1, "failed": 2}[r["verdict"]]
    assert len(p.stdout.strip().splitlines()) > 0 and p.stdout.count('"schema": "pino.build/1"') == 1


def test_failed_board_exits_2(make_project, fixture_libs):
    assert run_cli("build", str(make_project("x = (\n")), "--no-kicad").returncode == 2


def test_build_options(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY)
    run_cli("build", str(p), "--no-kicad")
    again = json.loads(run_cli("build", str(p), "--no-kicad", "--no-cache", "--timeout", "20").stdout)
    assert again["cached"] is False and again["number"] == 2


def test_serve_answers_in_order_and_survives_bad_lines(make_project, fixture_libs):
    good, bad = make_project(SMALL_BOARD_PY), make_project("x = (\n", name="bad")
    lines = [{"id": 1, "op": "ping"}, "not json", {"id": 2, "op": "build", "project": str(bad), "options": {"kicad": False}},
             {"id": 3, "op": "build", "project": str(good), "options": {"kicad": False}}, {"id": 4, "op": "nope"}, {"id": 5, "op": "shutdown"}]
    p = run_cli("serve", input="\n".join(l if isinstance(l, str) else json.dumps(l) for l in lines) + "\n", timeout=60)
    out = [json.loads(l) for l in p.stdout.splitlines()]
    assert [o["id"] for o in out] == [1, None, 2, 3, 4, 5] and p.returncode == 0
    assert out[0]["pong"] == {"kernel": __version__, "schema": "pino.build/1"}
    assert out[1]["ok"] is False and out[2]["result"]["verdict"] == "failed" and out[3]["result"]["verdict"] != "failed"
    assert out[4]["error"] == "unknown op 'nope'"


def test_serve_ends_at_end_of_input(fixture_libs):
    p = run_cli("serve", input=json.dumps({"id": "a", "op": "ping"}) + "\n", timeout=30)
    assert p.returncode == 0 and json.loads(p.stdout)["id"] == "a"


def test_serve_build_without_project(fixture_libs):
    p = run_cli("serve", input=json.dumps({"id": 7, "op": "build"}) + "\n", timeout=30)
    out = json.loads(p.stdout)
    assert out["ok"] is False and "project" in out["error"]


def test_version(fixture_libs):
    v = json.loads(run_cli("version").stdout)
    assert v["schema"] == "pino.build/1" and v["kernel"] == __version__ and v["libraries"]["KICAD10_SYMBOL_DIR"].endswith("symbols")
