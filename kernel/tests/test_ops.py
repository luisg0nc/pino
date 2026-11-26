"""The serve ops beyond ping, build and shutdown: diff between two kept builds."""

import io
import json
import shutil

import pytest

from helpers import SMALL_BOARD_PY
from pino_kernel.build import BuildOptions, build
from pino_kernel.serve import main as serve
from pino_kernel.ops import extra_op

NO_KICAD = BuildOptions(kicad=False)


@pytest.fixture
def two_builds(make_project, fixture_libs):
    """A project built, R1 moved, built again: (project, first hash, second hash)."""
    project = make_project(SMALL_BOARD_PY + "b.place(r1, at=(4, 3))\n")
    a = build(project, NO_KICAD)
    (project / "board.py").write_text(SMALL_BOARD_PY + "b.place(r1, at=(6, 3))\n", encoding="utf-8")
    b = build(project, NO_KICAD)
    assert a.hash and b.hash and a.hash != b.hash
    return project, a.hash, b.hash


def test_diff_between_two_kept_builds(two_builds):
    project, a, b = two_builds
    out = extra_op({"id": 4, "op": "diff", "project": str(project), "from": a, "to": b})
    assert out["id"] == 4 and out["ok"] is True
    assert any("R1" in line for line in out["changes"]["layout"])
    assert isinstance(out["changes"]["circuit"], list)


def test_diff_of_a_pruned_build_says_so(two_builds):
    project, a, b = two_builds
    shutil.rmtree(project / ".pino" / "build" / a)
    assert extra_op({"id": 5, "op": "diff", "project": str(project), "from": a, "to": b}) == {
        "id": 5, "ok": False, "error": f"build {a} is no longer kept"}


@pytest.mark.parametrize("bad", ["../../etc", "ABCDEF012345", "abc", None, 7])
def test_diff_refuses_what_is_not_a_build_hash(two_builds, bad):
    project, _, b = two_builds
    assert extra_op({"id": 6, "op": "diff", "project": str(project), "from": bad, "to": b}) == {
        "id": 6, "ok": False, "error": "not a build hash"}


def test_diff_needs_a_project(two_builds):
    _, a, b = two_builds
    out = extra_op({"id": 8, "op": "diff", "from": a, "to": b})
    assert out["ok"] is False and "project" in out["error"]


def test_other_ops_are_not_extra():
    assert extra_op({"id": 1, "op": "ping"}) is None


def test_serve_answers_diff_in_order(two_builds):
    project, a, b = two_builds
    lines = [{"id": 1, "op": "diff", "project": str(project), "from": a, "to": b}, {"id": 2, "op": "ping"},
             {"id": 3, "op": "nope"}]
    out = io.StringIO()
    serve(io.StringIO("".join(json.dumps(line) + "\n" for line in lines)), out)
    replies = [json.loads(line) for line in out.getvalue().splitlines()]
    assert [r["id"] for r in replies] == [1, 2, 3]
    assert replies[0]["ok"] and "pong" in replies[1] and replies[2]["error"] == "unknown op 'nope'"


def test_pino_kernel_serve_answers_diff(two_builds):
    """The real serve process, which the app talks to, knows diff."""
    from test_serve_jobs import serve as serve_process

    project, a, b = two_builds
    out = serve_process([{"id": 1, "op": "diff", "project": str(project), "from": a, "to": b},
                         {"id": 2, "op": "shutdown"}])
    assert out[0]["id"] == 1 and out[0]["ok"] and any("R1" in line for line in out[0]["changes"]["layout"]), out
