"""Gerbers, drill files and the zip: the board frame, no dates, the same bytes every time."""

import io
import re
import shutil
import sys
import zipfile

import pytest

from pino_kernel.kicad_cli import KicadCli
from pino_kernel.libraries import discover
from pino_kernel.normalize import normalize
from pino_kernel.release.gerbers import ExportError, export, fab_layers, slug, zip_bytes


def test_slug():
    assert slug("Placa ação #2") == "placa-acao-2" and slug("***") == "board" and slug("") == "board"
    assert slug("../../etc") == "etc" and len(slug("x" * 200)) == 60


def test_fab_layers():
    assert fab_layers(2) == ["F.Cu", "B.Cu", "F.Paste", "B.Paste", "F.Silkscreen", "B.Silkscreen", "F.Mask", "B.Mask",
                             "Edge.Cuts"]
    assert fab_layers(4)[:4] == ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]


def test_zip_is_the_same_bytes_and_sorted():
    a = zip_bytes({"b.gtl": b"1" * 100, "a.drl": b"2"})
    b = zip_bytes({"a.drl": b"2", "b.gtl": b"1" * 100})
    assert a == b
    infos = zipfile.ZipFile(io.BytesIO(a)).infolist()
    assert [i.filename for i in infos] == ["a.drl", "b.gtl"]
    assert all(i.date_time == (1980, 1, 1, 0, 0, 0) and i.compress_type == zipfile.ZIP_DEFLATED for i in infos)
    assert all(i.create_system == 3 and i.external_attr == 0o644 << 16 for i in infos)


GERBER = """%TF.GenerationSoftware,KiCad,Pcbnew,10.0.6*%
%TF.CreationDate,2026-11-26T10:00:00+00:00*%
G04 Created by KiCad (PCBNEW 10.0.6) date 2026-11-26 10:00:00*
%MOMM*%
M02*
"""
DRILL = """M48
; DRILL file KiCad 10.0.6 date 2026-11-26T10:00:00
; #@! TF.CreationDate,2026-11-26T10:00:00+00:00
FMAT,2
METRIC
M30
"""


@pytest.mark.parametrize("name,text", [("x.gtl", GERBER), ("x.gm1", GERBER), ("x.g2", GERBER), ("x.gbs", GERBER),
                                       ("x-PTH.drl", DRILL)])
def test_normalize_gerber_and_drill_dates(tmp_path, name, text):
    (tmp_path / name).write_text(text)
    normalize(tmp_path / name)
    out = (tmp_path / name).read_text()
    assert "2026" not in out and "10.0.6" in out and out.count("\n") == text.count("\n")
    if name.endswith(".drl"):
        assert "; DRILL file KiCad 10.0.6\n" in out and "; #@! TF.CreationDate,2000-01-01T00:00:00+00:00\n" in out
    else:
        assert "%TF.CreationDate,2000-01-01T00:00:00+00:00*%\n" in out and "G04 Created by KiCad (PCBNEW 10.0.6)*\n" in out


def fake_cli(tmp_path, fixture_libs):
    from conftest import FAKE_KICAD

    return KicadCli(fixture_libs, tmp_path / "home", [sys.executable, str(FAKE_KICAD)])


def test_export_with_the_fake_cli(tmp_path, fixture_libs):
    work = tmp_path / "work"
    work.mkdir()
    (work / "blinky.kicad_pcb").write_text("(kicad_pcb)")
    files = export(fake_cli(tmp_path, fixture_libs), work, "blinky", 2)
    assert {"blinky-F_Cu.gtl", "blinky-B_Cu.gbl", "blinky-Edge_Cuts.gm1", "blinky-PTH.drl", "blinky-NPTH.drl"} <= set(files)
    assert len(files) == 11 and not [n for n in files if n.endswith(".gbrjob")]
    assert all(b"2026" not in data for data in files.values())
    assert list(files) == sorted(files)


def test_a_failed_export_says_why(tmp_path, fixture_libs, monkeypatch):
    monkeypatch.setenv("FAKE_KICAD_EXPORT_FAIL", "Failed to load board")
    work = tmp_path / "work"
    work.mkdir()
    (work / "b.kicad_pcb").write_text("(kicad_pcb)")
    with pytest.raises(ExportError, match="Failed to load board"):
        export(fake_cli(tmp_path, fixture_libs), work, "b", 2)


def test_an_export_that_writes_too_little_fails(tmp_path, fixture_libs, monkeypatch):
    monkeypatch.setenv("FAKE_KICAD_EXPORT_SKIP", "Edge_Cuts")
    work = tmp_path / "work"
    work.mkdir()
    (work / "b.kicad_pcb").write_text("(kicad_pcb)")
    with pytest.raises(ExportError, match="b-Edge_Cuts.gm1"):
        export(fake_cli(tmp_path, fixture_libs), work, "b", 2)


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
@pytest.mark.parametrize("layers", [2, 4])
def test_real_export_twice_same_bytes(kicad, tmp_path, layers):
    from test_board_writer import write_real_board

    pcb = write_real_board(tmp_path, layers)
    exports = []
    for name in ("one", "two"):
        work = tmp_path / name
        work.mkdir()
        for suffix in (".kicad_pcb", ".kicad_pro", ".kicad_dru"):
            shutil.copy(pcb.with_suffix(suffix), work / f"small{suffix}")
        exports.append(export(kicad, work, "small", layers))
    assert exports[0] == exports[1] and len(exports[0]) == len(fab_layers(layers)) + 2
    # the drill and place origin is the outline centre: the 40 x 30 board's edges lie at x ±20 and y ±15 mm
    edge = exports[0]["small-Edge_Cuts.gm1"].decode()
    xs = [int(v) / 1e6 for v in re.findall(r"^X(-?\d+)Y-?\d+(?:I-?\d+J-?\d+)?D0[12]\*", edge, re.M)]
    ys = [int(v) / 1e6 for v in re.findall(r"^X-?\d+Y(-?\d+)(?:I-?\d+J-?\d+)?D0[12]\*", edge, re.M)]
    assert (min(xs), max(xs), min(ys), max(ys)) == (-20, 20, -15, 15)
