"""Every kicad-cli call pino makes.

Each call runs with no display (DISPLAY and WAYLAND_DISPLAY removed), with KiCad's config
and cache in an isolated home under the project's .pino/, and with the library path
variables passed in both as environment and as -D where the subcommand takes it. Paths are
list items, never passed through a shell. Each call deletes its output first, so a failed
run cannot leave the last build's report behind.
"""

from __future__ import annotations

import os
import shlex
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from .libraries import Libraries

OUTPUT_TAIL = 2000


@dataclass
class CliRun:
    step: str
    argv: list[str]
    seconds: float
    returncode: int
    output: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    def last_line(self) -> str:
        lines = [ln for ln in self.output.strip().splitlines() if ln.strip()]
        return lines[-1] if lines else ""


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    elif path.exists() or path.is_symlink():
        path.unlink()


class KicadCli:
    def __init__(self, libraries: Libraries, home: Path, argv0: Sequence[str]):
        self.libraries = libraries
        self.home = Path(home)
        self.argv0 = list(argv0)
        self._takes_define: dict[tuple[str, ...], bool] = {}

    @staticmethod
    def find(env: Mapping[str, str] = os.environ) -> list[str] | None:
        """PINO_KICAD_CLI when set (it wins, even when it does not resolve), else kicad-cli on PATH."""
        explicit = env.get("PINO_KICAD_CLI")
        if explicit:
            words = shlex.split(explicit)
            if not words:
                return None
            first = words[0]
            if shutil.which(first, path=env.get("PATH")) or (Path(first).is_file() and os.access(first, os.X_OK)):
                return words
            return None
        found = shutil.which("kicad-cli", path=env.get("PATH"))
        return [found] if found else None

    def env(self) -> dict[str, str]:
        env = {k: v for k, v in os.environ.items() if k not in ("DISPLAY", "WAYLAND_DISPLAY")}
        config, cache = self.home / "config", self.home / "cache"
        config.mkdir(parents=True, exist_ok=True)
        cache.mkdir(parents=True, exist_ok=True)
        env["KICAD_CONFIG_HOME"] = str(config)
        env["XDG_CACHE_HOME"] = str(cache)
        env.update(self.libraries.path_vars())
        return env

    def run(self, step: str, *args: str, timeout: float = 120.0) -> CliRun:
        argv = [*self.argv0, *map(str, args)]
        start = time.perf_counter()
        proc = subprocess.Popen(argv, env=self.env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                stdin=subprocess.DEVNULL, text=True, start_new_session=True)
        try:
            out, err = proc.communicate(timeout=timeout)
            code, output = proc.returncode, (out or "") + (err or "")
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)  # only the group this call started
            except ProcessLookupError:
                pass
            proc.communicate()
            code, output = -9, f"timed out after {timeout:g} s"
        return CliRun(step, argv, time.perf_counter() - start, code, output[-OUTPUT_TAIL:])

    def _defines(self, words: tuple[str, ...]) -> list[str]:
        if words not in self._takes_define:
            probe = self.run("help", *words, "--help", timeout=30.0)
            self._takes_define[words] = "--define-var" in probe.output
        if not self._takes_define[words]:
            return []
        out: list[str] = []
        for k, v in sorted(self.libraries.path_vars().items()):
            out += ["-D", f"{k}={v}"]
        return out

    def _call(self, step: str, words: tuple[str, ...], flags: Sequence[str], output: Path | None, target: Path,
              *, output_is_dir: bool = False, timeout: float = 120.0) -> CliRun:
        args = [*words, *flags, *self._defines(words)]
        if output is not None:
            _remove(output)
            if output_is_dir:
                output.mkdir(parents=True, exist_ok=True)
                args += ["-o", str(output) + os.sep]
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                args += ["-o", str(output)]
        args.append(str(target))
        return self.run(step, *args, timeout=timeout)

    def version(self) -> str:
        run = self.run("version", "version", timeout=30.0)
        return run.output.strip().splitlines()[0].strip() if run.ok and run.output.strip() else ""

    def erc(self, sch: Path, out: Path) -> CliRun:
        return self._call("erc", ("sch", "erc"), ["--format", "json", "--severity-all"], out, sch)

    def netlist(self, sch: Path, out: Path) -> CliRun:
        return self._call("netlist", ("sch", "export", "netlist"), ["--format", "kicadxml"], out, sch)

    def sch_svg(self, sch: Path, out_dir: Path) -> CliRun:
        return self._call("schematic svg", ("sch", "export", "svg"), [], out_dir, sch, output_is_dir=True)

    def drc(self, pcb: Path, out: Path, *, refill: bool = False, save: bool = False, parity: bool = False) -> CliRun:
        flags = ["--format", "json", "--severity-all"]
        flags += ["--refill-zones"] if refill else []
        flags += ["--save-board"] if save else []
        flags += ["--schematic-parity"] if parity else []
        return self._call("drc", ("pcb", "drc"), flags, out, pcb, timeout=300.0)

    def pcb_svg(self, pcb: Path, out_dir: Path, layers: Sequence[str]) -> CliRun:
        words = ("pcb", "export", "svg")
        if self._has_flag(words, "--mode-multi"):
            flags = ["--mode-multi", "--exclude-drawing-sheet", "--page-size-mode", "2", "-l", ",".join(layers)]
            return self._call("svg", words, flags, out_dir, pcb, output_is_dir=True)
        _remove(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        runs = []
        for layer in layers:
            flags = ["--mode-single", "--exclude-drawing-sheet", "--page-size-mode", "2", "-l", layer]
            runs.append(self._call("svg", words, flags, out_dir / f"board-{layer.replace('.', '_')}.svg", pcb))
        bad = [r for r in runs if not r.ok]
        first = bad[0] if bad else runs[-1]
        return CliRun("svg", first.argv, sum(r.seconds for r in runs), first.returncode, first.output)

    def _has_flag(self, words: tuple[str, ...], flag: str) -> bool:
        key = (*words, flag)
        if key not in self._takes_define:
            self._takes_define[key] = flag in self.run("help", *words, "--help", timeout=30.0).output
        return self._takes_define[key]

    def glb(self, pcb: Path, out: Path) -> CliRun:
        flags = ["--include-tracks", "--include-pads", "--include-zones", "--include-silkscreen",
                 "--include-soldermask"]
        return self._call("glb", ("pcb", "export", "glb"), flags, out, pcb)

    def render(self, pcb: Path, out: Path, *, side: str = "top", width: int = 1600, height: int = 1200) -> CliRun:
        flags = ["--side", side, "--width", str(width), "--height", str(height), "--quality", "basic"]
        return self._call("render", ("pcb", "render"), flags, out, pcb)

    def sch_upgrade(self, sch: Path) -> CliRun:
        return self._call("upgrade", ("sch", "upgrade"), ["--force"], None, sch)
