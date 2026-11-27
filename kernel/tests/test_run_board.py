import sys
import time

import pytest
from helpers import SMALL_BOARD_PY, small_board_py
from pino_kernel.run_board import run_board


def test_good_board(make_project, fixture_libs):
    r = run_board(make_project(SMALL_BOARD_PY), libraries=fixture_libs)
    assert r.problems == [] and r.circuit.parts[0].ref == "J1" and r.seconds > 0


@pytest.mark.parametrize("quiet", [True, False])
def test_the_runner_writes_bytecode_only_when_its_parent_does(make_project, fixture_libs, monkeypatch, quiet):
    # The packaged app's engine writes none beside its sources, and -I does not read PYTHONDONTWRITEBYTECODE.
    monkeypatch.setattr(sys, "dont_write_bytecode", quiet)
    board = "import sys\nsys.stderr.write(f'quiet={sys.flags.dont_write_bytecode}')\n" + SMALL_BOARD_PY
    r = run_board(make_project(board), libraries=fixture_libs)
    assert r.problems == [] and f"quiet={int(quiet)}" in r.log


def test_syntax_error_has_file_and_line(make_project, fixture_libs):
    r = run_board(make_project("from pino import Board\n\nb = Board(\n"), libraries=fixture_libs)
    assert r.circuit is None and r.problems[0].file == "board.py" and r.problems[0].line == 3
    assert r.problems[0].message.startswith("SyntaxError")


def test_exception_points_at_board_py_line(make_project, fixture_libs):
    r = run_board(make_project("x = 1\ny = 2\nz = 1 / 0\n"), libraries=fixture_libs)
    assert (r.problems[0].line, r.problems[0].message) == (3, "ZeroDivisionError: division by zero")
    assert len(r.problems) == 1 and r.problems[0].file == "board.py"


def test_exception_in_a_helper_points_at_board_py_frame_inside_the_project(make_project, fixture_libs):
    r = run_board(make_project("import helper_mod\n\nhelper_mod.boom()\n", extra={"helper_mod.py": "def boom():\n    raise ValueError('bad value')\n"}),
                  libraries=fixture_libs)
    assert (r.problems[0].file, r.problems[0].line, r.problems[0].message) == ("helper_mod.py", 2, "ValueError: bad value")


def test_circuit_errors_keep_their_lines(make_project, fixture_libs):
    r = run_board(make_project(small_board_py(led_nets=False)), libraries=fixture_libs)
    assert r.circuit is None and len(r.problems) == 2
    assert all(p.file == "board.py" and p.line == 15 for p in r.problems)


def test_circuit_error_at_a_call(make_project, fixture_libs):
    r = run_board(make_project(SMALL_BOARD_PY + 'b.part("U2")["NOPE"]\n'), libraries=fixture_libs)
    assert r.problems[0].line == SMALL_BOARD_PY.count("\n") + 1 and "no pin 'NOPE'" in r.problems[0].message


def test_no_board_and_two_boards(make_project, fixture_libs):
    r = run_board(make_project("x = 1\n"), libraries=fixture_libs)
    assert r.problems[0].message == "board.py made no Board"
    two = SMALL_BOARD_PY + "b2 = Board('other', outline=(10, 10))\n"
    r = run_board(make_project(two, name="two"), libraries=fixture_libs)
    assert r.problems[0].message == "board.py made 2 Boards; pino builds one"


def test_hang_is_stopped(make_project, fixture_libs):
    t = time.monotonic()
    r = run_board(make_project("while True:\n    pass\n"), libraries=fixture_libs, timeout=1.0)
    assert r.problems[0].message == "board.py did not finish in 1 s" and time.monotonic() - t < 5


def test_hard_exit_is_reported(make_project, fixture_libs):
    r = run_board(make_project("import os, sys\nprint('going', file=sys.stderr)\nos._exit(3)\n"), libraries=fixture_libs)
    assert r.problems[0].message == "board.py stopped the engine's runner: going"


def test_prints_do_not_break_the_result(make_project, fixture_libs):
    r = run_board(make_project('print("hello")\n' + SMALL_BOARD_PY), libraries=fixture_libs)
    assert r.circuit is not None and "hello" in r.log


def test_board_py_imports_a_sibling_module(make_project, fixture_libs):
    project = make_project("from helpers_here import VALUE\nopen('note.txt').read()\n" + SMALL_BOARD_PY.replace('"10k"', "VALUE"),
                           extra={"helpers_here.py": 'VALUE = "4.7k"\n', "note.txt": "x"})
    assert run_board(project, libraries=fixture_libs).circuit.part("R1").value == "4.7k"


def test_a_hung_board_py_stops_itself_without_the_parent(make_project, fixture_libs):
    import os
    import subprocess
    import sys
    project = make_project("while True:\n    pass\n")
    env = {**os.environ, "PINO_RUNNER_CPU_SECONDS": "1"}
    t = time.monotonic()
    p = subprocess.run([sys.executable, "-I", "-m", "pino_kernel.runner", str(project / "board.py")], env=env,
                       capture_output=True, timeout=30)
    assert p.returncode != 0 and time.monotonic() - t < 10
