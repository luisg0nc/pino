"""The JLC rotation table, pino's own: each correction turns KiCad's pin 1 onto the tape's pin 1.

KiCad draws footprints in the IPC-7x51 zero orientation. JLC's zero orientation is how the part sits in its tape
(its assembly FAQ), and EIA-481-D says where pin 1 sits there, per package family.
"""

import math
import re

import pytest

from pino_kernel.pcb.footprint import FootprintLibrary, Placed, pad_world
from pino_kernel.release.rotations import ROTATIONS, Rule, cpl_angle, cpl_offset, load_rules, rule_for

# EIA-481-D pin 1 position at zero orientation, as the angle from the part's centre (degrees, counter-clockwise, y up)
UL, LL, LR = 135.0, 225.0, 315.0

# (KiCad footprint, EIA-481-D pin 1 for its family)
FAMILIES = [
    ("Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", LL),
    ("Package_SO:TSSOP-14_4.4x5mm_P0.65mm", UL),
    ("Package_TO_SOT_SMD:SOT-23", LR),
    ("Package_TO_SOT_SMD:SOT-23-5", LR),
    ("Package_TO_SOT_SMD:SOT-23-6", LR),
    ("Package_TO_SOT_SMD:SOT-223-3_TabPin2", LR),
    ("Package_TO_SOT_SMD:SOT-89-3", LR),
    ("Package_QFP:LQFP-48_7x7mm_P0.5mm", UL),
    ("Package_QFP:LQFP-128_14x20mm_P0.5mm", LL),
    ("Package_DFN_QFN:QFN-56-1EP_7x7mm_P0.4mm_EP5.6x5.6mm", UL),
    ("Package_DFN_QFN:QFN-20-1EP_3x4mm_P0.5mm_EP1.65x2.65mm", LL),
    ("Package_DFN_QFN:DFN-8-1EP_3x3mm_P0.5mm_EP1.66x2.38mm", LR),
]


def quadrant_angle(x: float, y: float) -> float:
    return {(False, True): UL, (False, False): LL, (True, False): LR, (True, True): 45.0}[(x > 0, y > 0)]


@pytest.mark.kicad_libs
@pytest.mark.parametrize("lib_id,eia", FAMILIES)
def test_the_correction_turns_kicads_pin_1_onto_the_tapes(real_libs, lib_id, eia):
    fp = FootprintLibrary(real_libs).load(lib_id)
    pads = pad_world(Placed("U1", "U1", fp, 0.0, 0.0))
    first = next(p for p in pads if p.number == "1")
    box_x = [x for p in pads if p.number for x, _ in p.poly]
    box_y = [y for p in pads if p.number for _, y in p.poly]
    cx, cy = (min(box_x) + max(box_x)) / 2, (min(box_y) + max(box_y)) / 2
    kicad = quadrant_angle(first.x - cx, first.y - cy)
    assert kicad == UL, "KiCad draws pin 1 upper left (IPC-7x51)"
    rule = rule_for(lib_id.split(":")[1], load_rules())
    assert rule is not None, lib_id
    # JLC places the tape's part turned by the CPL angle: that must land pin 1 where KiCad has it
    assert (eia + rule.rotation) % 360 == pytest.approx(kicad)


@pytest.mark.parametrize("name,rotation", [
    ("R_0402_1005Metric", 0), ("R_0603_1608Metric", 0), ("C_0805_2012Metric", 0), ("L_0603_1608Metric", 0),
    ("LED_0603_1608Metric", 0), ("D_SOD-123", 0), ("D_SMA", 0),
    ("SOIC-8_3.9x4.9mm_P1.27mm", 270), ("SOIC-16W_7.5x10.3mm_P1.27mm", 270),
    ("SOT-23", 180), ("SOT-23-5", 180), ("TSOT-23-6", 180), ("SOT-223-3_TabPin2", 180),
    ("TSSOP-20_4.4x6.5mm_P0.65mm", 0), ("LQFP-48_7x7mm_P0.5mm", 0), ("LQFP-128_14x20mm_P0.5mm", 270),
    ("QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm", 0), ("VQFN-24-1EP_4x4mm_P0.5mm_EP2.45x2.45mm", 0),
    ("QFN-20-1EP_3x4mm_P0.5mm_EP1.65x2.65mm", 270), ("DFN-8-1EP_3x3mm_P0.5mm_EP1.66x2.38mm", 180),
    ("TO-252-2", 0), ("TO-263-3_TabPin2", 0), ("CP_Elec_6.3x5.4", 0), ("CP_EIA-3216-18_Kemet-A", 0),
])
def test_known_footprints(name, rotation):
    rule = rule_for(name, load_rules())
    assert rule is not None and rule.rotation == rotation


