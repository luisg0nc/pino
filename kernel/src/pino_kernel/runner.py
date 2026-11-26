"""The child side: run one board.py and print its circuit as one JSON object.

    python -I -m pino_kernel.runner <board.py>

Prints exactly one JSON object on the real stdout: {"ok": true, "circuit": {...}} or
{"ok": false, "problems": [{"message", "file", "line"}]}. board.py's own prints go to stderr.
"""

from __future__ import annotations

import json
import os
import runpy
import sys
import traceback
from pathlib import Path


def _problem(message: str, file: str | None, line: int | None) -> dict:
    return {"message": message, "file": file, "line": line}


def _inside(path: str | None, folder: Path) -> bool:
    if not path:
        return False
    try:
        Path(path).resolve().relative_to(folder)
        return True
    except ValueError:
        return False


def _exception_problem(exc: BaseException, folder: Path, board: Path) -> dict:
    message = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
    frames = traceback.extract_tb(exc.__traceback__)
    inside = [f for f in frames if _inside(f.filename, folder)]
    if inside:
        f = inside[-1]
        return _problem(message, f.filename, f.lineno)
    return _problem(message, str(board), None)


def run(board_path: str) -> dict:
    board = Path(board_path).resolve()
    folder = board.parent
    sys.path.insert(0, str(folder))
    os.chdir(folder)
    from pino.board import _BOARDS, CircuitError

    try:
        runpy.run_path(str(board), run_name="__main__")
    except SyntaxError as e:
        return {"ok": False, "problems": [_problem(f"SyntaxError: {e.msg}", e.filename or str(board), e.lineno)]}
    except CircuitError as e:
        return {"ok": False, "problems": [_problem(p.message, p.file, p.line) for p in e.problems]}
    except SystemExit as e:
        if e.code not in (None, 0):
            return {"ok": False, "problems": [_problem(f"board.py called sys.exit({e.code!r})", str(board), None)]}
    except BaseException as e:  # noqa: BLE001 - every failure of board.py becomes a problem
        return {"ok": False, "problems": [_exception_problem(e, folder, board)]}
    if not _BOARDS:
        return {"ok": False, "problems": [_problem("board.py made no Board", str(board), None)]}
    if len(_BOARDS) > 1:
        lines = [b._where[1] for b in _BOARDS]
        return {"ok": False, "problems": [_problem(f"board.py made {len(_BOARDS)} Boards; pino builds one",
                                                   _BOARDS[1]._where[0], lines[1])]}
    try:
        circuit = _BOARDS[0].to_circuit()
    except CircuitError as e:
        return {"ok": False, "problems": [_problem(p.message, p.file, p.line) for p in e.problems]}
    except BaseException as e:  # noqa: BLE001
        return {"ok": False, "problems": [_exception_problem(e, folder, board)]}
    return {"ok": True, "circuit": json.loads(circuit.to_json())}


def _limit_cpu() -> None:
    """The parent stops a hung board.py at its timeout; this limit stops it too if the parent is gone
    (the app quit mid-build), so it never spins on a core with no one waiting."""
    seconds = os.environ.get("PINO_RUNNER_CPU_SECONDS")
    if seconds:
        import resource

        n = max(1, int(float(seconds)))
        resource.setrlimit(resource.RLIMIT_CPU, (n, n + 1))


def main() -> None:
    _limit_cpu()
    real = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)  # anything board.py prints, even from C code, goes to stderr
    sys.stdout = sys.stderr
    if len(sys.argv) != 2:
        result = {"ok": False, "problems": [_problem("usage: python -m pino_kernel.runner <board.py>", None, None)]}
    else:
        result = run(sys.argv[1])
    real.write(json.dumps(result, ensure_ascii=False) + "\n")
    real.flush()


if __name__ == "__main__":
    main()
