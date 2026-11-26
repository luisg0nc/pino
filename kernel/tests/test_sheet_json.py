"""sheet.json: what the views hit-test the schematic against (schema pino.sheet/1)."""

import json
import re
import shutil
from pathlib import Path

import jsonschema
import pytest

from helpers import FIXTURES, small_board
from pino_kernel.build import BuildOptions, build
from pino_kernel.libraries import discover
from pino_kernel.run_board import run_board
from pino_kernel.schematic.writer import write_schematic
from pino_kernel.symbols import SymbolLibrary

SCHEMAS = Path(__file__).resolve().parents[1] / "schema"


def load_schema(name: str) -> dict:
    return json.loads((SCHEMAS / name).read_text(encoding="utf-8"))


def natural(text: str):
    return [(0, int(t), "") if t.isdigit() else (1, 0, t) for t in re.split(r"(\d+)", text) if t]


@pytest.fixture
def reference_project(tmp_path, real_libs):
    return shutil.copytree(FIXTURES / "reference", tmp_path / "reference")


@pytest.fixture
def reference_circuit(reference_project):
    run = run_board(reference_project, libraries=discover())
    assert run.circuit is not None, run.problems
    return run.circuit


@pytest.fixture
def real_symbols(real_libs):
    return SymbolLibrary(real_libs.symbols)


def test_sheet_json_has_every_pin_of_every_part_once(fixture_libs):
    circuit = small_board().to_circuit()
    sheet = write_schematic(circuit, SymbolLibrary(fixture_libs.symbols)).sheet
    pins = [(s["ref"], p["number"]) for s in sheet["symbols"] for p in s["pins"]]
    assert sorted(pins) == sorted((part.ref, p.number) for part in circuit.parts for p in part.pins)
    assert len(pins) == len(set(pins))


def test_sheet_lists_are_sorted_and_power_symbols_name_their_nets(fixture_libs):
    circuit = small_board().to_circuit()
    sheet = write_schematic(circuit, SymbolLibrary(fixture_libs.symbols)).sheet
    assert [s["ref"] for s in sheet["symbols"]] == sorted(p.ref for p in circuit.parts)
    for s in sheet["symbols"]:
        assert [p["number"] for p in s["pins"]] == sorted((p["number"] for p in s["pins"]), key=natural)
    assert [w["net"] for w in sheet["wires"]] == sorted(w["net"] for w in sheet["wires"])
    assert {"GND", "VBUS", "+3V3"} <= {p["net"] for p in sheet["power"]}
    assert all(set(lab) == {"net", "x", "y", "global"} for lab in sheet["labels"])
    assert [f["key"] for f in sheet["frames"]] == ["usb", "reg", "mcu"]


def test_sheet_json_matches_its_schema_and_is_deterministic(fixture_libs):
    symbols = SymbolLibrary(fixture_libs.symbols)
    a = write_schematic(small_board().to_circuit(), symbols).sheet
    jsonschema.validate(a, load_schema("sheet-1.schema.json"))
    assert a == write_schematic(small_board().to_circuit(), symbols).sheet
    assert a["schema"] == "pino.sheet/1"


@pytest.mark.kicad_libs
def test_sheet_pins_name_their_net_and_sit_by_their_symbol(reference_circuit, real_symbols):
    sheet = write_schematic(reference_circuit, real_symbols).sheet
    j1 = next(s for s in sheet["symbols"] if s["ref"] == "J1")
    vbus = [p for p in j1["pins"] if p["name"] == "VBUS"]
    assert vbus and {p["net"] for p in vbus} == {"VBUS_IN"}
    assert all(j1["x0"] - 5.08 <= p["x"] <= j1["x1"] + 5.08 and j1["y0"] - 5.08 <= p["y"] <= j1["y1"] + 5.08
               for p in j1["pins"])
    assert [(f["key"], f["title"]) for f in sheet["frames"]] == [
        ("usb", "USB power in"), ("reg", "3V3 regulator"), ("mcu", "MCU")]
    jsonschema.validate(sheet, load_schema("sheet-1.schema.json"))


@pytest.mark.kicad_libs
@pytest.mark.kicad_cli
def test_build_writes_sheet_json_and_names_it(reference_project):
    r = build(reference_project)
    assert r.artifacts["sheet"] == f".pino/build/{r.hash}/sheet.json"
    svg = (reference_project / r.artifacts["schematic_svg"]).read_text(encoding="utf-8")
    sheet = json.loads((reference_project / r.artifacts["sheet"]).read_text(encoding="utf-8"))
    # the SVG's units are the sheet's mm: KiCad's paper is a few microns off the nominal size
    width, height = map(float, re.search(r'viewBox="0\.0+ 0\.0+ ([\d.]+) ([\d.]+)"', svg).groups())
    assert abs(width - sheet["paper"]["width"]) < 0.05 and abs(height - sheet["paper"]["height"]) < 0.05
    # the sheet the views show carries no drawing sheet: no title block, so nothing is drawn outside the frames
    assert "Title:" not in svg and "<desc>Sheet:" not in svg
    jsonschema.validate(json.loads(r.to_json()), load_schema("build-result-1.schema.json"))


def test_build_without_kicad_still_writes_sheet_json(make_project, fixture_libs):
    from helpers import SMALL_BOARD_PY

    project = make_project(SMALL_BOARD_PY)
    r = build(project, BuildOptions(kicad=False))
    assert r.artifacts["sheet"] == f".pino/build/{r.hash}/sheet.json"
    assert json.loads((project / r.artifacts["sheet"]).read_text(encoding="utf-8"))["schema"] == "pino.sheet/1"
    jsonschema.validate(json.loads(r.to_json()), load_schema("build-result-1.schema.json"))
