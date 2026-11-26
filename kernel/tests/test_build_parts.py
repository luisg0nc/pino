"""Parts in the build: named numbers are looked up before board.py runs, and stock is checked on every build."""

import json
import shutil
from datetime import timedelta

import jsonschema
import pytest

from helpers import FIXTURES, SMALL_BOARD_PY
from pino_kernel.build import BuildOptions, build
from pino_kernel.parts.cache import PartsCache, parts_root, utc_now
from pino_kernel.parts.model import PartInfo
from pino_kernel.parts.transport import recorded_name
from test_build import SCHEMA_JSON as SCHEMA

NUMBERS_ONLY = '''from pino import Board
b = Board("n", outline=(20, 20))
p = b.block("p")
r1 = p.path("R1", lcsc="C900001")
r2 = p.path("R2", lcsc="C900001")
b.net("A", r1[1], r2[1])
b.net("B", r1[2], r2[2])
'''

SMALL_WITH_NUMBER = SMALL_BOARD_PY.replace('"pino_test:R", "10k")', '"pino_test:R", "10k", lcsc="C900001")')


def parts_of(result):
    return [f for f in result.findings if f.source == "parts"]


def seconds_of(result, step):
    return next(t.seconds for t in result.timings if t.step == step)


@pytest.mark.kicad_libs
def test_build_looks_up_numbers_before_running_board_py(make_project, real_libs, kicad_fake, recorded_env):
    r = build(make_project(NUMBERS_ONLY), kicad_fake)
    assert r.verdict != "failed", r.headline
    assert [t.step for t in r.timings][:3] == ["libraries", "fetch parts", "run board.py"]
    steps = [t.step for t in r.timings]
    assert steps.index("checks") < steps.index("parts")
    assert [f.code for f in parts_of(r)] == []                      # basic, 100000 in stock
    assert PartsCache(parts_root()).stock("C900001") is not None
    jsonschema.validate(r.to_dict(), SCHEMA)


def test_findings_join_the_counts(make_project, fixture_libs, kicad_fake, recorded_env):
    r = build(make_project(SMALL_WITH_NUMBER), kicad_fake)
    codes = [f.code for f in parts_of(r)]
    assert codes == ["part_no_lcsc"] * 7
    assert r.counts["infos"] >= 7 and all(f.severity == "info" for f in parts_of(r))


def test_offline_build_says_since_when(make_project, fixture_libs, kicad_fake):
    old = utc_now() - timedelta(days=3)
    PartsCache(parts_root(), now=lambda: old).put_stock(
        PartInfo("C900001", "m", "0603", "d", 1000, 0.1, "basic", None, old.isoformat()))
    r = build(make_project(SMALL_WITH_NUMBER), kicad_fake)          # offline (the test default)
    f = next(f for f in parts_of(r) if f.refs == ("R1",))
    assert f.code == "part_stock_unknown" and f.severity == "warning" and old.date().isoformat() in f.message
    assert seconds_of(r, "parts") < 1.0 and seconds_of(r, "fetch parts") < 1.0


def test_no_parts_network_option_asks_no_one(make_project, fixture_libs, kicad_fake, recorded_env):
    r = build(make_project(SMALL_WITH_NUMBER), BuildOptions(parts_network=False))
    f = next(f for f in parts_of(r) if f.refs == ("R1",))
    assert (f.code, f.severity) == ("part_stock_unknown", "info") and PartsCache(parts_root()).stock("C900001") is None


def set_stock(folder, lcsc, stock):
    path = folder / recorded_name(f"https://jlcsearch.tscircuit.com/api/search?q={lcsc}&limit=1")
    data = json.loads(path.read_text())
    data["body"]["components"][0]["stock"] = stock
    path.write_text(json.dumps(data))


def age_cache(lcsc, days):
    path = parts_root() / "stock" / f"{lcsc}.json"
    data = json.loads(path.read_text())
    data["fetched_at"] = (utc_now() - timedelta(days=days)).isoformat()
    path.write_text(json.dumps(data))


@pytest.fixture
def recorded_copy(tmp_path, monkeypatch):
    folder = tmp_path / "recorded"
    shutil.copytree(FIXTURES / "parts" / "jlcsearch", folder)
    monkeypatch.setenv("PINO_PARTS_RECORDED", str(folder))
    monkeypatch.delenv("PINO_PARTS_OFFLINE", raising=False)
    return folder


