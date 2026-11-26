"""KiCadRoutingTools (KRT), the router pino runs, managed by pino.

KRT is MIT licensed and is never part of pino: pino fetches it at one pinned commit on first use into the user
cache (`<cache>/krt/<commit12>/`), with its own Python 3.12 venv (numpy, scipy, shapely) and the prebuilt router
core from the matching release, checked by its sha256. pino never builds the core from source. A folder that holds
another KRT version is refused, never run. `PINO_KRT_DIR` and `PINO_KRT_PYTHON` point at a checkout made by hand.

Each KRT script runs as `<python> <root>/<script> ...` in its own process group, with no display, and is killed
(group only) on timeout or cancel.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Mapping, Sequence

from ..findings import Finding

KRT_REPO = "https://github.com/drandyhaas/KiCadRoutingTools"
KRT_COMMIT = "bc48cce8ac603d5300b24eebddd993098a20d0e4"  # tag v0.17.7
KRT_TAG = "v0.17.7"
KRT_VERSION = "0.17.7"
KRT_DEPS = ("numpy==2.5.5", "scipy==1.18.1", "shapely==2.2.0")
KRT_PYTHON = "3.12"
# The prebuilt router core of the v0.17.7 release, by machine, with its sha256.
KRT_CORE = {
    ("Linux", "x86_64"): ("grid_router-linux-x86_64.so",
                          "345201e34cb2d3df1e5d37af8cd0130507712d7e58f510c6bc6edabdf05ec7c0"),
}
ROUTER_ID = f"KiCadRoutingTools {KRT_VERSION} {KRT_COMMIT[:12]}"
FORBIDDEN_FLAGS = ("--visualize", "-V", "--auto", "--display-time")
SCRIPTS = ("route.py", "route_diff.py", "qfn_fanout.py", "route_planes.py", "route_disconnected_planes.py")
LOG_TAIL = 4000
INSTALL_HINT = "run `pino-kernel router install`"
OVERRIDE_HINT = "or set PINO_KRT_DIR and PINO_KRT_PYTHON to a checkout you made yourself"


class RouterMissing(Exception):
    def __init__(self, finding: Finding):
        self.finding = finding
        super().__init__(finding.message)


def _missing(message: str, code: str = "router_missing") -> RouterMissing:
    return RouterMissing(Finding("router", code, "error", message))


@dataclass(frozen=True)
class Krt:
    root: Path
    python: Path
    version: str
    commit: str | None
    flags: dict[str, frozenset[str]] = field(default_factory=dict, compare=False)

    def script(self, name: str) -> Path:
        return self.root / name


@dataclass
class KrtRun:
    step: str
    argv: list[str]
    seconds: float
    returncode: int
    summary: dict | None
    log: str

    def last_line(self) -> str:
        lines = [ln for ln in self.log.strip().splitlines() if ln.strip()]
        return lines[-1] if lines else ""


def cache_root(env: Mapping[str, str] = os.environ) -> Path:
    if env.get("PINO_CACHE_DIR"):
        return Path(env["PINO_CACHE_DIR"])
    if env.get("XDG_CACHE_HOME"):
        return Path(env["XDG_CACHE_HOME"]) / "pino"
    return Path(env.get("HOME") or Path.home()) / ".cache" / "pino"


def _install_dir(env: Mapping[str, str]) -> Path:
    return cache_root(env) / "krt" / KRT_COMMIT[:12]


def _read_version(root: Path) -> str | None:
    try:
        return (root / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return None


def _version_refused(root: Path, found: str) -> RouterMissing:
    return _missing(f"KiCadRoutingTools at {root} is version {found}; pino runs only {KRT_VERSION}. "
                    f"{INSTALL_HINT[0].upper()}{INSTALL_HINT[1:]} to get the pinned one, {OVERRIDE_HINT}.",
                    "router_version")


def _clean_env(env: Mapping[str, str]) -> dict[str, str]:
    out = {k: v for k, v in env.items() if k not in ("DISPLAY", "WAYLAND_DISPLAY")}
    out.update({"PYTHONHASHSEED": "0", "PYTHONDONTWRITEBYTECODE": "1", "SDL_VIDEODRIVER": "dummy",
                "MPLBACKEND": "Agg"})
    return out


_FLAG = re.compile(r"(?<![\w-])(--[a-zA-Z][a-zA-Z0-9-]*)")
_PROBED: dict[tuple[str, str, float], dict[str, frozenset[str]]] = {}


def _probe_flags(root: Path, python: Path, env: Mapping[str, str]) -> dict[str, frozenset[str]]:
    """Each script's options, from its own --help."""
    out = {}
    for name in SCRIPTS:
        if not (root / name).is_file():
            continue
        try:
            p = subprocess.run([str(python), str(root / name), "--help"], cwd=root, env=_clean_env(env),
                               capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL,
                               start_new_session=True)
            out[name] = frozenset(_FLAG.findall(p.stdout + p.stderr))
        except (OSError, subprocess.TimeoutExpired):
            out[name] = frozenset()
    return out


