import json

import pytest

from helpers import FIXTURES, small_board, usb_circuit
from pino_kernel.checks.courtyards import courtyard_overlaps
from pino_kernel.checks.expect import check_expects
from pino_kernel.checks.fit import fit_findings
from pino_kernel.checks.netlist import Netlist, read_netlist
from pino_kernel.checks.reports import drc_findings, erc_findings
from pino_kernel.circuit import Expect, Hole, Intent, Keepout, NetSpec, PartSpec, PinInfo, PinRef
from pino_kernel import fab
from pino_kernel.pcb.footprint import FootprintLibrary, Placed

FIX = FIXTURES / "reports"
NET = FIXTURES / "netlist"
P = PinRef
PADS = {("J1", "1"): (1.0, -10.0), ("J1", "4"): (2.0, -10.0), ("J1", "5"): (3.0, -10.0), ("U1", "1"): (0.0, 5.0)}


def with_expects(circuit, *expects):
    circuit.expects = list(expects)
    return circuit


def fuse_circuit():
    """J1.1 (VBUS) -> F1 -> U1.1 (VIN)."""
    c = usb_circuit()
    c.parts.append(PartSpec("F1", "F1", "x:x", "pino_test:R_0603", "500mA", "", False, "usb", "path",
                            [PinInfo("1", "~", "passive"), PinInfo("2", "~", "passive")], None))
    return with_expects(c, Expect("path", [P("J1", "1")], [P("U1", "1")], ["F1"], 3))


n_ok = Netlist({}, {"VBUS_IN": frozenset({("J1", "1"), ("F1", "1")}), "VBUS": frozenset({("F1", "2"), ("U1", "1")})})
n_fuse_open = Netlist({}, {"VBUS_IN": frozenset({("J1", "1"), ("F1", "1")}), "/VIN": frozenset({("U1", "1")}),
                           "Net-(F1-Pad2)": frozenset({("F1", "2")})})


def test_path_on_one_net_passes():
    c = with_expects(usb_circuit(), Expect("path", [P("J1", "4")], [P("U1", "1")], [], 2))
    assert check_expects(c, read_netlist(NET / "ok.xml"), PADS) == []


def test_path_through_a_part():
    assert check_expects(fuse_circuit(), n_ok, PADS) == []


def test_path_broken_says_where_each_end_went():
    f = check_expects(fuse_circuit(), n_fuse_open, PADS)[0]
    assert f.code == "expect_path_broken" and "J1.1" in f.message and f.at.space == "board"
    assert (f.at.x, f.at.y) == (1.0, -10.0) and f.pins == ("J1.1", "U1.1") and f.severity == "error"
    assert "VBUS_IN" in f.message and "/VIN" in f.message


def test_path_through_an_unlisted_part_fails():
    c = fuse_circuit(); c.expects[0].through = []
    assert check_expects(c, n_ok, PADS)[0].code == "expect_path_broken"


def test_names_never_count():
    # the right net names on the wrong pins: the wrong join an earlier board shipped past a name check
    c_usb = with_expects(usb_circuit(), Expect("path", [P("J1", "4")], [P("U1", "1")], [], 2))
    assert check_expects(c_usb, read_netlist(NET / "swapped.xml"), PADS)[0].code == "expect_path_broken"
    assert check_expects(c_usb, read_netlist(NET / "renamed.xml"), PADS) == []


def test_apart_joined():
    c = with_expects(usb_circuit(), Expect("apart", [P("J1", "4")], [P("J1", "5")], [], 4))
    assert check_expects(c, read_netlist(NET / "ok.xml"), PADS) == []
    joined = Netlist({}, {"USB": frozenset({("J1", "4"), ("J1", "5"), ("U1", "1"), ("U1", "2")})})
    f = check_expects(c, joined, PADS)[0]
    assert f.code == "expect_apart_joined" and f.source == "expect" and "USB" in f.message


