import pytest

from helpers import small_board
from pino_kernel import ids
from pino_kernel.circuit import Circuit
from pino_kernel.geometry import bbox
from pino_kernel.pcb.footprint import (
    FootprintLibrary, FootprintNotFound, Placed, courtyard_world, model_findings, pad_world, pin_pad_findings, place,
)
from pino_kernel.sexpr import dump, find, find_all

CU2 = ["F.Cu", "B.Cu"]
LIBRARY_UUIDS = {"0b5a3e8e-3f43-4b8a-9d1e-6a1f0c1b2a01", "0b5a3e8e-3f43-4b8a-9d1e-6a1f0c1b2a02"}


@pytest.fixture
def fp_lib(fixture_libs):
    return FootprintLibrary(fixture_libs)


@pytest.fixture
def placed(fp_lib):
    def make(ref, key=None, lib_id="pino_test:R_0603", x=10.0, y=5.0, rot=0, back=False, nets=None, dnp=False):
        return Placed(ref, key or ref, fp_lib.load(lib_id), x, y, rot, back, "10k", nets or {}, dnp, "")
    return make


def uuids_in(node):
    out = []
    def walk(n):
        for c in n:
            if isinstance(c, list):
                if c and c[0] == "uuid":
                    out.append(str(c[1]))
                walk(c)
    walk(node)
    return out


def test_pads_rotate_counter_clockwise(fp_lib):
    pads = {p.number: (p.x, p.y) for p in pad_world(Placed("R1", "R1", fp_lib.load("pino_test:R_0603"), 10, 5, 90, False, "10k", {}, False, ""))}
    assert pads["1"] == pytest.approx((10.0, 4.2)) and pads["2"] == pytest.approx((10.0, 5.8))


def test_back_side_mirrors_local_y(placed):
    front = pad_world(placed("Q1", lib_id="pino_test:ASYM", x=0, y=0))[0]
    back = pad_world(placed("Q1", lib_id="pino_test:ASYM", x=0, y=0, back=True))[0]
    assert (front.x, front.y) == pytest.approx((1.0, -0.5)) and (back.x, back.y) == pytest.approx((1.0, 0.5))
    assert front.layers[0] == "F.Cu" and back.layers[0] == "B.Cu"


def test_library_uuids_are_replaced(placed):
    a = place(placed("R1"), copper_layers=CU2); b = place(placed("R2"), copper_layers=CU2)
    ua, ub = uuids_in(a), uuids_in(b)
    assert not set(ua) & set(ub) and not set(ua) & LIBRARY_UUIDS and len(ua) == len(set(ua))


def test_path_is_the_symbol_uuid(placed):
    node = place(placed("R1", key="pullup"), copper_layers=CU2)
    assert find(node, "path")[1] == ids.footprint_path("pullup") and find(node, "uuid")[1] == ids.footprint_uuid("pullup")
    assert find(node, "sheetfile")[1] == "board.kicad_sch"


def test_position_goes_into_kicads_frame(placed):
    at = find(place(placed("R1", x=3, y=4, rot=90), copper_layers=CU2), "at")
    assert [str(v) for v in at[1:]] == ["103", "96", "90"]


def test_datasheet_and_description_are_written(placed):
    props = [p[1] for p in find_all(place(placed("R1"), copper_layers=CU2), "property")]
    assert props == ["Reference", "Value", "Datasheet", "Description", "LCSC"]


def test_pad_nets_are_written(placed):
    node = place(placed("R1", nets={"1": "VBUS"}), copper_layers=CU2)
    pads = {str(p[1]): find(p, "net") for p in find_all(node, "pad")}
    assert pads["1"][1] == "VBUS" and pads["2"] is None


def test_one_line_footprint_loads_like_the_formatted_one(fp_lib):
    a, b = fp_lib.load("pino_test:R_0603"), fp_lib.load("pino_test:R_0603_oneline")
    assert a.pads == b.pads and a.courtyard == b.courtyard


def test_edge_face(fp_lib):
    assert fp_lib.load("pino_test:USB_Edge").edge_face == "bottom"
    assert fp_lib.load("pino_test:MODULE_ANT").edge_face == "top"
    assert fp_lib.load("pino_test:R_0603").edge_face == "bottom"


