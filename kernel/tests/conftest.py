import os
import shutil
import socket
from pathlib import Path

import pytest

TESTS = Path(__file__).resolve().parent
FIXTURES = TESTS / "fixtures"


@pytest.fixture(autouse=True, scope="session")
def _no_display():
    """No test may open a window: drop the display variables for the whole run."""
    saved = {k: os.environ.pop(k) for k in ("DISPLAY", "WAYLAND_DISPLAY") if k in os.environ}
    yield
    os.environ.update(saved)


def _kicad_cli_found() -> bool:
    from pino_kernel.kicad_cli import KicadCli

    return KicadCli.find() is not None


def _kicad_libs_found() -> bool:
    from pino_kernel.libraries import LibrariesNotFound, discover

    env = {k: v for k, v in os.environ.items() if not k.startswith("PINO_KICAD_")}
    try:
        discover(env)
    except LibrariesNotFound:
        return False
    return True


_OUTER_ENV = dict(os.environ)
_REAL_KRT: list = []


def _real_krt():
    """The router installed on this machine (from the environment pytest started in), or None. Read, never installed."""
    if not _REAL_KRT:
        from pino_kernel.routing.krt import RouterMissing, locate

        try:
            _REAL_KRT.append(locate(_OUTER_ENV))
        except RouterMissing:
            _REAL_KRT.append(None)
    return _REAL_KRT[0]


def pytest_runtest_setup(item):
    if item.get_closest_marker("network") and os.environ.get("PINO_TEST_NETWORK") != "1":
        pytest.skip("needs the network: set PINO_TEST_NETWORK=1 to run it")
    if item.get_closest_marker("krt") and _real_krt() is None:
        pytest.skip("KiCadRoutingTools not installed: run uv run --directory kernel pino-kernel router install")
    if item.get_closest_marker("kicad_cli") and not _kicad_cli_found():
        pytest.skip("kicad-cli not found: install KiCad 10 to run this test")
    if item.get_closest_marker("kicad_libs") and not _kicad_libs_found():
        pytest.skip("KiCad's libraries not found")


@pytest.fixture(autouse=True)
def _isolated_router_cache(request, monkeypatch, tmp_path):
    """Every test gets its own pino cache, so no test reads or writes the user's. A `krt` test gets the router
    installed on this machine, read only."""
    monkeypatch.setenv("PINO_CACHE_DIR", str(tmp_path / "pino-cache"))
    for k in ("PINO_KRT_DIR", "PINO_KRT_PYTHON", "PINO_KRT_REPO", "PINO_PARTS_RECORDED", "PINO_JLCSEARCH_URL"):
        monkeypatch.delenv(k, raising=False)
    if request.node.get_closest_marker("krt") and _real_krt() is not None:
        monkeypatch.setenv("PINO_KRT_DIR", str(_real_krt().root))
        monkeypatch.setenv("PINO_KRT_PYTHON", str(_real_krt().python))