def _override(env: Mapping[str, str]) -> Krt:
    root = Path(env["PINO_KRT_DIR"])
    if env.get("PINO_KRT_PYTHON"):
        python = Path(env["PINO_KRT_PYTHON"])
    elif (root / ".venv" / "bin" / "python").exists():
        python = root / ".venv" / "bin" / "python"
    else:
        python = Path(shutil.which(f"python{KRT_PYTHON}", path=env.get("PATH")) or sys.executable)
    found = _read_version(root)
    if found is None:
        raise _missing(f"PINO_KRT_DIR is set to {root}, but no KiCadRoutingTools checkout is there (no VERSION file). "
                       f"Fix PINO_KRT_DIR, or unset it and {INSTALL_HINT}.")
    if found != KRT_VERSION:
        raise _version_refused(root, found)
    try:
        mtime = max((root / s).stat().st_mtime for s in SCRIPTS if (root / s).exists())
    except ValueError:
        mtime = 0.0
    key = (str(root), str(python), mtime)
    if key not in _PROBED:
        _PROBED[key] = _probe_flags(root, python, env)
    return Krt(root, python, found, None, _PROBED[key])


def _from_cache(env: Mapping[str, str]) -> Krt:
    d = _install_dir(env)
    try:
        stamp = json.loads((d / "stamp.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise _missing(f"KiCadRoutingTools {KRT_VERSION} is not installed (looked in {d}). pino needs it to route: "
                       f"{INSTALL_HINT}, {OVERRIDE_HINT}.") from None
    if stamp.get("commit") != KRT_COMMIT or stamp.get("version") != KRT_VERSION:
        raise _missing(f"the router in {d} was installed from another commit; {INSTALL_HINT} to replace it.")
    root = d / "src"
    found = _read_version(root)
    if found != KRT_VERSION:
        raise _version_refused(root, found or "unknown")
    flags = {k: frozenset(v) for k, v in stamp.get("flags", {}).items()}
    return Krt(root, d / "venv" / "bin" / "python", found, stamp["commit"], flags)


def locate(env: Mapping[str, str] = os.environ) -> Krt:
    if env.get("PINO_KRT_DIR"):
        return _override(env)
    return _from_cache(env)


def check(krt: Krt) -> list[Finding]:
    problems = []
    found = _read_version(krt.root)
    if found != KRT_VERSION:
        problems.append(_version_refused(krt.root, found or "unknown").finding)
        return problems
    if krt.commit is not None and krt.commit != KRT_COMMIT:
        problems.append(Finding("router", "router_version", "error",
                                f"the router at {krt.root} is commit {krt.commit[:12]}; pino runs {KRT_COMMIT[:12]}."))
    code = ("import sys; sys.path.insert(0, sys.argv[1]); import startup_checks; startup_checks.run_all_checks()")
    try:
        p = subprocess.run([str(krt.python), "-c", code, str(krt.root)], cwd=krt.root, env=_clean_env(os.environ),
                           capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL,
                           start_new_session=True)
        ok, tail = p.returncode == 0, (p.stdout + p.stderr).strip().splitlines()[-1:] or [""]
    except (OSError, subprocess.TimeoutExpired) as e:
        ok, tail = False, [str(e)]
    if not ok:
        problems.append(Finding("router", "router_missing", "error",
                                f"KiCadRoutingTools at {krt.root} does not start: {tail[0][:200]}. "
                                f"{INSTALL_HINT[0].upper()}{INSTALL_HINT[1:]} again."))
    return problems


def ensure(env: Mapping[str, str] = os.environ, *, allow_install: bool = True,
           on_line: Callable[[str], None] = lambda s: None, cancel: threading.Event | None = None) -> Krt:
    try:
        return locate(env)
    except RouterMissing as e:
        if not allow_install or e.finding.code != "router_missing" or env.get("PINO_KRT_DIR"):
            raise
    return install(env, on_line=on_line, cancel=cancel)


# --- install ------------------------------------------------------------------------------------------------


def _step(what: str, argv: Sequence[str], *, cwd: Path, env: Mapping[str, str], timeout: float,
          on_line: Callable[[str], None], cancel: threading.Event | None = None) -> None:
    """Run one install command; raise RouterMissing naming `what` when it fails."""
    tail: deque[str] = deque(maxlen=20)
    try:
        proc = subprocess.Popen(list(argv), cwd=cwd, env=dict(env), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, text=True, errors="replace", start_new_session=True)
    except OSError as e:
        raise _missing(f"could not {what}: {e}. {_retry_hint()}") from None
    timer = threading.Timer(timeout, lambda: _kill_group(proc, signal.SIGKILL))
    timer.start()
    stopped = threading.Event()

    def watch() -> None:  # a cancel stops the install step's own group
        while not stopped.wait(0.2):
            if cancel is not None and cancel.is_set():
                _kill_group(proc, signal.SIGKILL)
                return

    threading.Thread(target=watch, daemon=True).start()
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.rstrip("\n")
            if line.strip():
                tail.append(line)
                on_line(line[:300])
        proc.wait()
    finally:
        timer.cancel()
        stopped.set()
    if cancel is not None and cancel.is_set():
        raise _missing(f"the router install was cancelled; {INSTALL_HINT} to finish it.")
    if proc.returncode != 0:
        last = tail[-1] if tail else f"exit code {proc.returncode}"
        raise _missing(f"could not {what}: {last[:200]}. {_retry_hint()}")


def _retry_hint() -> str:
    return (f"pino needs network access once to install its router; {INSTALL_HINT} again when online, "
            f"{OVERRIDE_HINT}.")


def _download_core(dest: Path, on_line: Callable[[str], None]) -> None:
    key = (platform.system(), platform.machine())
    if key not in KRT_CORE:
        raise _missing(f"KiCadRoutingTools {KRT_VERSION} has no prebuilt router core for this machine "
                       f"({key[0]} {key[1]}), and pino does not build it from source; {OVERRIDE_HINT}.")
    asset, sha = KRT_CORE[key]
    url = f"{KRT_REPO}/releases/download/{KRT_TAG}/{asset}"
    on_line(f"downloading {url}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pino-kernel"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise _missing(f"could not download KiCadRoutingTools' router core from {url}: {e}. {_retry_hint()}") from None
    if hashlib.sha256(data).hexdigest() != sha:
        raise _missing(f"the router core downloaded from {url} does not match its pinned sha256, so it was not used. "
                       f"{INSTALL_HINT[0].upper()}{INSTALL_HINT[1:]} again later.")
    dest.write_bytes(data)


def install(env: Mapping[str, str] = os.environ, *, on_line: Callable[[str], None] = lambda s: None,
            timeout: float = 900.0, cancel: threading.Event | None = None) -> Krt:
    krt_dir = cache_root(env) / "krt"
    krt_dir.mkdir(parents=True, exist_ok=True)
    name = KRT_COMMIT[:12]
    final = krt_dir / name
    deadline = time.monotonic() + timeout
    with open(krt_dir / f"{name}.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        cache_env = {k: v for k, v in env.items() if k != "PINO_KRT_DIR"}
        try:
            return _from_cache(cache_env)  # another process finished it while we waited
        except RouterMissing:
            pass
        for stale in krt_dir.glob(f"{name}.tmp-*"):  # we hold the lock: these are cut-off installs
            shutil.rmtree(stale, ignore_errors=True)
        tmp = krt_dir / f"{name}.tmp-{os.getpid()}"
        tmp.mkdir()
        try:
            krt = _install_into(tmp, env, krt_dir, deadline, on_line, cancel)
            if final.exists():
                shutil.rmtree(final)
            tmp.rename(final)
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        finally:
            shutil.rmtree(krt_dir / ".install-cache", ignore_errors=True)
    return Krt(final / "src", final / "venv" / "bin" / "python", krt.version, krt.commit, krt.flags)


def _install_into(tmp: Path, env: Mapping[str, str], krt_dir: Path, deadline: float,
                  on_line: Callable[[str], None], cancel: threading.Event | None = None) -> Krt:
    repo = env.get("PINO_KRT_REPO") or KRT_REPO
    base = {k: v for k, v in env.items() if k not in ("DISPLAY", "WAYLAND_DISPLAY", "VIRTUAL_ENV", "PYTHONPATH")}
    # Everything the install writes stays under <cache>/krt: uv's and pip's caches, and a Python uv downloads.
    base.update({"GIT_TERMINAL_PROMPT": "0", "UV_CACHE_DIR": str(krt_dir / ".install-cache" / "uv"),
                 "PIP_CACHE_DIR": str(krt_dir / ".install-cache" / "pip"),
                 "UV_PYTHON_INSTALL_DIR": str(krt_dir / "python"), "PYTHONDONTWRITEBYTECODE": "1"})

    def left() -> float:
        return max(1.0, deadline - time.monotonic())

    src = tmp / "src"
    git = shutil.which("git", path=env.get("PATH"))
    if git is None:
        raise _missing(f"could not fetch KiCadRoutingTools from {repo}: git is not installed. {_retry_hint()}")
    _step(f"fetch KiCadRoutingTools from {repo}", [git, "init", "-q", str(src)], cwd=tmp, env=base, timeout=left(),
          on_line=on_line, cancel=cancel)
    _step(f"fetch KiCadRoutingTools from {repo}", [git, "-C", str(src), "fetch", "-q", "--depth", "1", repo,
                                                     KRT_COMMIT], cwd=tmp, env=base, timeout=left(), on_line=on_line, cancel=cancel)
    _step(f"fetch KiCadRoutingTools from {repo}", [git, "-C", str(src), "-c", "advice.detachedHead=false",
                                                     "checkout", "-q", "FETCH_HEAD"], cwd=tmp, env=base,
          timeout=left(), on_line=on_line, cancel=cancel)
    found = _read_version(src)
    if found != KRT_VERSION:
        raise _version_refused(src, found or "unknown")
    venv = tmp / "venv"
    uv = shutil.which("uv", path=env.get("PATH"))
    py = venv / "bin" / "python"
    if uv:
        _step(f"make a Python {KRT_PYTHON} environment for KiCadRoutingTools",
              [uv, "venv", "-q", "--python", KRT_PYTHON, str(venv)], cwd=tmp, env=base, timeout=left(),
              on_line=on_line, cancel=cancel)
        _step("install numpy, scipy and shapely for KiCadRoutingTools",
              [uv, "pip", "install", "-q", "--python", str(py), *KRT_DEPS], cwd=tmp, env=base, timeout=left(),
              on_line=on_line, cancel=cancel)
    else:
        python = shutil.which(f"python{KRT_PYTHON}", path=env.get("PATH"))
        if python is None:
            raise _missing(f"could not make a Python {KRT_PYTHON} environment for KiCadRoutingTools: neither uv nor "
                           f"python{KRT_PYTHON} is on PATH. Install one of them, then {INSTALL_HINT} again.")
        _step(f"make a Python {KRT_PYTHON} environment for KiCadRoutingTools", [python, "-m", "venv", str(venv)],
              cwd=tmp, env=base, timeout=left(), on_line=on_line, cancel=cancel)
        _step("install numpy, scipy and shapely for KiCadRoutingTools",
              [str(py), "-m", "pip", "install", "-q", *KRT_DEPS], cwd=tmp, env=base, timeout=left(),
              on_line=on_line, cancel=cancel)
    _download_core(src / "rust_router" / "grid_router.so", on_line)
    krt = Krt(src, py, found, KRT_COMMIT, {})
    problems = check(krt)
    if problems:
        raise RouterMissing(problems[0])
    flags = _probe_flags(src, py, env)
    stamp = {"commit": KRT_COMMIT, "version": KRT_VERSION, "deps": list(KRT_DEPS),
             "flags": {k: sorted(v) for k, v in sorted(flags.items())}}
    (tmp / "stamp.json").write_text(json.dumps(stamp, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return Krt(src, py, found, KRT_COMMIT, flags)


# --- running one script -------------------------------------------------------------------------------------


def krt_env(kicad) -> dict[str, str]:
    """The environment of a KRT step: kicad-cli's (no display, isolated KiCad home, library variables) plus no
    windows, a fixed hash seed, and the kicad-cli folder first on PATH (KRT's plane repair calls kicad-cli)."""
    env = _clean_env(kicad.env())
    first = kicad.argv0[0] if kicad.argv0 else ""
    exe = shutil.which(first, path=env.get("PATH")) if first else None
    if exe and Path(exe).name.startswith("kicad-cli"):
        env["PATH"] = os.pathsep.join([str(Path(exe).parent), env.get("PATH", "")])
    return env


def _kill_group(proc: subprocess.Popen, sig: int) -> None:
    try:
        os.killpg(proc.pid, sig)  # only the group this call started
    except (ProcessLookupError, PermissionError):
        pass


def _stop(proc: subprocess.Popen) -> None:
    """SIGTERM to the child's group, SIGKILL after 5 s."""
    _kill_group(proc, signal.SIGTERM)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        _kill_group(proc, signal.SIGKILL)
        proc.wait()
    _kill_group(proc, signal.SIGKILL)  # anything the step left behind in its group


def run(krt: Krt, step: str, script: str, args: Sequence[str], *, cwd: Path, env: Mapping[str, str], timeout: float,
        on_line: Callable[[str], None], cancel: threading.Event) -> KrtRun:
    bad = [a for a in args if a in FORBIDDEN_FLAGS]
    if bad:
        raise ValueError(f"pino never passes {bad[0]} to KiCadRoutingTools (it opens a window or asks questions)")
    argv = [str(krt.python), str(krt.script(script)), *map(str, args)]
    start = time.monotonic()
    log: deque[str] = deque()
    size = [0]
    summary: list[dict] = []

    def keep(line: str) -> None:
        log.append(line)
        size[0] += len(line) + 1
        while size[0] > LOG_TAIL * 2 and len(log) > 1:
            size[0] -= len(log.popleft()) + 1

    proc = subprocess.Popen(argv, cwd=cwd, env=_clean_env(env), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace",
                            start_new_session=True)

    def read() -> None:
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip("\n")
            keep(line)
            if line.startswith("JSON_SUMMARY: "):
                try:
                    summary.append(json.loads(line[len("JSON_SUMMARY: "):]))
                except ValueError:
                    pass
            try:
                on_line(line)
            except Exception:  # noqa: BLE001 - a listener fault must not stop the router
                pass

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    code: int | None = None
    note = ""
    while code is None:
        try:
            proc.wait(timeout=0.1)
            code = proc.returncode
        except subprocess.TimeoutExpired:
            if cancel.is_set():
                _stop(proc)
                code, note = -15, "cancelled"
            elif time.monotonic() - start > timeout:
                _stop(proc)
                code, note = -9, f"timed out after {timeout:g} s"
    reader.join(timeout=5)
    if note:
        keep(f"pino: {script} {note}")
    text = "\n".join(log)
    return KrtRun(step, argv, time.monotonic() - start, code, summary[-1] if summary else None, text[-LOG_TAIL:])
