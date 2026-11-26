"""The parent side: run board.py in a fresh child process, with a timeout, and read its circuit."""

from __future__ import annotations

import json
import math
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from pino.board import Problem

from .circuit import Circuit, CircuitSchemaError
from .libraries import Libraries

LOG_TAIL = 4000
PARTS_ENV = ("PINO_CACHE_DIR", "XDG_CACHE_HOME", "PINO_PARTS_OFFLINE", "PINO_PARTS_RECORDED")


@dataclass
class RunResult:
    circuit: Circuit | None
    problems: list[Problem] = field(default_factory=list)
    log: str = ""
    seconds: float = 0.0

    @property
    def missing_parts(self) -> list[str]:
        """LCSC numbers board.py named that the parts cache did not hold."""
        found = [p.data["lcsc"] for p in self.problems if p.code == "part_not_cached" and p.data]
        return list(dict.fromkeys(found))


def _relative(file: str | None, project: Path) -> str | None:
    if not file:
        return file
    try:
        return Path(file).resolve().relative_to(project.resolve()).as_posix()
    except ValueError:
        return file


def _env(libraries: Libraries, timeout: float) -> dict[str, str]:
    env = {k: os.environ[k] for k in ("PATH", "HOME", "LANG") if k in os.environ}
    env["PYTHONHASHSEED"] = "0"
    env["PINO_RUNNER_CPU_SECONDS"] = str(int(math.ceil(timeout)) + 1)
    env["PINO_KICAD_SYMBOL_DIR"] = str(libraries.symbols)
    env["PINO_KICAD_FOOTPRINT_DIR"] = str(libraries.footprints)
    env["PINO_KICAD_3DMODEL_DIR"] = str(libraries.models)
    # where the parts cache is: the child only reads it
    env.update({k: os.environ[k] for k in PARTS_ENV if k in os.environ})
    return env


def run_board(project: Path, *, libraries: Libraries, timeout: float = 30.0, python: str = sys.executable) -> RunResult:
    project = Path(project)
    board = project / "board.py"
    if not board.is_file():
        return RunResult(None, [Problem("no board.py in the project folder", "board.py", None)])
    argv = [python, "-I", "-m", "pino_kernel.runner", str(board)]
    start = time.perf_counter()
    proc = subprocess.Popen(argv, cwd=str(project), env=_env(libraries, timeout), stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # only the child's own group
        except ProcessLookupError:
            pass
        out, err = proc.communicate()
        log = err.decode("utf-8", "replace")[-LOG_TAIL:]
        return RunResult(None, [Problem(f"board.py did not finish in {timeout:g} s", "board.py", None)], log,
                         time.perf_counter() - start)
    seconds = time.perf_counter() - start
    log = err.decode("utf-8", "replace")[-LOG_TAIL:]
    text = out.decode("utf-8", "replace").strip()
    data = None
    if text and len(text.splitlines()) == 1:
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            data = None
    if not isinstance(data, dict) or "ok" not in data:
        lines = [ln for ln in log.splitlines() if ln.strip()]
        last = lines[-1].strip() if lines else f"exit code {proc.returncode}"
        return RunResult(None, [Problem(f"board.py stopped the engine's runner: {last}", "board.py", None)], log, seconds)
    if not data["ok"]:
        problems = [Problem(p.get("message", ""), _relative(p.get("file"), project), p.get("line"),
                            p.get("code") or "board_py", p.get("data"))
                    for p in data.get("problems", [])]
        return RunResult(None, problems, log, seconds)
    try:
        circuit = Circuit.from_json(json.dumps(data["circuit"], ensure_ascii=False))
    except (CircuitSchemaError, KeyError, TypeError) as e:
        return RunResult(None, [Problem(f"the engine could not read board.py's circuit: {e}", "board.py", None)],
                         log, seconds)
    circuit.source_file = "board.py"
    return RunResult(circuit, [], log, seconds)