@pytest.fixture(autouse=True)
def _no_network(request, monkeypatch):
    """No test asks jlcsearch anything or opens an internet socket (network-marked tests excepted)."""
    monkeypatch.setenv("PINO_PARTS_OFFLINE", "1")
    if request.node.get_closest_marker("network"):
        return
    connect = socket.socket.connect

    def guard(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            raise RuntimeError("network in a test")
        return connect(sock, address)

    monkeypatch.setattr(socket.socket, "connect", guard)


RECORDED = FIXTURES / "parts" / "jlcsearch"


@pytest.fixture
def recorded():
    """The folder of recorded and hand-made jlcsearch answers."""
    return RECORDED


@pytest.fixture
def recorded_env(monkeypatch):
    """Parts lookups (here and in child processes) read the recorded answers."""
    monkeypatch.setenv("PINO_PARTS_RECORDED", str(RECORDED))
    monkeypatch.delenv("PINO_PARTS_OFFLINE", raising=False)
    return RECORDED


@pytest.fixture
def parts_cache(tmp_path):
    """A PartsCache in tmp_path; set .now to move its clock."""
    from pino_kernel.parts.cache import PartsCache

    return PartsCache(tmp_path / "parts-cache")


@pytest.fixture
def fake_krt(tmp_path, monkeypatch):
    """A copy of tests/fake_krt in tmp_path, used as the router through PINO_KRT_DIR."""
    import sys
    from types import SimpleNamespace

    root = tmp_path / "fake_krt"
    shutil.copytree(TESTS / "fake_krt", root, ignore=shutil.ignore_patterns("__pycache__"))
    env = {"PINO_KRT_DIR": str(root), "PINO_KRT_PYTHON": sys.executable, "PINO_CACHE_DIR": str(tmp_path / "pino-cache")}
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    return SimpleNamespace(root=root, env=env)


@pytest.fixture
def argv_log(tmp_path, monkeypatch):
    """argv_log() -> every fake router call so far, as {"script", "argv", "cwd"}."""
    import json

    path = tmp_path / "krt-argv.jsonl"
    monkeypatch.setenv("FAKE_KRT_ARGV_LOG", str(path))

    def read() -> list[dict]:
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    return read


@pytest.fixture
def fixture_libs(monkeypatch):
    from pino_kernel.libraries import discover

    libs = FIXTURES / "libs"
    monkeypatch.setenv("PINO_KICAD_SYMBOL_DIR", str(libs / "symbols"))
    monkeypatch.setenv("PINO_KICAD_FOOTPRINT_DIR", str(libs / "footprints"))
    monkeypatch.setenv("PINO_KICAD_3DMODEL_DIR", str(libs / "3dmodels"))
    return discover()


@pytest.fixture
def make_project(tmp_path):
    """make_project(board_py, extra={}, outline=None, name="project") -> a project folder in tmp_path."""

    def make(board_py: str, extra: dict | None = None, outline: str | None = None, name: str = "project") -> Path:
        project = tmp_path / name
        project.mkdir(parents=True)
        (project / "board.py").write_text(board_py, encoding="utf-8")
        if outline is not None:
            (project / "outline.json").write_text(outline, encoding="utf-8")
        for rel, text in (extra or {}).items():
            (project / rel).parent.mkdir(parents=True, exist_ok=True)
            (project / rel).write_text(text, encoding="utf-8")
        return project

    return make


@pytest.fixture
def kicad(tmp_path):
    """The real kicad-cli, with KiCad's own libraries and an isolated KiCad home in tmp_path."""
    from pino_kernel.kicad_cli import KicadCli
    from pino_kernel.libraries import discover

    env = {k: v for k, v in os.environ.items() if not k.startswith("PINO_KICAD_")}
    return KicadCli(discover(env), tmp_path / "kicad-home", KicadCli.find())


@pytest.fixture
def real_libs(monkeypatch):
    """KiCad's own libraries, for board.py code that discovers libraries itself."""
    from pino_kernel.libraries import discover

    for k in ("PINO_KICAD_SYMBOL_DIR", "PINO_KICAD_FOOTPRINT_DIR", "PINO_KICAD_3DMODEL_DIR"):
        monkeypatch.delenv(k, raising=False)
    return discover()


FAKE_KICAD = TESTS / "fake_kicad_cli.py"
CLEAN_DRC = FIXTURES / "route_reports" / "clean.json"


@pytest.fixture
def kicad_fake(monkeypatch):
    """The fake kicad-cli for builds and routes; `pcb drc` gives the canned clean report (FAKE_KICAD_DRC)."""
    import sys

    monkeypatch.setenv("PINO_KICAD_CLI", f"{sys.executable} {FAKE_KICAD}")
    monkeypatch.setenv("FAKE_KICAD_DRC", str(CLEAN_DRC))
    from pino_kernel.build import BuildOptions

    return BuildOptions(kicad=True)


@pytest.fixture
def built_project(make_project, fixture_libs, fake_krt, kicad_fake):
    """built_project(board_py=SMALL_BOARD_PY, name="project") -> a project built once with the fake kicad-cli."""
    from helpers import SMALL_BOARD_PY
    from pino_kernel.build import build

    def make(board_py: str = SMALL_BOARD_PY, name: str = "project") -> Path:
        p = make_project(board_py, name=name)
        r = build(p, kicad_fake)
        assert r.verdict != "failed", r.headline
        return p

    return make


@pytest.fixture
def routed_project(built_project):
    """The small board, built with the fake kicad-cli, with the fake router active (not routed yet)."""
    return built_project()
