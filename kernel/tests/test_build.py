import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import jsonschema
import pytest

from helpers import SMALL_BOARD_PY
from pino_kernel import build as build_module
from pino_kernel.build import BuildOptions, build
from pino_kernel.findings import SEVERITIES, At

NO_KICAD = BuildOptions(kicad=False)
SCHEMA_JSON = json.loads((Path(__file__).resolve().parents[1] / "schema" / "build-result-1.schema.json").read_text())


def snapshot(p: Path) -> dict:
    return {f.relative_to(p).as_posix(): f.read_bytes() for f in sorted(p.rglob("*")) if f.is_file()}


def changed(before: dict, after: dict) -> set:
    return {k for k in set(before) | set(after) if before.get(k) != after.get(k)}


def board_with_missing_models(n):
    lines = ["from pino import Board", "b = Board('models', outline=(200, 200))", "m = b.block('m', 'Many')"]
    for i in range(n):
        lines.append(f"r{i} = m.path('R{i + 1}', 'pino_test:R', '1k', footprint='pino_test:LED_0603')")
        lines.append(f"b.place(r{i}, at=({-95 + 5 * (i % 38)}, {90 - 5 * (i // 38)}))")
    lines += [f"b.net('N{i}', r{i}[2], r{i + 1}[1])" for i in range(n - 1)]
    lines.append(f"b.gnd(r0[1], r{n - 1}[2])")
    return "\n".join(lines) + "\n"


def write_project(path: Path, board_py: str) -> Path:
    path.mkdir(parents=True)
    (path / "board.py").write_text(board_py, encoding="utf-8")
    return path


def test_build_writes_only_under_dot_pino(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY); before = snapshot(p)
    build(p, NO_KICAD)
    assert {f for f in changed(before, snapshot(p))} <= {f for f in snapshot(p) if f.startswith(".pino/")}
    assert (p / "board.py").read_text() == SMALL_BOARD_PY


def test_build_folder_and_artifacts(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY); r = build(p, NO_KICAD)
    d = p / ".pino/build" / r.hash
    assert {"circuit.json", "placement.json", "board.kicad_sch", "board.kicad_pcb", "board.kicad_pro", "board.kicad_dru",
            "sym-lib-table", "fp-lib-table", "result.json"} <= {f.name for f in d.iterdir()}
    assert all((p / a).is_file() for a in r.artifacts.values() if isinstance(a, str))
    assert r.artifacts["board"] == f".pino/build/{r.hash}/board.kicad_pcb"
    assert [t.step for t in r.timings] == ["libraries", "fetch parts", "run board.py", "hash", "place", "write schematic",
                                           "write board", "checks", "parts", "diff", "routing"]
    assert r.waiting == ["routing: not started"] and r.counts["parts"] == 8 and r.placement["length_mm"] > 0


def test_failed_board_py(make_project, fixture_libs):
    r = build(make_project("x = (\n"), NO_KICAD)
    assert r.verdict == "failed" and r.hash is None and r.findings[0].at == At("source", file="board.py", line=1)
    assert r.headline.startswith("On h1: board.py failed at line 1")


def test_same_input_same_hash_and_cached(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY); a = build(p, NO_KICAD); b = build(p, NO_KICAD)
    assert a.hash == b.hash and b.cached and (a.number, b.number) == (1, 2)
    assert b.headline.startswith("On h2:") and not a.cached
    ja, jb = json.loads(a.to_json()), json.loads(b.to_json())
    for k in ("number", "timings", "changes", "cached", "headline"):
        ja.pop(k); jb.pop(k)
    assert ja == jb


def test_no_cache_builds_again(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY); a = build(p, NO_KICAD)
    b = build(p, BuildOptions(kicad=False, cache=False))
    assert a.hash == b.hash and not b.cached


def test_changes_versus_previous_build(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY); first = build(p, NO_KICAD)
    assert first.changes == {"circuit": ["first build"], "layout": []}
    (p / "board.py").write_text(SMALL_BOARD_PY.replace('"10k"', '"4.7k"'))
    assert "R1 value 10k -> 4.7k" in build(p, NO_KICAD).changes["circuit"]


def test_findings_are_capped_and_sorted(make_project, fixture_libs):
    r = build(make_project(board_with_missing_models(250)), NO_KICAD)
    found = r.counts["errors"] + r.counts["warnings"] + r.counts["infos"]
    assert len(r.findings) == 200 and r.truncated == found - 200 >= 50 and len(r.to_json()) < 100_000
    assert [f.severity for f in r.findings] == sorted((f.severity for f in r.findings), key=SEVERITIES.index)


def test_nc_rest_is_listed(make_project, fixture_libs):
    r = build(make_project(SMALL_BOARD_PY), NO_KICAD)
    assert any(f.code == "nc_rest" and f.message == "U2: 1 pin left open by nc_rest: 5 (IO3)" and f.severity == "info"
               for f in r.findings)


def test_expect_paths_are_checked_without_kicad(make_project, fixture_libs):
    r = build(make_project(SMALL_BOARD_PY + 'b.expect_apart(b.part("U2").IO1, b.part("R1")[1])\n'), NO_KICAD)
    assert r.verdict == "errors" and any(f.code == "expect_apart_joined" for f in r.findings)