def test_cached_build_recomputes_parts(make_project, fixture_libs, kicad_fake, recorded_copy):
    project = make_project(SMALL_WITH_NUMBER)
    first = build(project, kicad_fake)
    assert first.verdict == "ok" and first.counts["errors"] == 0
    set_stock(recorded_copy, "C900001", 0)
    age_cache("C900001", 2)
    again = build(project, kicad_fake)
    assert again.cached and again.hash == first.hash and again.verdict == "errors"
    assert [f.code for f in parts_of(again) if f.severity == "error"] == ["part_no_stock"]
    assert again.counts["errors"] == 1 and "1 error" in again.headline
    set_stock(recorded_copy, "C900001", 100000)
    age_cache("C900001", 2)
    third = build(project, kicad_fake)
    assert third.verdict == "ok" and third.counts == first.counts and len(parts_of(third)) == len(parts_of(first))
    assert third.truncated == first.truncated


def test_the_stored_result_and_the_hash_never_depend_on_stock(make_project, fixture_libs, kicad_fake, recorded_copy):
    a = build(make_project(SMALL_WITH_NUMBER, name="a"), kicad_fake)
    set_stock(recorded_copy, "C900001", 0)
    (parts_root() / "stock" / "C900001.json").unlink()
    project = make_project(SMALL_WITH_NUMBER, name="b")
    b = build(project, kicad_fake)
    assert a.hash == b.hash and b.verdict == "errors"
    stored = json.loads((project / ".pino" / "build" / b.hash / "result.json").read_text())
    assert stored["verdict"] == "ok" and not [f for f in stored["findings"] if f["source"] == "parts"]


def test_refetch_runs_board_py_again_at_most_twice(make_project, fixture_libs, kicad_fake, recorded_env, monkeypatch):
    """Numbers the source does not spell out are found when board.py asks for them, one run at a time."""
    import pino_kernel.build as B

    runs = []
    real = B.run_board
    monkeypatch.setattr(B, "run_board", lambda *a, **kw: runs.append(1) or real(*a, **kw))
    one = 'from pino import Board\nb = Board("n", outline=(20, 20))\nn = "C90000" + "2"\nb.block("p").path("U1", lcsc=n)\n'
    r = build(make_project(one, name="one"), kicad_fake)
    assert len(runs) == 2 and [f.code for f in r.findings] == ["part_no_mapping"]
    assert "symbol='Library:Name'" in r.findings[0].message and r.findings[0].at.line == 4
    runs.clear()
    three = ('from pino import Board\nfrom pino_kernel.parts.cache import PartsCache, parts_root\n'
             'b = Board("n", outline=(20, 20))\np = b.block("p")\n'
             'cache = PartsCache(parts_root())\n'
             'for i, d in enumerate("135"):\n'
             '    n = "C90000" + d\n'
             '    if cache.stock(n) is None:\n'
             '        p.path(f"U{i + 1}", lcsc=n)\n')
    r = build(make_project(three, name="three"), kicad_fake)
    assert len(runs) == 3 and r.verdict == "failed" and r.findings[0].code == "part_not_cached"


@pytest.mark.kicad_cli
def test_kicad_parity_holds_with_a_hand_fit_part(make_project, fixture_libs):
    board = SMALL_BOARD_PY.replace('"pino_test:R", "10k")', '"pino_test:R", "10k", hand_fit=True)')
    r = build(make_project(board))
    assert r.verdict == "ok", [f.to_json() for f in r.findings if f.severity == "error"]
    assert not [f for f in r.findings if "parity" in f.code or "mismatch" in f.code]


def test_a_hanging_jlcsearch_slows_one_build_not_every_save(make_project, fixture_libs, kicad_fake, monkeypatch):
    import time

    import pino_kernel.build as B
    from pino_kernel.parts.transport import OfflineError

    calls = []

    def hang(url, timeout):
        calls.append(url)
        time.sleep(min(timeout, 2.0))
        raise OfflineError("timed out")

    monkeypatch.delenv("PINO_PARTS_OFFLINE")
    monkeypatch.setattr(B, "transport_from_env", lambda: hang)
    monkeypatch.setattr(B, "PARTS_BUDGET", 1.0)
    monkeypatch.setattr(B, "FETCH_BUDGET", 1.0)
    old = utc_now() - timedelta(days=3)
    PartsCache(parts_root(), now=lambda: old).put_stock(
        PartInfo("C900001", "m", "0603", "d", 1000, 0.1, "basic", None, old.isoformat()))
    project = make_project(SMALL_WITH_NUMBER)
    build(project, kicad_fake)
    asked = len(calls)
    again = build(project, kicad_fake)
    assert len(calls) == asked
    assert seconds_of(again, "parts") < 0.5 and seconds_of(again, "fetch parts") < 0.5
    f = next(f for f in parts_of(again) if f.refs == ("R1",))
    assert f.code == "part_stock_unknown" and old.date().isoformat() in f.message
