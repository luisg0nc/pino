"""Release: the gates, the fab folder, the version, and every wrong moment to ask for one."""

import csv
import fcntl
import hashlib
import json
import shutil
import threading
import zipfile
from pathlib import Path

import jsonschema
import pytest

from helpers import SMALL_BOARD_PY
from pino_kernel.build import BuildOptions, build
from pino_kernel.release.job import ReleaseOptions, readiness, release_project
from pino_kernel.routing.job import route_project
from test_cli import run_cli
from test_serve_jobs import serve

SCHEMA = json.loads((Path(__file__).resolve().parents[1] / "schema" / "release-result-1.schema.json").read_text())
EXTENDED_WHY = "the only regulator in this footprint with stock"


def release_board(name: str = "small", **changes) -> str:
    """The small board as it would go to JLC: U1 extended with a reason, R1 and two caps basic, three parts soldered
    by hand and one left unfitted."""
    swaps = [
        ('Board("small",', f'Board({name!r},'),
        ('footprint="pino_test:USB_Edge")', 'footprint="pino_test:USB_Edge", hand_fit=True)'),
        ('"pino_test:C", "10uF")', '"pino_test:C", "10uF", lcsc="C900003")'),
        ('reg.path("U1", "pino_test:LDO3")', f'reg.path("U1", "pino_test:LDO3", lcsc="C900002", why={EXTENDED_WHY!r})'),
        ('"pino_test:C", "1uF")', '"pino_test:C", "1uF", lcsc="C900003")'),
        ('mcu.path("U2", "pino_test:IC6")', 'mcu.path("U2", "pino_test:IC6", hand_fit=True)'),
        ('"pino_test:C", "100nF")', '"pino_test:C", "100nF", hand_fit=True)'),
        ('"pino_test:R", "10k")', '"pino_test:R", "10k", lcsc="C900001")'),
        ('"pino_test:LED", "green")', '"pino_test:LED", "green", dnp=True)'),
    ]
    text = SMALL_BOARD_PY
    for old, new in swaps:
        assert old in text, old
        text = text.replace(old, new)
    for old, new in changes.get("swap", []):
        assert old in text, old
        text = text.replace(old, new)
    return text


def built_and_routed(project: Path, options) -> None:
    r = build(project, options)
    assert r.verdict == "ok", [f.to_json() for f in r.findings if f.severity == "error"]
    routed = route_project(project)
    assert routed.state == "done" and routed.complete, routed.headline


@pytest.fixture
def released_project(make_project, fixture_libs, fake_krt, kicad_fake, recorded_env):
    """A small board ready to release: built and routed with the fake kicad-cli and router."""
    project = make_project(release_board())
    built_and_routed(project, kicad_fake)
    return project


def edit(project: Path, old: str, new: str) -> None:
    board = project / "board.py"
    text = board.read_text()
    assert old in text, old
    board.write_text(text.replace(old, new))


def tree(folder: Path) -> dict:
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file()}


def codes(result) -> list[str]:
    return [f.code for f in result.findings]


def nothing_half_done(project: Path) -> bool:
    fab = project / "fab"
    left = list((project / ".pino" / "release").glob("*")) if (project / ".pino" / "release").is_dir() else []
    return not left and (not fab.exists() or not list(fab.glob("*.tmp-*")))


