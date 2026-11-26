"""`pino-kernel parts`, and the parts, fab_profiles and cancel ops of serve."""

import json
from datetime import timedelta
from pathlib import Path

import jsonschema
import pytest

from pino_kernel.parts.cache import PartsCache, parts_root, utc_now
from pino_kernel.parts.model import PartInfo
from test_cli import run_cli
from test_serve_jobs import serve

SCHEMA = json.loads((Path(__file__).resolve().parents[1] / "schema" / "parts-result-1.schema.json").read_text())


def result_of(p):
    r = json.loads(p.stdout)
    jsonschema.validate(r, SCHEMA)
    return r


def test_cli_search_prints_one_result(recorded_env):
    p = run_cli("parts", "search", "10k 0603 resistor", "--basic", "--limit", "8")
    r = result_of(p)
    assert r["kind"] == "search" and r["parts"] and all(x["class"] == "basic" for x in r["parts"]) and p.returncode == 0
    assert r["headline"] == f"Parts: {len(r['parts'])} found for 10k 0603 resistor (basic only), stock from jlcsearch now"
    assert r["source"]["fresh"] and r["source"]["url"] == "https://jlcsearch.tscircuit.com"
    assert r["query"] == {"q": "10k 0603 resistor", "package": None, "basic": True, "preferred": False, "limit": 8}


def test_cli_get_says_stock_and_class(recorded_env):
    p = run_cli("parts", "get", "c25804")
    r = result_of(p)
    assert p.returncode == 0 and r["kind"] == "get" and r["query"] == {"lcsc": ["C25804"]}
    assert r["headline"] == "Parts: C25804 is basic, 0603, stock not known (checked 2026-11-03)"


def test_cli_get_of_a_part_jlc_does_not_have(recorded_env):
    p = run_cli("parts", "get", "C99999999")
    r = result_of(p)
    assert p.returncode == 0 and r["parts"] == [] and r["headline"] == "Parts: JLC has no part C99999999"
    assert [(f["source"], f["code"], f["severity"]) for f in r["findings"]] == [("parts", "part_unknown", "error")]


def test_cli_offline_with_nothing_cached_exits_2():
    p = run_cli("parts", "get", "C25804")
    r = result_of(p)
    assert p.returncode == 2 and "could not be reached" in r["headline"] and r["findings"][0]["code"] == "parts_unavailable"
    p = run_cli("parts", "search", "10k resistor")
    assert p.returncode == 2 and "could not be reached" in result_of(p)["headline"]


def test_cli_offline_gives_the_cached_answer_with_its_date():
    old = utc_now() - timedelta(days=3)
    cache = PartsCache(parts_root(), now=lambda: old)
    cache.put_stock(PartInfo("C25804", "m", "0603", "d", 12, 0.1, "basic", None, old.isoformat()))
    p = run_cli("parts", "get", "C25804")
    r = result_of(p)
    assert p.returncode == 0 and r["parts"][0]["stock"] == 12 and r["source"]["fresh"] is False
    assert r["headline"] == f"Parts: jlcsearch could not be reached; stock from {old.date().isoformat()}"


def test_cli_fetch_many(recorded_env):
    p = run_cli("parts", "fetch", "C25804", "C14663", "--events")
    lines = [json.loads(line) for line in p.stdout.splitlines()]
    assert p.returncode == 0 and lines[-1]["event"] == "done"
    r = lines[-1]["result"]
    jsonschema.validate(r, SCHEMA)
    assert r["kind"] == "fetch" and [x["lcsc"] for x in r["parts"]] == ["C25804", "C14663"]
    assert r["headline"] == "Parts: 2 looked up, stock from jlcsearch now"


def test_cli_a_bad_number_is_refused_in_words():
    p = run_cli("parts", "get", "R0603")
    assert p.returncode == 2 and "not an LCSC number" in result_of(p)["headline"]


def test_cli_limit_out_of_range_is_refused(recorded_env):
    p = run_cli("parts", "search", "resistor", "--limit", "5000")
    assert p.returncode == 2 and "limit must be from 1 to 1000" in result_of(p)["headline"]


