"""The reference board end to end: built, routed with the real router, released to JLC's fab files."""

import csv
import io
import json
import shutil
import zipfile

import pytest

from helpers import FIXTURES
from pino_kernel.build import build
from pino_kernel.release.job import release_project
from pino_kernel.routing.job import route_project

pytestmark = [pytest.mark.kicad_cli, pytest.mark.kicad_libs, pytest.mark.krt]

# every part but R9, which is DNP
ASSEMBLED = {"J1", "F1", "C1", "R1", "R2", "R3", "C2", "C3", "U2", "C4", "U1", "C5", "C6", "R4", "C7", "R5", "SW1",
             "R6", "D1", "R7", "D2"}
EXTENDED = {"J1", "F1", "U2", "U1", "SW1", "D1"}
BOM_COLUMNS = ["Comment", "Designator", "Footprint", "JLCPCB Part #", "Quantity"]
CPL_COLUMNS = ["Designator", "Val", "Package", "Mid X", "Mid Y", "Rotation", "Layer"]


def test_reference_board_to_fab_files(tmp_path, real_libs, recorded_env):
    project = shutil.copytree(FIXTURES / "reference", tmp_path / "reference")
    first = build(project)
    assert first.verdict == "ok", [f.to_json() for f in first.findings if f.severity == "error"]
    assert not [f for f in first.findings if f.source == "parts" and f.code in ("part_no_lcsc", "part_extended")
                and f.severity != "info"]
    routed = route_project(project)
    assert routed.complete, routed.headline
    r = release_project(project)
    print([f"{t.step} {t.seconds:.2f} s" for t in r.timings])
    assert r.state == "released" and r.version == "1.0.0", [f.to_json() for f in r.findings]
    assert (r.counts["assembled"], r.counts["dnp"], r.counts["hand_fit"], r.counts["extended"]) == (21, 1, 0, 6)
    assert r.counts["gerbers"] == 9 and r.counts["drills"] == 2
    d = project / r.folder
    zf = zipfile.ZipFile(d / "pino-reference-v1.0.0-gerbers.zip")
    assert {"pino-reference-F_Cu.gtl", "pino-reference-B_Cu.gbl", "pino-reference-Edge_Cuts.gm1",
            "pino-reference-F_Mask.gts", "pino-reference-F_Silkscreen.gto", "pino-reference-PTH.drl",
            "pino-reference-NPTH.drl"} <= set(zf.namelist())
    cpl_text = (d / "pino-reference-v1.0.0-cpl.csv").read_text()
    cpl = list(csv.DictReader(io.StringIO(cpl_text)))
    assert cpl_text.splitlines()[0].split(",") == CPL_COLUMNS
    assert {row["Designator"] for row in cpl} == ASSEMBLED
    # in the board frame: the 56 x 44 mm board's centre is the origin
    assert all(-28 < float(row["Mid X"]) < 28 and -22 < float(row["Mid Y"]) < 22 for row in cpl)
    bom = list(csv.reader(io.StringIO((d / "pino-reference-v1.0.0-bom.csv").read_text())))
    assert bom[0] == BOM_COLUMNS and all(row[3].startswith("C") for row in bom[1:])
    assert {ref for row in bom[1:] for ref in row[1].split(",")} == ASSEMBLED
    readme = (d / "README.md").read_text()
    assert all(f"- {ref} C" in readme for ref in EXTENDED)
    assert json.loads((d / "manifest.json").read_text())["files"]
    again = release_project(project)
    assert again.state == "unchanged", again.headline