def test_erc_report_to_findings():
    f = erc_findings(json.loads((FIX / "erc.json").read_text()), {"11111111-2222-3333-4444-555555555555": "U1"})
    assert (f[0].source, f[0].severity, f[0].refs, f[0].at.space) == ("erc", "error", ("U1",), "sheet")
    assert (f[0].at.x, f[0].at.y) == (120.65, 50.8) and f[0].code == "power_pin_not_driven"
    assert len(f) == 2 and f[1].refs == ("R9",)                    # refs read from the item text when the uuid is unknown


def test_drc_report_to_findings():
    found, unrouted = drc_findings(json.loads((FIX / "drc.json").read_text()), {"aaaaaaaa-0000-0000-0000-000000000001": "R1"})
    assert unrouted == 18
    assert all(f.code != "courtyards_overlap" for f in found)
    assert any(f.code == "parity_missing_footprint" and f.severity == "error" for f in found)
    assert found[0].at.x == pytest.approx(-5.0)                 # KiCad X 95 -> board -5
    assert found[0].at.y == pytest.approx(2.0) and found[0].at.layer == "F.Cu" and found[0].refs == ("R1", "R2")
    assert {f.code for f in found} == {"clearance", "silk_over_copper", "parity_missing_footprint"}


@pytest.fixture
def fp_lib(fixture_libs):
    return FootprintLibrary(fixture_libs)


def placed(fp_lib, ref, lib_id="pino_test:R_0603", x=0.0, y=0.0, rot=0.0, back=False):
    return Placed(ref, ref, fp_lib.load(lib_id), x, y, rot, back, "", {}, False, "")


def test_courtyards_overlap_on_the_same_side_only(fp_lib):
    a, b = placed(fp_lib, "R1"), placed(fp_lib, "R2", x=1.0)
    found = courtyard_overlaps([a, b])
    assert [(f.code, f.refs, f.at.layer) for f in found] == [("courtyard_overlap", ("R1", "R2"), "F.CrtYd")]
    assert found[0].at.x == pytest.approx(0.5)
    assert courtyard_overlaps([a, placed(fp_lib, "R2", x=1.0, back=True)]) == []
    th = placed(fp_lib, "J9", "pino_test:PIN_TH")
    assert [f.at.layer for f in courtyard_overlaps([th, placed(fp_lib, "R2", x=0.5, back=True)])] == ["B.CrtYd"]


def fit_board():
    b = small_board(outline="(30, 20)")
    b.keepout(region=(5, -9, 9, -5), why="lid boss", forbid=("footprints",))
    c = b.to_circuit()
    c.outline.holes = [Hole("H1", -12.0, 7.0, 3.2, 5.0)]
    return c


def test_fit(fixture_libs, fp_lib):
    c = fit_board()
    parts = [placed(fp_lib, "R1", x=14.5, y=0),                 # past the outline (x 15)
             placed(fp_lib, "R2", x=0, y=-9.235),               # courtyard inside, pad copper 0.29 mm from the edge
             placed(fp_lib, "R3", x=7, y=-7),                   # in the keep-out
             placed(fp_lib, "R4", x=-12, y=7),                  # on the hole
             placed(fp_lib, "R5", x=0, y=0)]                    # fine
    found = fit_findings(c, parts, fab.jlc_standard_2layer)
    assert sorted((f.code, f.refs) for f in found) == [("in_keepout", ("R3",)), ("on_hole", ("R4",)),
                                                       ("outside_outline", ("R1",)), ("pad_near_edge", ("R2",))]
    assert all(f.severity == "error" and f.source == "fit" and f.at.space == "board" for f in found)


def test_edge_part_may_cross_on_its_face_only(fixture_libs, fp_lib):
    c = fit_board()
    c.intents = [Intent("J1", "bottom", 0.0, None, None, None, None, False, 1)]
    over_face = placed(fp_lib, "J1", "pino_test:USB_Edge", x=0, y=-9.5)         # face side 2.5 mm past the bottom edge
    assert fit_findings(c, [over_face], fab.jlc_standard_2layer) == []
    turned = placed(fp_lib, "J1", "pino_test:USB_Edge", x=0, y=-9.5, rot=180)   # its back past the edge: not its face
    assert [f.code for f in fit_findings(c, [turned], fab.jlc_standard_2layer)] == ["outside_outline"]