def test_release_writes_the_folder(released_project):
    steps = []
    r = release_project(released_project, events=steps.append)
    d = released_project / "fab/v1.0.0"
    assert r.state == "released" and r.version == "1.0.0" and r.folder == "fab/v1.0.0", r.headline
    assert {p.name for p in d.iterdir()} == {"README.md", "manifest.json", "small-v1.0.0-gerbers.zip",
                                             "small-v1.0.0-bom.csv", "small-v1.0.0-cpl.csv", "gerbers"}
    assert [t.step for t in r.timings] == ["gates", "parts", "gerbers", "bom", "cpl", "version", "write"]
    assert [e["step"] for e in steps if e["event"] == "step"] == [t.step for t in r.timings]
    cpl = list(csv.DictReader((d / "small-v1.0.0-cpl.csv").open()))
    assert [row["Designator"] for row in cpl] == ["C1", "C2", "R1", "U1"]
    bom = list(csv.DictReader((d / "small-v1.0.0-bom.csv").open()))
    assert [(row["Designator"], row["JLCPCB Part #"]) for row in bom] == [
        ("C1,C2", "C900003"), ("R1", "C900001"), ("U1", "C900002")]
    assert r.counts == {"assembled": 4, "bom_lines": 3, "hand_fit": 3, "dnp": 1, "basic": 2, "preferred": 0,
                        "extended": 1, "easyeda": 0, "gerbers": 9, "drills": 2}
    assert r.headline == "Release v1.0.0 (h1, r1): JLC places 4 parts in 3 BOM lines, 3 by hand: fab/v1.0.0/"
    zf = zipfile.ZipFile(d / "small-v1.0.0-gerbers.zip")
    assert sorted(zf.namelist()) == sorted(p.name for p in (d / "gerbers").iterdir())
    readme = (d / "README.md").read_text()
    assert "U1 C900002" in readme and EXTENDED_WHY in readme and "—" not in readme
    assert "D1" in readme and "soldered by hand" in readme and "preview" in readme and "2026" not in readme
    manifest = json.loads((d / "manifest.json").read_text())
    assert manifest["schema"] == "pino.fab/1" and manifest["version"] == "1.0.0" and manifest["previous"] is None
    assert manifest["why"] == ["first release"] and manifest["build"]["number"] == 1
    for f in manifest["files"]:
        data = (released_project / f["path"]).read_bytes()
        assert (len(data), hashlib.sha256(data).hexdigest()) == (f["bytes"], f["sha256"])
    assert {f["path"] for f in r.files} == {p.relative_to(released_project).as_posix()
                                           for p in d.rglob("*") if p.is_file()}
    jsonschema.validate(json.loads(r.to_json()), SCHEMA)
    assert nothing_half_done(released_project)


def test_rotation_checks_are_pinned_at_the_parts(released_project):
    r = release_project(released_project)
    checks = [f for f in r.findings if f.code == "rotation_unchecked"]
    assert [f.refs for f in checks] == [("C1",), ("C2",), ("R1",), ("U1",)]     # fixture footprints have no rule
    assert all(f.severity == "info" and f.at.space == "board" and f.source == "release" for f in checks)


def test_same_bytes_from_two_copies(released_project, tmp_path):
    other = tmp_path / "again"
    shutil.copytree(released_project, other)
    release_project(released_project)
    release_project(other)
    assert tree(released_project / "fab/v1.0.0") == tree(other / "fab/v1.0.0")
    text = b"".join(p.read_bytes() for p in (other / "fab").rglob("*") if p.is_file())
    assert str(tmp_path).encode() not in text


def test_second_release_of_the_same_board_is_unchanged(released_project):
    release_project(released_project)
    r = release_project(released_project)
    assert r.state == "unchanged" and r.headline == "Nothing to release: h1 makes the same files as v1.0.0"
    assert r.version is None and [p.name for p in (released_project / "fab").iterdir()] == ["v1.0.0"]
    assert nothing_half_done(released_project)


def test_value_change_is_a_minor_release_from_the_new_board(released_project, kicad_fake):
    release_project(released_project)
    edit(released_project, '"10k", lcsc="C900001"', '"4.7k", lcsc="C900001"')
    assert build(released_project, kicad_fake).routing["state"] == "current"    # values are not part of the copper
    r = release_project(released_project)
    assert (r.state, r.version, r.previous, r.bump) == ("released", "1.1.0", "1.0.0", "minor"), r.headline
    assert r.why == ["R1 value 10k -> 4.7k"]
    assert "Changes since v1.0.0" in (released_project / "fab/v1.1.0/README.md").read_text()
    # the Gerbers come from the newest build's board, not the older one the route was made on
    first = (released_project / "fab/v1.0.0/gerbers/small-F_Cu.gtl").read_bytes()
    assert (released_project / "fab/v1.1.0/gerbers/small-F_Cu.gtl").read_bytes() != first


def test_the_asked_bump_wins_when_the_files_changed(released_project, kicad_fake):
    release_project(released_project)
    edit(released_project, '"10k", lcsc="C900001"', '"4.7k", lcsc="C900001"')
    build(released_project, kicad_fake)
    r = release_project(released_project, ReleaseOptions(bump="major"))
    assert (r.version, r.bump) == ("2.0.0", "major")