def test_result_matches_schema(make_project, fixture_libs):
    jsonschema.validate(json.loads(build(make_project(SMALL_BOARD_PY), NO_KICAD).to_json()), SCHEMA_JSON)
    jsonschema.validate(json.loads(build(make_project("x = (\n", name="bad"), NO_KICAD).to_json()), SCHEMA_JSON)


def test_missing_kicad_cli_is_a_warning(make_project, fixture_libs, monkeypatch):
    monkeypatch.setenv("PINO_KICAD_CLI", "/nowhere/kicad-cli")
    r = build(make_project(SMALL_BOARD_PY))
    assert r.verdict != "failed" and any(f.code == "kicad_cli_missing" for f in r.findings) and r.kicad_cli is None


def test_missing_libraries_fail_in_plain_words(make_project, monkeypatch):
    monkeypatch.setenv("PINO_KICAD_SYMBOL_DIR", "/nowhere/symbols")
    r = build(make_project(SMALL_BOARD_PY), NO_KICAD)
    assert r.verdict == "failed" and r.findings[0].code == "libraries_not_found" and "/nowhere/symbols" in r.findings[0].message


def test_build_in_a_path_with_spaces(tmp_path, fixture_libs):
    p = write_project(tmp_path / "my board ação", SMALL_BOARD_PY)
    assert build(p, NO_KICAD).verdict in ("ok", "errors")


def test_two_builds_at_once(make_project, fixture_libs):
    p = make_project(SMALL_BOARD_PY)
    with ThreadPoolExecutor(2) as ex:
        results = list(ex.map(lambda _: build(p, NO_KICAD), range(2)))
    assert {r.number for r in results} == {1, 2}
    assert len(json.loads((p / ".pino/builds.json").read_text())["builds"]) == 2
    assert not list((p / ".pino/build").glob("*.tmp-*"))
    assert len({r.hash for r in results}) == 1


def test_old_builds_are_pruned(make_project, fixture_libs, monkeypatch):
    monkeypatch.setattr(build_module, "KEEP_BUILDS", 2)
    p = make_project(SMALL_BOARD_PY)
    for value in ("1k", "2k", "3k", "4k"):
        (p / "board.py").write_text(SMALL_BOARD_PY.replace('"10k"', f'"{value}"'))
        build(p, NO_KICAD)
    assert len([d for d in (p / ".pino/build").iterdir() if d.is_dir()]) == 2


@pytest.mark.kicad_cli
def test_kicad_build_of_the_small_board(make_project, fixture_libs):
    r = build(make_project(SMALL_BOARD_PY + 'b.zone("GND", layer="B.Cu")\n'))
    errors = [f.to_json() for f in r.findings if f.severity == "error"]
    assert r.verdict == "ok", errors
    assert [t.step for t in r.timings][7:13] == ["erc", "netlist", "schematic svg", "drc", "svg", "glb"]
    assert r.counts["unrouted"] > 0 and set(r.artifacts["svg"]) >= {"F.Cu", "B.Cu", "Edge.Cuts", "F.SilkS"}


@pytest.mark.kicad_cli
def test_kicad_build_in_a_non_ascii_path_keeps_out_of_home(tmp_path, fixture_libs, monkeypatch):
    home = tmp_path / "fakehome"; home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    for k in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"):
        monkeypatch.delenv(k, raising=False)
    p = write_project(tmp_path / "placa ação", SMALL_BOARD_PY)
    r = build(p)
    assert r.verdict == "ok", [f.to_json() for f in r.findings if f.severity == "error"]
    assert [f for f in home.rglob("*")] == []
    assert any((p / ".pino/kicad/config").rglob("*.json"))


def test_a_model_file_added_later_is_seen(make_project, tmp_path, monkeypatch):
    import shutil
    from helpers import FIXTURES
    libs = shutil.copytree(FIXTURES / "libs", tmp_path / "libs")
    for kind, d in (("SYMBOL", "symbols"), ("FOOTPRINT", "footprints"), ("3DMODEL", "3dmodels")):
        monkeypatch.setenv(f"PINO_KICAD_{kind}_DIR", str(libs / d))
    p = make_project(SMALL_BOARD_PY)
    first = build(p, NO_KICAD)
    assert any(f.code == "model3d_missing" for f in first.findings)
    (libs / "3dmodels/pino_test.3dshapes/LED_0603_missing.step").write_text("placeholder")
    second = build(p, NO_KICAD)
    assert not second.cached and second.hash != first.hash and not any(f.code == "model3d_missing" for f in second.findings)


def test_prune_spares_a_build_that_is_still_finishing(tmp_path):
    from pino_kernel.build import _prune
    from pino_kernel.history import History
    h = History(tmp_path)
    done = h.next_number(); h.record(done, "aaaaaaaaaaaa", "ok")
    running = h.next_number(); h.mark(running, "bbbbbbbbbbbb")       # renamed into place, not yet recorded
    for name in ("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"):
        (tmp_path / ".pino/build" / name).mkdir(parents=True)
    _prune(h, tmp_path / ".pino/build", 1, None, None)
    assert sorted(d.name for d in (tmp_path / ".pino/build").iterdir()) == ["aaaaaaaaaaaa", "bbbbbbbbbbbb"]
