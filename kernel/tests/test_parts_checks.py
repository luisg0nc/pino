"""Stock, class and LCSC-number findings."""

from helpers import usb_circuit
from pino_kernel.checks.parts import ORDER_BOARDS, parts_findings
from pino_kernel.circuit import PartPose
from pino_kernel.parts.jlcsearch import PartLookup
from pino_kernel.parts.model import PartInfo

POSES = {"J1": PartPose(-8, 0, 0, False), "R1": PartPose(1.5, 2, 0, False), "R2": PartPose(3, 2, 0, False),
         "U1": PartPose(6, -1, 90, True)}


def lk(lcsc="C1", klass="basic", stock=100000, fresh=True, error=None, checked="2026-11-26T05:00:00.000Z",
       missing=False, never=False):
    if missing:
        return PartLookup(None, True, None)
    if never:
        return PartLookup(None, False, "jlcsearch could not be reached: offline")
    info = PartInfo(lcsc, "m", "0603", "d", stock, 0.1, klass, checked, "2026-11-26T06:00:00+00:00")
    return PartLookup(info, fresh, error)


def circuit(**parts):
    """usb_circuit with fields set per ref: circuit(R1={"lcsc": "C1"})."""
    c = usb_circuit()
    for ref, fields in parts.items():
        for k, v in fields.items():
            setattr(c.part(ref), k, v)
    return c


def by_code(found):
    out = {}
    for f in found:
        out.setdefault(f.code, []).append(f)
    return out


CIRCUIT = dict(J1={"lcsc": "C3", "line": 4, "why": "the only USB-C with these pads"}, R1={"lcsc": "C2"},
               R2={"lcsc": "C2"}, U1={"lcsc": "C1", "line": 9})


def test_findings_by_class_stock_and_reason():
    found = parts_findings(circuit(**CIRCUIT), POSES, {"C1": lk("C1", "extended", 500), "C2": lk("C2", "basic", 0),
                                                        "C3": lk("C3", "extended", 9000)})
    assert all(f.source == "parts" and f.at.space == "board" for f in found)
    got = by_code(found)
    (empty,) = got["part_no_stock"]
    assert empty.severity == "error" and empty.refs == ("R1", "R2") and "C2" in empty.message
    ext = {f.refs[0]: f for f in got["part_extended"]}
    assert ext["U1"].severity == "warning" and "setup fee" in ext["U1"].message and "why=" in ext["U1"].message
    assert ext["J1"].severity == "info" and ext["J1"].message.startswith("J1 extended: the only USB-C")
    assert (ext["U1"].at.x, ext["U1"].at.y, ext["U1"].at.layer) == (6, -1, "B.Cu")
    assert ext["U1"].message.endswith("(board.py:9)")


def test_strict_makes_missing_numbers_and_reasons_errors():
    c = circuit(R1={"lcsc": "C2"}, U1={"lcsc": "C1"})
    loose = by_code(parts_findings(c, POSES, {"C1": lk(klass="extended"), "C2": lk()}))
    strict = by_code(parts_findings(c, POSES, {"C1": lk(klass="extended"), "C2": lk()}, strict=True))
    assert [f.severity for f in loose["part_no_lcsc"]] == ["info", "info"]
    assert [f.severity for f in strict["part_no_lcsc"]] == ["error", "error"]
    assert "J1 has no LCSC number, so JLC cannot place it: add lcsc=, or hand_fit=True" in loose["part_no_lcsc"][0].message
    assert loose["part_extended"][0].severity == "warning" and strict["part_extended"][0].severity == "error"


def test_hand_fit_and_dnp_parts_are_not_checked():
    c = circuit(J1={"hand_fit": True}, R1={"lcsc": "C2", "dnp": True}, R2={"lcsc": "C2", "hand_fit": True},
                U1={"dnp": True})
    assert parts_findings(c, POSES, {"C2": lk(stock=0)}, strict=True) == []


def test_low_stock_counts_five_boards():
    c = circuit(J1={"hand_fit": True}, U1={"hand_fit": True}, R1={"lcsc": "C2"}, R2={"lcsc": "C2"})
    need = 2 * ORDER_BOARDS
    codes = lambda stock: [(f.code, f.severity) for f in parts_findings(c, POSES, {"C2": lk("C2", stock=stock)})]
    assert codes(need) == [] and codes(need - 1) == [("part_low_stock", "warning")]
    assert codes(1) == [("part_short", "error")] and codes(0) == [("part_no_stock", "error")]
    (low,) = parts_findings(c, POSES, {"C2": lk("C2", stock=9)})
    assert "JLC has 9 of C2" in low.message and "5 boards need 10" in low.message


def test_unknown_stock_and_unknown_parts():
    c = circuit(J1={"hand_fit": True}, U1={"hand_fit": True}, R1={"lcsc": "C2"}, R2={"lcsc": "C3"})
    one = lambda lookup: {f.refs: f for f in parts_findings(c, POSES, {"C2": lookup, "C3": lk("C3")})}[("R1",)]
    f = one(lk("C2", stock=None, checked="2026-11-03T22:33:32.000Z"))
    assert (f.code, f.severity) == ("part_stock_unknown", "warning") and f.message.startswith(
        "stock of C2 not known: last checked 2026-11-03")
    f = one(lk("C2", stock=50, fresh=False, error="timed out", checked=None))
    assert (f.code, f.severity) == ("part_stock_unknown", "warning") and "last checked 2026-11-26" in f.message
    f = one(lk(never=True))
    assert (f.code, f.severity) == ("part_stock_unknown", "info") and "not looked up yet" in f.message
    f = one(lk(missing=True))
    assert (f.code, f.severity) == ("part_unknown", "error") and "JLC has no part C2" in f.message


def test_a_number_that_is_not_jlcs_counts_as_no_number():
    c = circuit(J1={"hand_fit": True}, U1={"hand_fit": True}, R1={"lcsc": "DIGIKEY-1"}, R2={"dnp": True})
    assert [f.code for f in parts_findings(c, POSES, {})] == ["part_no_lcsc"]


def test_preferred_parts_are_info():
    c = circuit(J1={"hand_fit": True}, U1={"hand_fit": True}, R1={"lcsc": "C2"}, R2={"dnp": True})
    (f,) = parts_findings(c, POSES, {"C2": lk("C2", "preferred")})
    assert (f.code, f.severity) == ("part_preferred", "info") and "no setup fee" in f.message
