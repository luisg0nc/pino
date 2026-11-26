"""JLC's BOM and CPL, from the written board and the circuit."""

import csv
import io

import pytest

from copper_boards import board, fp, pad
from helpers import small_board
from pino_kernel.circuit import PartPose
from pino_kernel.pcb.footprint import FootprintLibrary
from pino_kernel.pcb.writer import write_board
from pino_kernel.release.jlc import (BOM_HEADER, CPL_HEADER, DESIGNATOR_MAX, BomRow, assembled, board_parts, bom_rows,
                                     cpl_rows, write_bom, write_cpl)
from pino_kernel.release.rotations import Rule, load_rules

POSES = {"J1": (-10, 0, 0, False), "C1": (-5, 4, 90, False), "U1": (0, 4, 0, False), "C2": (5, 4, 0, False),
         "U2": (2, -4, 30, True), "C3": (8, -4, 0, False), "R1": (-3, -4, 180, False), "D1": (-8, -6, 0, False)}


def numbered_circuit(**changes):
    """The small board: C numbers by value, R1 hand fit, D1 DNP, J1 without a number."""
    c = small_board().to_circuit()
    numbers = {"C1": "C100", "C2": "C200", "C3": "C300", "U1": "C500", "U2": "C600", "R1": "C700", "D1": "C800"}
    for ref, lcsc in numbers.items():
        c.part(ref).lcsc = lcsc
    c.part("R1").hand_fit = True
    c.part("D1").dnp = True
    for ref, fields in changes.items():
        for k, v in fields.items():
            setattr(c.part(ref), k, v)
    return c


def rows_of(c, rules=None):
    files = write_board(c, {r: PartPose(*p) for r, p in POSES.items()}, FootprintLibrary(__import__(
        "pino_kernel.libraries", fromlist=["discover"]).discover()))
    return cpl_rows(board_parts(files.kicad_pcb), c, load_rules() if rules is None else rules)


def test_board_parts_reads_the_board_frame(fixture_libs):
    c = numbered_circuit()
    files = write_board(c, {r: PartPose(*p) for r, p in POSES.items()},
                        FootprintLibrary(__import__("pino_kernel.libraries", fromlist=["discover"]).discover()))
    parts = {p.ref: p for p in board_parts(files.kicad_pcb)}
    u2 = parts["U2"]
    assert (u2.x, u2.y, u2.angle, u2.back) == pytest.approx((2, -4, 30, True))
    assert u2.lib_id == "pino_test:SOIC6" and u2.value == c.part("U2").value
    from pino_kernel.pcb.footprint import pad_world
    placed = next(p for p in files.placed if p.ref == "U2")
    xs = [x for q in pad_world(placed) for x, _ in q.poly]
    ys = [y for q in pad_world(placed) for _, y in q.poly]
    assert u2.pad_box == pytest.approx((min(xs), min(ys), max(xs), max(ys)), abs=1e-4)


def test_cpl_leaves_out_hand_fit_dnp_and_unnumbered(fixture_libs):
    rows = rows_of(numbered_circuit())
    assert [r.ref for r in rows] == ["C1", "C2", "C3", "U1", "U2"]
    assert not assembled(numbered_circuit().part("R1")) and not assembled(numbered_circuit().part("D1"))


def test_cpl_position_is_the_pad_centre_in_the_board_frame(fixture_libs):
    # a footprint whose origin is off its pads: 2 pads at x 1 and 3, so the centre is 2 mm right of the origin
    text = board(footprints=[fp("J1", (0.0, 0.0, 0.0), [pad("1", (1.0, 0.0), (1.0, 1.0), net="A"),
                                                 pad("2", (3.0, 0.0), (1.0, 1.0), net="B")], lib="x:USB")])
    c = numbered_circuit(J1={"lcsc": "C900"})
    (row,) = cpl_rows(board_parts(text), c, [])
    part = board_parts(text)[0]
    assert (row.x, row.y) == pytest.approx((part.x + 2.0, part.y), abs=1e-4)
    off = Rule("^USB$", "f", 90, (0.5, 0.0), False, None, "b")
    (moved,) = cpl_rows(board_parts(text), c, [off])
    assert (moved.x, moved.y, moved.rotation, moved.rule) == pytest.approx((part.x + 2.5, part.y, 90, "^USB$"))


def test_cpl_rotation_layer_and_override(fixture_libs):
    rows = {r.ref: r for r in rows_of(numbered_circuit(U1={"rotation": 90.0}))}
    assert (rows["U2"].layer, rows["U2"].rotation) == ("bottom", 150)      # 180 - 30, and no rule for the fixture
    assert (rows["C1"].layer, rows["C1"].rotation) == ("top", 90)
    assert (rows["U1"].rotation, rows["U1"].override) == (90, True)
    assert rows["U2"].needs_check and rows["U1"].needs_check


def test_bom_one_row_per_number_in_jlc_columns(fixture_libs):
    c = numbered_circuit(C2={"lcsc": "C100"}, C3={"lcsc": "C100"})
    rows = bom_rows(rows_of(c), c)
    assert [r.lcsc for r in rows] == ["C100", "C500", "C600"]
    first = rows[0]
    assert first.designators == ["C1", "C2", "C3"] and first.quantity == 3
    assert first.comment == "10uF / 1uF / 100nF"
    text = write_bom(rows)
    assert text.splitlines()[0] == "Comment,Designator,Footprint,JLCPCB Part #,Quantity"
    assert '10uF / 1uF / 100nF,"C1,C2,C3",C_0603,C100,3' in text and text.endswith("\n") and "\r" not in text


def test_a_long_designator_list_is_split():
    from pino_kernel.release.jlc import CplRow
    from pino_kernel.circuit import PartSpec

    refs = [f"R{i}" for i in range(1, 601)]
    rows = [CplRow(r, "10k", "R_0402", 0, 0, 0, "top", None, None, False, False) for r in refs]
    circuit = type("C", (), {"part": lambda self, ref: PartSpec(ref, ref, "x:R", "x:R_0402", "10k", "C1", False, "b",
                                                                  "path", [])})()
    split = bom_rows(rows, circuit)
    assert len(split) > 1 and sum(r.quantity for r in split) == 600
    assert all(len(",".join(r.designators)) < DESIGNATOR_MAX and r.quantity == len(r.designators) for r in split)
    assert [d for r in split for d in r.designators] == refs


def test_cpl_header_and_a_row(fixture_libs):
    text = write_cpl(rows_of(numbered_circuit()))
    lines = text.splitlines()
    assert lines[0] == "Designator,Val,Package,Mid X,Mid Y,Rotation,Layer"
    row = next(csv.DictReader(io.StringIO(text)))
    assert row["Designator"] == "C1" and row["Layer"] == "top" and row["Package"] == "C_0603"
    assert len(row["Mid X"].split(".")[1]) == 4 and row["Rotation"] == "90" and "\r" not in text
    assert BOM_HEADER[3] == "JLCPCB Part #" and CPL_HEADER[-1] == "Layer"


def test_minus_zero_is_written_as_zero():
    from pino_kernel.release.jlc import CplRow

    text = write_cpl([CplRow("R1", "1k", "R", -0.00001, 0.0, 0.0, "top", None, None, False, False)])
    assert text.splitlines()[1] == "R1,1k,R,0.0000,0.0000,0,top"