def test_cli_refresh_reads_the_latest_build(recorded_env, built_project):
    from helpers import SMALL_BOARD_PY

    board = SMALL_BOARD_PY.replace('"pino_test:R", "10k")', '"pino_test:R", "10k", lcsc="C25804")')
    project = built_project(board)
    p = run_cli("parts", "refresh", str(project))
    r = result_of(p)
    assert p.returncode == 0 and r["kind"] == "refresh" and [x["lcsc"] for x in r["parts"]] == ["C25804"]


def test_cli_refresh_without_a_build(tmp_path):
    p = run_cli("parts", "refresh", str(tmp_path))
    assert p.returncode == 2 and "save board.py first" in result_of(p)["headline"]


def test_serve_parts_is_a_job_and_build_is_not_blocked(recorded_env, built_project):
    project = built_project()
    out = serve([{"id": 1, "op": "parts", "action": "get", "lcsc": "C25804"},
                 {"id": 2, "op": "build", "project": str(project), "options": {"kicad": False}},
                 {"id": 3, "op": "shutdown"}], wait_for=2)
    done = [o for o in out if o.get("id") == 1 and "result" in o]
    assert done and done[0]["ok"]
    jsonschema.validate(done[0]["result"], SCHEMA)
    assert done[0]["result"]["parts"][0]["lcsc"] == "C25804"


def test_serve_fab_profiles_and_ping_3():
    from pino_kernel import __version__

    out = serve([{"id": 1, "op": "ping"}, {"id": 2, "op": "fab_profiles"}, {"id": 3, "op": "shutdown"}])
    assert out[0]["pong"] == {"kernel": __version__, "schema": "pino.build/1", "serve": 3, "route_schema": "pino.route/1",
                              "parts_schema": "pino.parts/1", "release_schema": "pino.release/1"}
    assert [p["name"] for p in out[1]["profiles"]] == ["jlc-standard-2layer", "jlc-standard-4layer"]
    assert out[1]["profiles"][0]["assembly"]["kind"] == "economic"


def test_cancel_alias_cancels_any_job(routed_project, monkeypatch, tmp_path):
    from test_serve_jobs import gone, wait_for_file

    monkeypatch.setenv("FAKE_KRT_MODE", "sleep")
    monkeypatch.setenv("FAKE_KRT_PIDFILE", str(tmp_path / "pid"))
    out = serve([{"id": 1, "op": "route", "project": str(routed_project)},
                 ("after_first_event", {"id": 2, "op": "cancel", "job": 1}), {"id": 3, "op": "shutdown"}],
                wait_for=1, ready=lambda: wait_for_file(tmp_path / "pid"))
    assert {"id": 2, "ok": True, "cancelled": True} in out
    assert gone(int((tmp_path / "pid").read_text()))


@pytest.mark.parametrize("request_fields,want", [
    ({}, "search, get, fetch or refresh"),
    ({"action": "buy"}, "search, get, fetch or refresh"),
    ({"action": "search"}, "needs q"),
    ({"action": "search", "q": "--limit=1"}, "cannot start with -"),
    ({"action": "get"}, "needs lcsc"),
    ({"action": "get", "lcsc": "R1"}, "not an LCSC number"),
    ({"action": "refresh"}, "needs a project folder"),
])
def test_parts_op_with_missing_or_wrong_fields_says_what_to_send(request_fields, want):
    out = serve([{"id": 1, "op": "parts", **request_fields}, {"id": 2, "op": "shutdown"}])
    assert out[0]["ok"] is False and want in out[0]["error"]


def test_cli_fetch_says_how_each_number_maps(recorded_env):
    r = result_of(run_cli("parts", "fetch", "C900001", "C900002"))
    assert r["resolved"] == [
        {"lcsc": "C900001", "how": "kicad-rule", "symbol": "Device:R",
         "footprint": "Resistor_SMD:R_0603_1608Metric", "notes": []},
        {"lcsc": "C900002", "how": None, "symbol": None, "footprint": None,
         "notes": ["no KiCad mapping: pass symbol= and footprint= in board.py"]}]