def test_courtyard_turns_with_the_part(placed):
    assert bbox(courtyard_world(placed("R1", x=0, y=0, rot=90))["F"][0]) == pytest.approx((-0.75, -1.5, 0.75, 1.5))


def test_back_part_courtyard_is_on_the_back(placed):
    assert set(courtyard_world(placed("R1", back=True))) == {"B"}


def test_through_hole_courtyard_counts_on_both_sides(placed):
    cy = courtyard_world(placed("J9", lib_id="pino_test:PIN_TH", x=0, y=0))
    assert set(cy) == {"F", "B"} and bbox(cy["B"][0]) == pytest.approx((-1.2, -1.2, 1.2, 1.2))


def test_footprint_zone_keeps_only_board_layers_and_moves(placed):
    node = place(placed("U3", lib_id="pino_test:MODULE_ANT", x=0, y=0), copper_layers=CU2)
    zone = find(node, "zone")
    assert [str(s) for s in find(zone, "layers")[1:]] == ["F.Cu", "B.Cu"]
    pts = [(float(p[1]), float(p[2])) for p in find_all(find(find(zone, "polygon"), "pts"), "xy")]
    assert (106.0, 99.0) in pts                      # local (6, -1) -> KiCad (100 + 6, 100 - 1)


def test_model_check(placed, fp_lib):
    found = model_findings([placed("R1"), placed("D1", lib_id="pino_test:LED_0603")], fp_lib)
    assert [(f.code, f.refs) for f in found] == [("model3d_missing", ("D1",))]
    assert "LED_0603_missing.step" in found[0].message
    none = model_findings([placed("U1", lib_id="pino_test:SOT23")], fp_lib)
    assert [(f.code, f.severity) for f in none] == [("model3d_none", "info")]


def test_pin_without_pad_is_an_error(fixture_libs, fp_lib):
    c = small_board().to_circuit()
    assert pin_pad_findings(c, fp_lib) == []
    c.parts[-1].footprint = "pino_test:PIN_TH"      # the LED's two pins on a one-pad footprint
    found = pin_pad_findings(c, fp_lib)
    assert [(f.code, f.severity, f.pins) for f in found] == [("pin_without_pad", "error", ("D1.2",))]
    c.parts[-1].footprint = "pino_test:Nope"
    assert pin_pad_findings(c, fp_lib)[0].code == "footprint_not_found"


def test_missing_footprint(fp_lib):
    with pytest.raises(FootprintNotFound):
        fp_lib.load("pino_test:Nope")


def test_footprint_angle_is_written_as_kicad_saves_it(placed):
    at = find(place(placed("R1", x=0, y=0, rot=270), copper_layers=CU2), "at")
    assert str(at[3]) == "-90"


def test_back_side_flips_bare_layer_names(fp_lib, tmp_path):
    from pino_kernel.pcb.footprint import _flip_tree
    from pino_kernel.sexpr import Sym, parse
    pad = _flip_tree(parse('(pad "1" smd rect (at 1 0) (size 1 1) (layers F.Cu F.Paste F.Mask))'), True)
    line = _flip_tree(parse('(fp_line (start 0 0) (end 1 0) (layer F.SilkS))'), True)
    assert [str(s) for s in find(pad, "layers")[1:]] == ["B.Cu", "B.Paste", "B.Mask"]
    assert all(isinstance(s, Sym) for s in find(pad, "layers")[1:]) and str(find(line, "layer")[1]) == "B.SilkS"
    quoted = _flip_tree(parse('(pad "1" thru_hole circle (at 0 0) (size 1 1) (layers "*.Cu" "F.Mask"))'), True)
    assert [str(s) for s in find(quoted, "layers")[1:]] == ["*.Cu", "B.Mask"]


def test_footprint_zone_layer_forms(placed):
    from pino_kernel.pcb.footprint import _zone_item
    from pino_kernel.sexpr import parse
    p = placed("U3", lib_id="pino_test:MODULE_ANT", x=0, y=0)
    zone = lambda layers: parse(f'(zone (layers {layers}) (keepout (tracks not_allowed)) (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1))))')
    assert _zone_item(zone('"In1.Cu" "In2.Cu"'), p, CU2, "u") is None           # nothing left on a 2-layer board
    both = _zone_item(zone('"F&B.Cu"'), p, CU2, "u")
    assert [str(s) for s in find(both, "layers")[1:]] == ["F.Cu", "B.Cu"]