def test_refused_without_a_build(tmp_path):
    (tmp_path / "board.py").write_text("x = 1\n")
    r = release_project(tmp_path)
    assert r.state == "refused" and codes(r) == ["release_no_build"] and not (tmp_path / "fab").exists()
    assert r.headline.startswith("Release refused: build the board first")


def test_refused_without_a_route(make_project, fixture_libs, fake_krt, kicad_fake, recorded_env):
    project = make_project(release_board())
    build(project, kicad_fake)
    r = release_project(project)
    assert r.state == "refused" and codes(r)[0] == "release_not_routed" and not (project / "fab").exists()
    assert r.headline == "Release refused: route the board first"
    jsonschema.validate(json.loads(r.to_json()), SCHEMA)


def test_refused_when_copper_is_stale(released_project, kicad_fake):
    edit(released_project, "b.nc(u2.IO2)\n", "b.nc(u2.IO2)\nb.place(r1, at=(9, -6))\n")
    build(released_project, kicad_fake)
    r = release_project(released_project)
    assert r.state == "refused" and codes(r)[0] == "release_stale" and "parts moved" in r.headline, r.headline
    assert r.headline.endswith("route again") and not (released_project / "fab").exists()


def test_refused_when_board_py_changed_since_the_build(released_project):
    edit(released_project, '"10k", lcsc="C900001"', '"4.7k", lcsc="C900001"')
    r = release_project(released_project)
    assert r.state == "refused" and codes(r)[0] == "release_build_stale" and "build again" in r.headline
    assert not (released_project / "fab").exists()


def test_refused_after_a_failed_build(released_project, kicad_fake):
    (released_project / "board.py").write_text("x = (\n")
    build(released_project, kicad_fake)
    r = release_project(released_project)
    assert r.state == "refused" and codes(r)[0] == "release_build_failed"


def test_refused_for_a_build_that_never_ran_kicad(released_project):
    build(released_project, BuildOptions(kicad=False))
    r = release_project(released_project)
    assert r.state == "refused" and "release_build_unchecked" in codes(r)


def test_refused_for_a_build_with_errors(released_project, kicad_fake):
    edit(released_project, "b.nc(u2.IO2)\n", "b.nc(u2.IO2)\nb.expect_apart(u2.IO1, r1[1])\n")
    build(released_project, kicad_fake)
    r = release_project(released_project)
    assert r.state == "refused" and "release_build_errors" in codes(r)


def test_refused_for_a_part_without_a_number_or_a_reason(released_project, kicad_fake):
    edit(released_project, f', why={EXTENDED_WHY!r}', "")
    edit(released_project, ', lcsc="C900001"', "")
    build(released_project, kicad_fake)
    r = release_project(released_project)
    errors = [f for f in r.findings if f.severity == "error"]
    assert r.state == "refused" and sorted(f.code for f in errors) == ["part_extended", "part_no_lcsc"]
    assert all(f.source == "release" and f.at.space == "board" and f.refs for f in errors)
    assert r.headline.startswith("Release refused: 2 errors (") and "R1 has no LCSC number" in r.headline
    assert not (released_project / "fab").exists()


def test_stock_that_cannot_be_confirmed_is_said_not_hidden(released_project, monkeypatch):
    monkeypatch.delenv("PINO_PARTS_RECORDED")
    monkeypatch.setenv("PINO_PARTS_OFFLINE", "1")
    r = release_project(released_project)
    unknown = [f for f in r.findings if f.code == "part_stock_unknown"]
    assert r.state == "released" and len(unknown) == 3 and all(f.severity == "warning" for f in unknown)


def test_release_checks_stock_again(released_project, tmp_path, monkeypatch):
    from pino_kernel.parts.transport import recorded_name
    from conftest import RECORDED

    folder = tmp_path / "recorded"
    shutil.copytree(RECORDED, folder)
    path = folder / recorded_name("https://jlcsearch.tscircuit.com/api/search?q=C900001&limit=1")
    data = json.loads(path.read_text())
    data["body"]["components"][0]["stock"] = 0        # the build's cache still says 100000, and is fresh
    path.write_text(json.dumps(data))
    monkeypatch.setenv("PINO_PARTS_RECORDED", str(folder))
    r = release_project(released_project)
    assert r.state == "refused" and "part_no_stock" in codes(r), r.headline


