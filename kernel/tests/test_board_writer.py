import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from helpers import FIXTURES, small_board
from pino_kernel import fab, ids
from pino_kernel.circuit import (SCHEMA, BlockSpec, Circuit, Keepout, NetSpec, PartPose, PartSpec, PinInfo, PinRef,
                                 ZoneSpec)
from pino_kernel.outline import rectangle
from pino_kernel.pcb.footprint import FootprintLibrary
from pino_kernel.pcb.rules import kicad_dru
from pino_kernel.pcb.writer import copper_layers, write_board
from pino_kernel.sexpr import find, find_all, parse
from semdiff import changed_items

TESTS = Path(__file__).resolve().parent


def grid_placement(circuit, pitch=6.0):
    """Parts on a simple grid from the top left: the placer comes in a later task."""
    w, h = circuit.outline.width, circuit.outline.height
    cols = max(1, int((w - 4) // pitch))
    return {p.ref: PartPose(-w / 2 + 3 + pitch * (i % cols), h / 2 - 3 - pitch * (i // cols), 0.0, False)
            for i, p in enumerate(circuit.parts)}


def write(board, placement=None, libs=None):
    from pino_kernel.libraries import discover
    c = board.to_circuit() if hasattr(board, "to_circuit") else board
    return write_board(c, placement or grid_placement(c), FootprintLibrary(libs or discover()))


def layers_of(files):
    return [(int(l[0]), str(l[1])) for l in find(parse(files.kicad_pcb), "layers")[1:] if str(l[2]) == "signal"]


def thicknesses(files):
    st = find(find(parse(files.kicad_pcb), "setup"), "stackup")
    return [float(find(l, "thickness")[1]) for l in find_all(st, "layer") if find(l, "thickness")]


def footprint_named(files, ref):
    for fp in find_all(parse(files.kicad_pcb), "footprint"):
        if any(p[1] == "Reference" and p[2] == ref for p in find_all(fp, "property")):
            return fp
    raise KeyError(ref)


def walk(node):
    yield node
    for c in node:
        if isinstance(c, list):
            yield from walk(c)


def test_same_bytes_twice_and_across_hash_seeds(fixture_libs, tmp_path):
    a, b = write(small_board()).kicad_pcb, write(small_board()).kicad_pcb
    assert a == b
    code = ("import hashlib, sys; sys.path.insert(0, sys.argv[1]); import test_board_writer as t;"
            "from helpers import small_board; print(hashlib.sha256(t.write(small_board()).kicad_pcb.encode()).hexdigest())")
    digests = set()
    for seed in ("1", "98765"):
        out = subprocess.run([sys.executable, "-c", code, str(TESTS)], env={**os.environ, "PYTHONHASHSEED": seed},
                             capture_output=True, text=True, cwd=tmp_path)
        assert out.returncode == 0, out.stderr
        digests.add(out.stdout.strip())
    assert digests == {hashlib.sha256(a.encode()).hexdigest()}


def test_no_uuid_twice(fixture_libs):
    found = [str(n[1]) for n in walk(parse(write(small_board(outline=f'"{FIXTURES / "outline/enclosure.json"}"')).kicad_pcb))
             if n and n[0] == "uuid"]
    assert len(found) == len(set(found))


def test_copper_layers(fixture_libs):
    two, four = layers_of(write(small_board(layers=2))), layers_of(write(small_board(layers=4)))
    assert two == [(0, "F.Cu"), (2, "B.Cu")] and four == [(0, "F.Cu"), (4, "In1.Cu"), (6, "In2.Cu"), (2, "B.Cu")]
    assert copper_layers(4) == [(0, "F.Cu"), (4, "In1.Cu"), (6, "In2.Cu"), (2, "B.Cu")]


def test_stackup_adds_up_to_board_thickness(fixture_libs):
    for n in (2, 4):
        assert sum(thicknesses(write(small_board(layers=n)))) == pytest.approx(1.6, abs=0.01)


def test_pad_nets_come_from_the_circuit(fixture_libs):
    fp = footprint_named(write(small_board()), "U1")
    pads = {str(p[1]): find(p, "net") for p in find_all(fp, "pad")}
    assert pads["1"][1] == "VBUS" and pads["3"][1] == "+3V3"


def test_no_connect_pads_get_kicads_unconnected_net(fixture_libs):
    pads = {str(p[1]): find(p, "net") for p in find_all(footprint_named(write(small_board()), "U2"), "pad")}
    assert pads["4"][1] == "unconnected-(U2-IO2-Pad4)" and pads["5"][1] == "unconnected-(U2-IO3-Pad5)"


def test_holes_are_board_only_npth(fixture_libs):
    fp = footprint_named(write(small_board(outline=f'"{FIXTURES / "outline/enclosure.json"}"')), "H1")
    assert find(fp, "attr")[1:] == ["board_only", "exclude_from_pos_files", "exclude_from_bom"]
    assert find(find(fp, "pad"), "drill")[1] == "3.2" and find(fp, "pad")[2] == "np_thru_hole"
    assert [str(v) for v in find(fp, "at")[1:]] == ["75.5", "81.5"]      # (-24.5, 18.5) in KiCad's frame


def test_keepout_is_a_rule_area(fixture_libs):
    b = small_board(); b.keepout(region=(0, 0, 10, 6), why="antenna", forbid=("tracks", "vias"))
    zone = find_all(parse(write(b).kicad_pcb), "zone")[0]
    ko = find(zone, "keepout")
    assert [(str(k[0]), str(k[1])) for k in ko[1:]] == [("tracks", "not_allowed"), ("vias", "not_allowed"),
                                                        ("pads", "allowed"), ("copperpour", "allowed"), ("footprints", "allowed")]
    assert [str(s) for s in find(zone, "layers")[1:]] == ["F.Cu", "B.Cu"] and find(zone, "name")[1] == "keepout:antenna"
    pts = [(float(p[1]), float(p[2])) for p in find_all(find(find(zone, "polygon"), "pts"), "xy")]
    assert pts == [(100, 100), (110, 100), (110, 94), (100, 94)]


def test_fill_zone_covers_the_outline(fixture_libs):
    b = small_board(); b.zone("GND", layer="B.Cu")
    zone = find(parse(write(b).kicad_pcb), "zone")
    assert (find(zone, "net")[1], find(zone, "layer")[1]) == ("GND", "B.Cu")
    xs = [float(p[1]) for p in find_all(find(find(zone, "polygon"), "pts"), "xy")]
    assert (min(xs), max(xs)) == pytest.approx((85, 115))


def board_with_power_class():
    b = small_board(); b.net_class("power", ["VBUS", "+3V3"], width=0.5)
    return b


def test_net_class_in_kicad_pro(fixture_libs):
    pro = json.loads(write(board_with_power_class()).kicad_pro)
    assert {"netclass": "power", "pattern": "VBUS"} in pro["net_settings"]["netclass_patterns"]
    assert pro["board"]["design_settings"]["rules"]["min_clearance"] == 0.10
    power = next(c for c in pro["net_settings"]["classes"] if c["name"] == "power")
    assert (power["track_width"], power["clearance"]) == (0.5, 0.15) and pro["meta"]["filename"] == "board.kicad_pro"


def parse_rules(text):
    """{rule name without "pino: ": (constraint, min, condition)}"""
    root = parse("(rules " + text + ")")
    out = {}
    for r in find_all(root, "rule"):
        c, cond = find(r, "constraint"), find(r, "condition")
        out[str(r[1]).removeprefix("pino: ")] = (str(c[1]), str(find(c, "min")[1]), str(cond[1]) if cond else None)
    return out


def test_dru_carries_the_fab_limits():
    two, four = parse_rules(kicad_dru(fab.jlc_standard_2layer)), parse_rules(kicad_dru(fab.jlc_standard_4layer))
    assert two["track_width"][1] == "0.1mm" and four["track_width"][1] == "0.09mm"
    assert set(two) == {"track_width", "clearance", "pad_to_pad", "hole_size", "via_diameter", "via annular_width",
                        "pth annular_width", "via hole_to_hole", "pad hole_to_hole", "via hole_clearance",
                        "pth hole_clearance", "edge_clearance", "silk_clearance", "text_height"}
    assert two["edge_clearance"][1] == "0.2mm" and two["silk_clearance"][1] == "0mm"
    assert two["pad_to_pad"] == ("clearance", "0.15mm", "A.Type == 'Pad' && B.Type == 'Pad'")


def test_dru_splits_annular_ring_by_vias_and_pads():
    two = parse_rules(kicad_dru(fab.jlc_standard_2layer))
    pth = "A.Type == 'Pad' && A.Pad_Type == 'Through-hole'"
    assert two["via annular_width"] == ("annular_width", "0.125mm", "A.Type == 'Via'")
    assert two["pth annular_width"] == ("annular_width", "0.18mm", pth)
    assert two["via hole_to_hole"] == ("hole_to_hole", "0.2mm", "A.Type == 'Via'")
    assert two["pad hole_to_hole"] == ("hole_to_hole", "0.45mm", "A.Type == 'Pad'")
    assert two["via hole_clearance"] == ("hole_clearance", "0.2mm", "A.Type == 'Via'")
    assert two["pth hole_clearance"] == ("hole_clearance", "0.28mm", pth)
    assert parse_rules(kicad_dru(fab.jlc_standard_4layer))["pth annular_width"][1] == "0.15mm"


def test_pro_rule_values_follow_the_profile(fixture_libs):
    rules = json.loads(write(small_board()).kicad_pro)["board"]["design_settings"]["rules"]
    assert rules["min_hole_clearance"] == 0.2 and rules["min_copper_edge_clearance"] == 0.2
    assert (rules["min_via_annular_width"], rules["min_hole_to_hole"], rules["min_through_hole_diameter"]) == (0.125, 0.2, 0.2)


def board_with_module(layers):
    from pino_kernel.libraries import discover
    c = small_board(layers=layers).to_circuit()
    c.parts.append(PartSpec("U3", "U3", "pino_test:X", "pino_test:MODULE_ANT", "MOD", "", False, "mcu", "path",
                            [PinInfo(str(i), f"P{i}", "passive") for i in range(1, 7)], None))
    return c


def test_footprint_zone_keeps_only_board_layers(fixture_libs):
    for layers, want in ((2, ["F.Cu", "B.Cu"]), (4, ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"])):
        zone = find(footprint_named(write(board_with_module(layers)), "U3"), "zone")
        assert [str(s) for s in find(zone, "layers")[1:]] == want


def test_dnp_part_is_marked(fixture_libs):
    c = small_board().to_circuit(); c.part("R1").dnp = True
    assert "dnp" in [str(a) for a in find(footprint_named(write(c), "R1"), "attr")[1:]]


# --- against the real kicad-cli, with KiCad's own footprints ---------------------------------------------

REAL = {
    "U1": ("Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", [str(i) for i in range(1, 9)]),
    "R1": ("Resistor_SMD:R_0603_1608Metric", ["1", "2"]),
    "R2": ("Resistor_SMD:R_0603_1608Metric", ["1", "2"]),
    "R3": ("Resistor_SMD:R_0603_1608Metric", ["1", "2"]),
    "C1": ("Capacitor_SMD:C_0603_1608Metric", ["1", "2"]),
    "C2": ("Capacitor_SMD:C_0603_1608Metric", ["1", "2"]),
    "D1": ("LED_SMD:LED_0603_1608Metric", ["1", "2"]),
}
REAL_NETS = {"VCC": [("U1", "8"), ("R1", "1"), ("C1", "1"), ("R3", "1")], "GND": [("U1", "4"), ("C1", "2"), ("C2", "2"), ("D1", "1")],
             "IN": [("U1", "2"), ("R1", "2"), ("C2", "1")], "OUT": [("U1", "3"), ("R2", "1")], "LED": [("R2", "2"), ("D1", "2")],
             "SPARE": [("R3", "2"), ("U1", "7")]}
REAL_POSES = {"U1": (-8, 4, 0, False), "R1": (2, 6, 90, False), "R2": (6, 6, 180, False), "R3": (-8, -5, 0, True),
              "C1": (2, -2, 0, False), "C2": (6, -2, 90, False), "D1": (10, 6, 0, False)}


def real_circuit(layers, parts=REAL, nets=REAL_NETS, holes=True, keepout=True, zone=True, dnp=("R3",)):
    from pino_kernel.circuit import Hole
    outline = rectangle(40, 30, 2)
    if holes:
        outline.holes = [Hole(f"H{i + 1}", x, y, 3.2, 5.0) for i, (x, y) in enumerate(((-16, 11), (16, 11), (-16, -11), (16, -11)))]
    specs = [PartSpec(r, r, "x:x", fp, r, "", r in dnp, "b", "path", [PinInfo(n, n, "passive") for n in pins], None)
             for r, (fp, pins) in parts.items()]
    netspecs = [NetSpec(n, "gnd" if n == "GND" else "signal", False, "", [PinRef(*p) for p in pins]) for n, pins in nets.items()]
    return Circuit(SCHEMA, "real", layers, fab.for_layers(layers).name, outline, [BlockSpec("b", "b", list(parts))], specs,
                   netspecs, [], {}, [], [], [Keepout([(-4, -13), (0, -13), (0, -9), (-4, -9)], ["*.Cu"],
                                                      ["tracks", "vias", "pads", "copperpour", "footprints"], "test", "board.py")] if keepout else [],
                   [ZoneSpec("GND", "B.Cu" if layers == 2 else "In1.Cu", None)] if zone else [], [], [], "board.py")


def write_real(tmp_path, circuit, poses, extra_dru=""):
    from pino_kernel.libraries import discover
    env = {k: v for k, v in os.environ.items() if not k.startswith("PINO_KICAD_")}
    files = write_board(circuit, {r: PartPose(*p) for r, p in poses.items()}, FootprintLibrary(discover(env)))
    out = tmp_path / "real"; out.mkdir(exist_ok=True)
    (out / "board.kicad_pcb").write_text(files.kicad_pcb, encoding="utf-8")
    (out / "board.kicad_pro").write_text(files.kicad_pro, encoding="utf-8")
    (out / "board.kicad_dru").write_text(files.kicad_dru + extra_dru + ("\n" if extra_dru else ""), encoding="utf-8")
    libs = sorted({p.footprint.split(":")[0] for p in circuit.parts})
    (out / "fp-lib-table").write_text("(fp_lib_table (version 7)\n" + "".join(
        f'  (lib (name "{lib}") (type "KiCad") (uri "${{KICAD10_FOOTPRINT_DIR}}/{lib}.pretty") (options "") (descr ""))\n'
        for lib in libs) + ")\n")
    return out / "board.kicad_pcb"


def write_real_board(tmp_path, layers, extra_dru=""):
    return write_real(tmp_path, real_circuit(layers), REAL_POSES, extra_dru)


def refill_copy(kicad, pcb: Path) -> Path:
    filled = pcb.parent / "filled"; filled.mkdir(exist_ok=True)
    for f in [*pcb.parent.glob("board.kicad_*"), pcb.parent / "fp-lib-table"]:
        shutil.copy(f, filled / f.name)
    run = kicad.drc(filled / "board.kicad_pcb", filled / "drc.json", refill=True, save=True)
    assert run.ok, run.output
    return filled / "board.kicad_pcb"


def drc_json(kicad, pcb):
    run = kicad.drc(pcb, pcb.parent / "drc-check.json")
    assert run.ok, run.output
    return json.loads((pcb.parent / "drc-check.json").read_text())


def drc_types(kicad, pcb):
    report = drc_json(kicad, pcb)
    return {v["type"] for v in report["violations"]} | ({"unconnected_items"} if report.get("unconnected_items") else set())


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
@pytest.mark.parametrize("layers", [2, 4])
def test_kicad_refill_only_adds_fill(layers, kicad, tmp_path):
    # real-library board: SOIC-8, 0603s, one part on the back, rotations 0/90/180, a GND zone, 4 holes, a keep-out, a DNP part
    out = write_real_board(tmp_path, layers); filled = refill_copy(kicad, out)
    fill_zone = ("zone", ids.uid("zone", "0"))
    assert changed_items(out.read_text(), filled.read_text()) == [fill_zone]
    # an unrouted board's zone has nothing joining it to its pads yet: KiCad calls that isolated copper
    assert drc_types(kicad, filled) <= {"unconnected_items", "isolated_copper"}, drc_json(kicad, filled)["violations"]


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_dru_is_read(kicad, tmp_path):
    # KiCad ignores a rule file with one bad token; a probe rule proves this one is read
    out = write_real_board(tmp_path, 2, extra_dru='(rule "probe" (constraint edge_clearance (min 50mm)) (condition "A.Type == \'Pad\'"))')
    assert any("probe" in v["description"] for v in drc_json(kicad, out)["violations"])


def zone_polygon(fp_node):
    zone = find(fp_node, "zone")
    return [(float(p[1]), float(p[2])) for p in find_all(find(find(zone, "polygon"), "pts"), "xy")]


def footprint_named_text(path, ref):
    for fp in find_all(parse(path.read_text()), "footprint"):
        if any(p[1] == "Reference" and p[2] == ref for p in find_all(fp, "property")):
            return fp
    raise KeyError(ref)


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_footprint_zone_survives_kicad_resave(kicad, tmp_path):
    parts = {"U1": ("RF_Module:ESP32-C6-MINI-1", [str(i) for i in range(1, 54)])}
    c = real_circuit(2, parts=parts, nets={}, holes=False, keepout=False, zone=False, dnp=())
    c.outline = rectangle(60, 60, 2)
    out = write_real(tmp_path, c, {"U1": (0, 0, 90, False)})
    filled = refill_copy(kicad, out)
    before, after = footprint_named_text(out, "U1"), footprint_named_text(filled, "U1")
    assert zone_polygon(before) == zone_polygon(after)
    assert [str(s) for s in find(find(after, "zone"), "layers")[1:]] == ["F.Cu", "B.Cu"]
    assert changed_items(out.read_text(), filled.read_text()) == []


def test_symbol_fields_go_onto_the_footprint(fixture_libs):
    c = small_board().to_circuit()
    c.part("R1").datasheet, c.part("R1").description, c.part("R1").lcsc = "https://example.invalid/r.pdf", "Resistor", "C1234"
    props = {p[1]: p[2] for p in find_all(footprint_named(write(c), "R1"), "property")}
    assert (props["Datasheet"], props["Description"], props["LCSC"]) == ("https://example.invalid/r.pdf", "Resistor", "C1234")


def drc_with_vias(kicad, tmp_path, vias):
    """The 2-layer real board with `vias` (x, y, diameter, drill) on net IN, its DRC report."""
    from pino_kernel.circuit import FixedVia
    c = real_circuit(2, zone=False, keepout=False)
    c.fixed_vias = [FixedVia("IN", x, y, d, drill) for x, y, d, drill in vias]
    return drc_json(kicad, write_real(tmp_path, c, REAL_POSES))


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_kicad_reads_every_rule(kicad, tmp_path):
    # a 0.5 mm via over a 0.3 mm hole has a 0.1 mm ring; two vias 0.45 mm apart leave 0.15 mm between their holes
    report = drc_with_vias(kicad, tmp_path, [(-14, -6, 0.5, 0.3), (14, -6, 0.6, 0.3), (14.45, -6, 0.6, 0.3)])
    found = {(v["type"], v["description"].split("(")[0].strip()) for v in report["violations"]}
    text = json.dumps(report)
    assert "pino: via annular_width" in text, found
    assert "pino: via hole_to_hole" in text, found
    assert "annular_width" in {t for t, _ in found} and "hole_to_hole" in {t for t, _ in found}


def test_place_origin_is_the_outline_centre(fixture_libs):
    setup = find(parse(write(small_board()).kicad_pcb), "setup")
    assert [str(v) for v in find(setup, "aux_axis_origin")[1:]] == ["100", "100"]


def attr_of(files, ref):
    return [str(a) for a in find(footprint_named(files, ref), "attr")[1:]]


def test_hand_fit_part_is_out_of_position_files(fixture_libs):
    c = small_board().to_circuit()
    c.part("R1").hand_fit = True
    c.part("C1").hand_fit = c.part("C1").dnp = True
    files = write(c)
    assert attr_of(files, "R1") == ["smd", "exclude_from_pos_files"] and attr_of(files, "C2") == ["smd"]
    assert attr_of(files, "C1") == ["smd", "exclude_from_pos_files", "dnp"]


def test_the_schematic_says_the_same_about_hand_fit_parts(fixture_libs):
    from pino_kernel.libraries import discover
    from pino_kernel.schematic.writer import write_schematic
    from pino_kernel.symbols import SymbolLibrary

    c = small_board().to_circuit()
    c.part("R1").hand_fit = True
    sch = parse(write_schematic(c, SymbolLibrary(discover().symbols)).kicad_sch)
    flags = {}
    for sym in find_all(sch, "symbol"):
        ref = next((str(p[2]) for p in find_all(sym, "property") if p[1] == "Reference"), "")
        if find(sym, "in_pos_files"):
            flags[ref] = str(find(sym, "in_pos_files")[1])
    assert flags["R1"] == "no" and flags["C1"] == "yes"


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_kicad_keeps_the_origin_and_the_hand_fit_flag_on_save(kicad, tmp_path):
    c = real_circuit(2, zone=False, keepout=False, dnp=())
    c.part("R1").hand_fit = True
    out = write_real(tmp_path, c, REAL_POSES)
    filled = refill_copy(kicad, out)
    assert changed_items(out.read_text(), filled.read_text()) == []
    assert "(aux_axis_origin 100 100)" in filled.read_text()
    fp = footprint_named_text(filled, "R1")
    assert [str(a) for a in find(fp, "attr")[1:]] == ["smd", "exclude_from_pos_files"]


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_kicads_own_footprints_pass_the_silkscreen_rules(kicad, tmp_path):
    # KiCad draws silk 0.1 mm from pads, closer than JLC's 0.15 mm; the Gerbers cut silk out of every mask opening,
    # so no rule of pino's may turn each standard footprint into a warning
    parts = {"R1": ("Resistor_SMD:R_0402_1005Metric", ["1", "2"])}
    c = real_circuit(2, parts=parts, nets={}, holes=False, keepout=False, zone=False, dnp=())
    report = drc_json(kicad, write_real(tmp_path, c, {"R1": (0, 0, 0, False)}))
    assert [v["description"] for v in report["violations"] if "silk" in v["type"]] == []
