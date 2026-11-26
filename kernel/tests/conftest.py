import os
import shutil
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


def pytest_runtest_setup(item):
    if item.get_closest_marker("kicad_cli") and not _kicad_cli_found():
        pytest.skip("kicad-cli not found: install KiCad 10 to run this test")
    if item.get_closest_marker("kicad_libs") and not _kicad_libs_found():
        pytest.skip("KiCad's libraries not found")


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