def test_a_drc_error_on_the_release_board_refuses(released_project, tmp_path, monkeypatch):
    report = {"coordinate_units": "mm", "violations": [{"type": "clearance", "severity": "error",
              "description": "Clearance violation", "items": []}], "unconnected_items": [], "schematic_parity": []}
    (tmp_path / "bad.json").write_text(json.dumps(report))
    monkeypatch.setenv("FAKE_KICAD_DRC", str(tmp_path / "bad.json"))
    r = release_project(released_project)
    assert r.state == "refused" and "release_drc" in codes(r) and not (released_project / "fab").exists()
    assert nothing_half_done(released_project)


def test_a_route_with_nets_left_refuses(released_project):
    route = next((released_project / ".pino/routes").glob("*/route.json"))
    data = json.loads(route.read_text())
    data["complete"] = False
    data["counts"]["unrouted"] = 1
    data["findings"] = [{"source": "route", "code": "net_unrouted", "severity": "error",
                         "message": "net STATUS: 1 connection left", "nets": ["STATUS"]}]
    route.write_text(json.dumps(data))
    r = release_project(released_project)
    assert r.state == "refused" and codes(r)[0] == "release_incomplete" and "STATUS" in r.headline


def test_a_running_route_refuses(released_project):
    with open(released_project / ".pino/routes/job.lock", "a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        r = release_project(released_project)
    assert r.state == "refused" and "release_routing" in codes(r)


@pytest.mark.parametrize("outline,code", [("(8, 8)", "assembly_board_size"), ("(500, 480)", "assembly_board_size")])
def test_a_board_outside_the_assembly_sizes_is_refused(released_project, kicad_fake, monkeypatch, outline, code):
    from pino_kernel.release import job

    w, h = (float(v) for v in outline.strip("()").split(","))
    monkeypatch.setattr(job, "outline_size", lambda circuit: (w, h))
    r = release_project(released_project)
    assert r.state == "refused" and code in codes(r)


def test_parts_on_both_sides_need_standard_assembly(released_project, kicad_fake):
    edit(released_project, "b.nc(u2.IO2)\n", "b.nc(u2.IO2)\nb.place(r1, at=(9, -6), back=True)\n")
    built_and_routed(released_project, kicad_fake)
    r = release_project(released_project)
    two = next(f for f in r.findings if f.code == "assembly_two_sides")
    assert r.state == "released" and two.severity == "warning" and "70 x 70" in two.message
    assert "standard assembly" in (released_project / "fab/v1.0.0/README.md").read_text()


def test_busy_when_a_release_runs(released_project):
    with open(released_project / ".pino/release.lock", "a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        r = release_project(released_project)
    assert r.state == "busy" and "already running" in r.headline and not (released_project / "fab").exists()


def test_never_writes_over_a_folder(released_project):
    (released_project / "fab/v1.0.0").mkdir(parents=True)
    (released_project / "fab/v1.0.0/mine.txt").write_text("x")
    r = release_project(released_project)
    assert r.state == "failed" and "never writes over a release" in r.headline
    assert tree(released_project / "fab") == {"v1.0.0/mine.txt": hashlib.sha256(b"x").hexdigest()}
    assert nothing_half_done(released_project)


def test_an_empty_folder_from_another_hand_is_kept(released_project):
    (released_project / "fab/v1.0.0").mkdir(parents=True)
    r = release_project(released_project)
    assert r.state == "failed" and list((released_project / "fab/v1.0.0").iterdir()) == []


def test_a_fab_folder_that_is_a_link_is_refused(released_project, tmp_path):
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (released_project / "fab").symlink_to(elsewhere)
    r = release_project(released_project)
    assert r.state == "failed" and "link" in r.headline and list(elsewhere.iterdir()) == []


def test_cancel_cleans_up(released_project):
    cancel = threading.Event()

    def events(e):
        if e.get("step") == "gerbers":
            cancel.set()

    r = release_project(released_project, events=events, cancel=cancel)
    assert r.state == "cancelled" and not (released_project / "fab").exists() and nothing_half_done(released_project)


def test_an_engine_fault_is_a_failed_release(released_project, monkeypatch):
    from pino_kernel.release import job

    def boom(*a, **kw):
        raise RuntimeError("boom")

    monkeypatch.setattr(job, "export", boom)
    r = release_project(released_project)
    assert r.state == "failed" and "internal_error" in codes(r) and not (released_project / "fab").exists()
    assert nothing_half_done(released_project)


def test_leftovers_of_a_killed_release_are_cleared(released_project):
    (released_project / "fab/v1.0.0.tmp-1").mkdir(parents=True)
    (released_project / "fab/keep.tmp").write_text("mine")
    (released_project / ".pino/release/work-1-1").mkdir(parents=True)
    r = release_project(released_project)
    assert r.state == "released" and (released_project / "fab/keep.tmp").read_text() == "mine"
    assert nothing_half_done(released_project)


def test_writes_only_in_dot_pino_and_fab(released_project):
    outside = lambda: {k: v for k, v in tree(released_project).items() if not k.startswith((".pino/", "fab/"))}
    before = outside()
    release_project(released_project)
    assert outside() == before


def test_release_in_a_path_with_spaces_and_accents(tmp_path, fixture_libs, fake_krt, kicad_fake, recorded_env):
    from test_build import write_project

    project = write_project(tmp_path / "my board ação", release_board("Placa ação #2"))
    built_and_routed(project, kicad_fake)
    r = release_project(project)
    assert r.state == "released", r.headline
    z = project / "fab/v1.0.0/placa-acao-2-v1.0.0-gerbers.zip"
    assert z.is_file() and all("/" not in n and n.isascii() for n in zipfile.ZipFile(z).namelist())


def test_dry_run_and_release_status(released_project):
    ready = readiness(released_project)
    assert ready.ready and ready.next_version == "1.0.0" and ready.why == ["first release"] and not ready.blockers
    p = run_cli("release", str(released_project), "--dry-run")
    assert p.returncode == 0 and json.loads(p.stdout) == json.loads(json.dumps(ready.to_json()))
    out = serve([{"id": 1, "op": "release_status", "project": str(released_project)}, {"id": 2, "op": "shutdown"}])
    assert out[0]["ok"] and out[0]["status"] == ready.to_json()
    assert not (released_project / "fab").exists()


def test_readiness_after_a_release(released_project, kicad_fake):
    release_project(released_project)
    again = readiness(released_project)
    assert again.ready and again.next_version is None and again.why == ["the same files as v1.0.0"]
    edit(released_project, '"10k", lcsc="C900001"', '"4.7k", lcsc="C900001"')
    build(released_project, kicad_fake)
    after = readiness(released_project)
    assert (after.next_version, after.bump, after.why) == ("1.1.0", "minor", ["R1 value 10k -> 4.7k"])


def test_cli_events_then_result(released_project):
    p = run_cli("release", str(released_project), "--events")
    lines = [json.loads(line) for line in p.stdout.splitlines()]
    assert p.returncode == 0 and lines[0] == {"event": "step", "step": "gates"}
    assert lines[-1]["event"] == "done" and lines[-1]["result"]["state"] == "released"
    assert run_cli("release", str(released_project)).returncode == 0               # unchanged is fine too


def test_cli_refused_exits_1(tmp_path):
    (tmp_path / "board.py").write_text("x = 1\n")
    p = run_cli("release", str(tmp_path))
    assert p.returncode == 1 and json.loads(p.stdout)["state"] == "refused"


def test_serve_release_job(released_project):
    out = serve([{"id": 5, "op": "release", "project": str(released_project), "options": {"network": True}},
                 {"id": 6, "op": "shutdown"}], wait_for=5)
    mine = [o for o in out if o.get("id") == 5]
    assert mine[-1]["ok"] and mine[-1]["result"]["state"] == "released"
    assert [o["event"]["step"] for o in mine[:-1]][:2] == ["gates", "parts"]


@pytest.mark.parametrize("options,want", [({"bump": "huge"}, "patch, minor or major"), ({"speed": 1}, "unknown option")])
def test_serve_release_bad_options(released_project, options, want):
    out = serve([{"id": 1, "op": "release", "project": str(released_project), "options": options},
                 {"id": 2, "op": "shutdown"}])
    assert out[0]["ok"] is False and want in out[0]["error"]