@pytest.mark.parametrize("name", [
    "USB_C_Receptacle_HRO_TYPE-C-31-M-12", "ESP32-C6-MINI-1", "SSOP-20_5.3x7.2mm_P0.65mm",
    "MSOP-8_3x3mm_P0.65mm", "SOT-143_Reverse", "PinHeader_1x04_P2.54mm_Vertical",
    "SW_Push_1P1T_NO_CK_KMR2", "Fuse_0603_1608Metric", "HSOP-8-1EP_3.9x4.9mm_P1.27mm",
])
def test_what_the_standards_do_not_settle_gets_no_rule(name):
    assert rule_for(name, load_rules()) is None


def test_only_two_ended_unpolarised_parts_need_no_check():
    rules = load_rules()
    assert [rule_for(n, rules).needs_check for n in ("R_0402_1005Metric", "C_0603_1608Metric", "L_0805_2012Metric")] == [False] * 3
    assert all(rule_for(n, rules).needs_check for n in ("LED_0603_1608Metric", "D_SOD-123", "SOT-23", "SOIC-8_3.9x4.9mm_P1.27mm"))


def test_no_rule_claims_a_check_it_never_had():
    rules = load_rules()
    assert rules and all(r.checked is None for r in rules)        # a date goes in only after JLC's preview
    assert all(r.basis for r in rules) and all(re.compile(r.pattern) for r in rules)
    assert ROTATIONS.name == "rotations.csv"


def test_cpl_angle_turns_with_the_part_and_mirrors_on_the_bottom():
    r = Rule("x", "f", 270, (0.0, 0.0), False, None, "b")
    assert cpl_angle(0, False, r) == 270 and cpl_angle(90, False, r) == 0 and cpl_angle(-90, False, None) == 270
    assert cpl_angle(90, True, None) == 90 and cpl_angle(0, True, None) == 180 and cpl_angle(30, True, r) == 60
    assert cpl_angle(0, False, r, override=90) == 90 and cpl_angle(10, True, None, override=5) == 175


@pytest.mark.parametrize("angle", [0, 30, 90, 180, 270])
def test_a_bottom_part_seen_from_below_looks_like_a_front_part_turned_180_minus_its_angle(fixture_libs, angle):
    fp = FootprintLibrary(fixture_libs).load("pino_test:SOT23")
    back = pad_world(Placed("Q1", "Q1", fp, 3.0, 2.0, angle, True))
    front = pad_world(Placed("Q1", "Q1", fp, -3.0, 2.0, cpl_angle(angle, True, None), False))
    for b, f in zip(back, front):
        assert (-b.x, b.y) == pytest.approx((f.x, f.y), abs=1e-5)


@pytest.mark.parametrize("back", [False, True])
@pytest.mark.parametrize("angle", [0, 90, 200])
def test_an_offset_moves_as_a_pad_at_that_spot_would(fixture_libs, back, angle):
    """Offsets are footprint millimetres (x right, y up), so they turn and flip with the footprint's pads."""
    fp = FootprintLibrary(fixture_libs).load("pino_test:SOT23")
    rule = Rule("x", "f", 0, (1.44, 0.5), False, None, "b")
    pad = fp.pads[0]
    here = pad_world(Placed("Q1", "Q1", fp, 0.0, 0.0, angle, back))[0]
    kicad_x, kicad_y = pad.x, pad.y                               # footprint frame, y down
    ox, oy = cpl_offset(Rule("x", "f", 0, (kicad_x, -kicad_y), False, None, "b"), angle, back)
    assert (ox, oy) == pytest.approx((here.x, here.y), abs=1e-5)
    assert math.hypot(*cpl_offset(rule, angle, back)) == pytest.approx(math.hypot(1.44, 0.5))


def test_no_offset_without_a_rule():
    assert cpl_offset(None, 90, True) == (0.0, 0.0)
