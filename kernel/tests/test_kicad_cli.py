import json
import sys
from pathlib import Path

import pytest

from pino_kernel.kicad_cli import KicadCli
from pino_kernel.libraries import discover

FAKE = Path(__file__).resolve().parent / "fake_kicad_cli.py"


def make(tmp_path, libs):
    return KicadCli(libs, tmp_path / "home", [sys.executable, str(FAKE)])


def first_json(run):
    return json.loads(run.output.splitlines()[0])


def test_environment_has_no_display_and_an_isolated_home(tmp_path, fixture_libs, monkeypatch):
    monkeypatch.setenv("DISPLAY", ":0"); monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    run = make(tmp_path, fixture_libs).erc(tmp_path / "board.kicad_sch", tmp_path / "erc.json")
    seen = first_json(run)
    assert seen["env"]["DISPLAY"] is None and seen["env"]["WAYLAND_DISPLAY"] is None
    assert seen["env"]["KICAD_CONFIG_HOME"] == str(tmp_path / "home" / "config")
    assert f"KICAD10_SYMBOL_DIR={fixture_libs.symbols}" in seen["argv"]
    assert seen["argv"][:4] == ["sch", "erc", "--format", "json"] and "--severity-all" in seen["argv"]


def test_stale_report_is_deleted_first(tmp_path, fixture_libs):
    out = tmp_path / "erc.json"; out.write_text("{}")
    make(tmp_path, fixture_libs).erc(tmp_path / "board.kicad_sch", out)
    assert not out.exists()


def test_glb_flags_match_the_spec(tmp_path, fixture_libs):
    argv = first_json(make(tmp_path, fixture_libs).glb(tmp_path / "b.kicad_pcb", tmp_path / "b.glb"))["argv"]
    for flag in ("--include-tracks", "--include-pads", "--include-zones", "--include-silkscreen", "--include-soldermask"):
        assert flag in argv


def test_drc_flags(tmp_path, fixture_libs):
    run = make(tmp_path, fixture_libs).drc(tmp_path / "b.kicad_pcb", tmp_path / "d.json", refill=True, save=True, parity=True)
    argv = first_json(run)["argv"]
    assert {"--refill-zones", "--save-board", "--schematic-parity", "--severity-all"} <= set(argv)


def test_paths_with_spaces_stay_one_argument(tmp_path, fixture_libs):
    pcb = tmp_path / "my board ação" / "b.kicad_pcb"
    argv = first_json(make(tmp_path, fixture_libs).drc(pcb, tmp_path / "d.json"))["argv"]
    assert argv[-1] == str(pcb)


def test_timeout_kills_the_child_and_says_so(tmp_path, fixture_libs):
    run = make(tmp_path, fixture_libs).run("sleep", "sleep", timeout=1.0)
    assert run.returncode != 0 and "timed out after 1 s" in run.output and run.seconds < 5


def test_find_honours_pino_kicad_cli(tmp_path):
    assert KicadCli.find({"PINO_KICAD_CLI": f"{sys.executable} {FAKE}", "PATH": ""}) == [sys.executable, str(FAKE)]
    assert KicadCli.find({"PINO_KICAD_CLI": "/nowhere/kicad-cli", "PATH": ""}) is None


@pytest.mark.kicad_cli
def test_real_version_is_10(tmp_path):
    libs = discover(); cli = KicadCli(libs, tmp_path / "home", KicadCli.find())
    assert cli.version().startswith("10.")
