"""The label step: each part's reference label beside it, clear of pads, part bodies, labels and the edge."""

import dataclasses
import os
import subprocess
import sys
from pathlib import Path

import pytest

from helpers import board_from_text
from pino.board import CircuitError
from pino_kernel.circuit import Circuit, PartPose
from pino_kernel.coords import from_kicad
from pino_kernel.geometry import bbox
from pino_kernel.pcb.footprint import FootprintLibrary, courtyard_world, pad_world, rotate
from pino_kernel.pcb.labels import Label, label_box, part_body, place_labels, spots, text_size
from pino_kernel.pcb.writer import fab_of, placed_parts, write_board
from pino_kernel.sexpr import find, find_all, parse

TESTS = Path(__file__).resolve().parent

# The fixture R_0603's courtyard is 3.0 by 1.5 mm round its origin, its F.Fab body 1.6 by 0.8, its pads reach 1.2 mm
# either side and 0.475 mm up and down, and its silk lines sit 0.55 mm above and below the origin, 0.12 mm wide.
CY_W, CY_H = 3.0, 1.5
FAB_W, FAB_H = 1.6, 0.8
PAD_X = 1.2
SILK_Y = 0.55 + 0.06


def parts_py(n: int, extra: str = "", outline=(40, 30)) -> str:
    lines = ["from pino import Board", f"b = Board('labels', outline={tuple(outline)})", "m = b.block('m', 'Parts')"]
    lines += [f"r{i} = m.path('R{i}', 'pino_test:R', '1k')" for i in range(1, n + 1)]
    lines += [f"b.net('N{i}', r{i}[2], r{i + 1}[1])" for i in range(1, n)]
    lines += [f"b.gnd(r1[1], r{n}[2])"]
    return "\n".join(lines) + "\n" + extra


def labels_of(fixture_libs, n, poses, extra="", fab=None):
    circuit = board_from_text(parts_py(n, extra)).to_circuit()
    placement = {f"R{i}": PartPose(*poses.get(f"R{i}", (-15 + 3.5 * i, -10, 0)), False) if len(poses.get(f"R{i}", ())) < 4
                 else PartPose(*poses[f"R{i}"]) for i in range(1, n + 1)}
    placed = placed_parts(circuit, placement, FootprintLibrary(fixture_libs))
    labels, findings = place_labels(circuit, placed, fab or fab_of(circuit))
    return labels, findings, placed, circuit, placement


def boxed(ref, label: Label) -> tuple:
    return label_box(label.x, label.y, *text_size(ref, label.size, label.thickness), label.angle)


def overlaps(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def boxed_in(n, gap):
    """R1 at the origin, R2 and R3 right on its top and bottom, R4 and R5 off its left and right with `gap` mm between
    their pads and R1's."""
    return {"R1": (0, 0, 0), "R2": (0, CY_H, 0), "R3": (0, -CY_H, 0),
            "R4": (-2 * PAD_X - gap, 0, 0), "R5": (2 * PAD_X + gap, 0, 0)}


def fab_box(p) -> tuple:
    """The fixture R_0603's F.Fab rectangle on the board (the tests turn it by 0 only)."""
    return (p.x - FAB_W / 2, p.y - FAB_H / 2, p.x + FAB_W / 2, p.y + FAB_H / 2)


def test_text_size_follows_kicads_stroke_font():
    w, h = text_size("R1", 1.0, 0.15)
    assert (round(w, 3), round(h, 3)) == (1.673, 1.25)  # kicad-cli draws R1's ink 1.524 wide and 1.0 high
    assert round(text_size("C10", 1.0, 0.15)[0], 3) == 2.673
    assert text_size("R1", 0.8, 0.15)[0] < w


def test_spots_go_top_bottom_left_right_centred_first():
    found = spots((0, 0, 4, 2), 1.0, 0.5, 0.0, gap=0.0)
    assert [s[0] for s in found] == ["top"] * 3 + ["bottom"] * 3 + ["left"] * 3 + ["right"] * 3
    assert found[0] == ("top", 2.0, 2.25) and found[3] == ("bottom", 2.0, -0.25)
    assert found[6] == ("left", -0.5, 1.0) and found[9] == ("right", 4.5, 1.0)
    assert found[1] == ("top", 0.5, 2.25) and found[2] == ("top", 3.5, 2.25)  # flush with either end
    turned = spots((0, 0, 4, 2), 1.0, 0.5, 90.0, gap=0.0)
    assert turned[0] == ("top", 2.0, 2.5) and turned[6] == ("left", -0.25, 1.0)  # the text's box stands up


def test_a_lone_part_gets_its_label_above_and_clear(fixture_libs):
    labels, findings, placed, _, _ = labels_of(fixture_libs, 2, {"R1": (0, 0, 0)})
    lab = labels["R1"]
    assert not lab.hidden and lab.angle == 0 and lab.size == 1.0 and lab.x == 0
    box = boxed("R1", lab)
    assert box[1] > SILK_Y  # above its own silk, inside its own courtyard's margin
    r1 = next(p for p in placed if p.ref == "R1")
    assert not any(overlaps(box, bbox(q.poly)) for q in pad_world(r1))
    assert findings == []


def test_each_label_keeps_off_the_other_parts_and_labels(fixture_libs):
    poses = {f"R{i}": (-12 + 3.2 * i, (i % 2) * 2.2, 0) for i in range(1, 7)}
    labels, _, placed, _, _ = labels_of(fixture_libs, 6, poses)
    boxes = {ref: boxed(ref, lab) for ref, lab in labels.items() if not lab.hidden}
    assert len(boxes) == 6
    for ref, box in boxes.items():
        for p in placed:
            assert not overlaps(box, fab_box(p)), (ref, p.ref)
        for other, ob in boxes.items():
            assert other == ref or not overlaps(box, ob), (ref, other)


def test_a_blocked_top_falls_to_below_then_left(fixture_libs):
    labels, *_ = labels_of(fixture_libs, 3, {"R1": (0, 0, 0), "R2": (0, CY_H, 0)})
    assert labels["R1"].y < 0 and labels["R1"].x == 0 and labels["R1"].angle == 0
    labels, *_ = labels_of(fixture_libs, 3, {"R1": (0, 0, 0), "R2": (0, CY_H, 0), "R3": (0, -CY_H, 0)})
    assert labels["R1"].x < -CY_W / 2 and labels["R1"].y == 0 and labels["R1"].angle == 0


def test_a_gap_too_narrow_for_the_text_takes_it_turned(fixture_libs):
    labels, findings, *_ = labels_of(fixture_libs, 5, boxed_in(5, 1.8))
    lab = labels["R1"]
    assert (lab.angle, lab.size, lab.y, lab.hidden) == (90, 1.0, 0, False)
    assert -PAD_X - 1.8 < lab.x < -PAD_X  # in the gap on the left
    assert "R1" not in {r for f in findings for r in f.refs}


def test_shrinks_to_fit_and_never_below_the_fab_minimum(fixture_libs):
    base = fab_of(board_from_text(parts_py(5)).to_circuit())
    small = dataclasses.replace(base, silk_min_text_height=0.6)
    labels, _, *_ = labels_of(fixture_libs, 5, boxed_in(5, 1.5), fab=small)
    lab = labels["R1"]
    assert (lab.angle, lab.size, lab.hidden) == (90, 0.8, False)
    assert lab.thickness >= small.silk_min_width
    # the same gap with JLC's 1 mm floor: no smaller text, so the label is hidden
    labels, *_ = labels_of(fixture_libs, 5, boxed_in(5, 1.5))
    assert labels["R1"].hidden and labels["R1"].size == 1.0


def test_a_hidden_label_is_an_info_finding_naming_the_parts(fixture_libs):
    _, findings, *_ = labels_of(fixture_libs, 5, boxed_in(5, 1.5))
    hid = [f for f in findings if f.code == "label_hidden"]
    assert len(hid) == 1 and hid[0].severity == "info" and hid[0].source == "placement"
    assert "R1" in hid[0].refs and "R1" in hid[0].message and "b.label()" in hid[0].message


def test_labels_never_cross_the_board_edge(fixture_libs):
    circuit = board_from_text(parts_py(2, outline=(10, 4))).to_circuit()
    # R1 sits near the top edge: the label goes below it, inside the board
    placement = {"R1": PartPose(0, 0.6, 0, False), "R2": PartPose(10, 10, 0, False)}
    placed = placed_parts(circuit, placement, FootprintLibrary(fixture_libs))
    labels, _ = place_labels(circuit, placed, fab_of(circuit))
    box = boxed("R1", labels["R1"])
    assert labels["R1"].y < 0.6 and box[1] > -2 + 0.2 and box[3] < 2 - 0.2


def test_bottom_parts_get_their_labels_by_the_bottom_side(fixture_libs):
    # R2 on the top, right above R1 on the bottom: it does not block R1's label on B.SilkS
    labels, _, _, circuit, placement = labels_of(fixture_libs, 2, {"R1": (0, 0, 0, True), "R2": (0, CY_H, 0, False)})
    assert labels["R1"].y > 0 and labels["R1"].x == 0
    files = write_board(circuit, placement, FootprintLibrary(fixture_libs))
    prop = reference_of(files.kicad_pcb, "R1")
    assert str(find(prop, "layer")[1]) == "B.SilkS"
    assert find(find(prop, "effects"), "justify") is not None  # mirrored


def test_hand_labels_win(fixture_libs):
    lone = {"R1": (0, 0, 0)}
    labels, *_ = labels_of(fixture_libs, 2, lone, 'b.label(r1, side="bottom")\n')
    assert labels["R1"].y < 0 and labels["R1"].x == 0
    labels, *_ = labels_of(fixture_libs, 2, lone, "b.label(r1, at=(1.5, -2), rot=90)\n")
    assert (labels["R1"].x, labels["R1"].y, labels["R1"].angle) == (1.5, -2, 90)
    labels, findings, *_ = labels_of(fixture_libs, 2, lone, "b.label(r1, hide=True)\n")
    assert labels["R1"].hidden and findings == []  # hidden by hand is no finding
    labels, *_ = labels_of(fixture_libs, 2, lone, "b.label(r1, rot=90)\n")
    assert labels["R1"].angle == 90 and labels["R1"].y > 0 and not labels["R1"].hidden


def test_automatic_labels_keep_clear_of_a_hand_label(fixture_libs):
    poses = {"R1": (0, 0, 0), "R2": (8, 0, 0)}
    free, *_ = labels_of(fixture_libs, 2, poses)
    # R2's hand label goes where R1's would; R1 takes its next spot
    spot = (free["R1"].x - 8, free["R1"].y)
    labels, *_ = labels_of(fixture_libs, 2, poses, f"b.label(r2, at={spot})\n")
    assert (labels["R2"].x, labels["R2"].y) == (free["R1"].x, free["R1"].y)
    assert (labels["R1"].x, labels["R1"].y) != (free["R1"].x, free["R1"].y)
    assert not overlaps(boxed("R1", labels["R1"]), boxed("R2", labels["R2"]))


def test_same_labels_every_time(fixture_libs):
    poses = {f"R{i}": (-12 + 3.2 * i, (i % 2) * 2.2, 90 * (i % 2)) for i in range(1, 7)}
    a, *_ = labels_of(fixture_libs, 6, poses)
    b, *_ = labels_of(fixture_libs, 6, poses)
    assert a == b


def reference_of(pcb_text, ref):
    for fp in find_all(parse(pcb_text), "footprint"):
        for prop in find_all(fp, "property"):
            if prop[1] == "Reference" and prop[2] == ref:
                return prop
    raise KeyError(ref)


def footprint_at(pcb_text, ref):
    for fp in find_all(parse(pcb_text), "footprint"):
        if any(p[1] == "Reference" and p[2] == ref for p in find_all(fp, "property")):
            at = find(fp, "at")
            return float(at[1]), float(at[2]), float(at[3]) if len(at) > 3 else 0.0
    raise KeyError(ref)


@pytest.mark.parametrize("rot", [0, 90, 180, 270, 30])
def test_the_board_file_puts_the_reference_where_the_label_is(fixture_libs, rot):
    labels, _, _, circuit, placement = labels_of(fixture_libs, 2, {"R1": (2, 1, rot)})
    files = write_board(circuit, placement, FootprintLibrary(fixture_libs))
    prop = reference_of(files.kicad_pcb, "R1")
    X, Y, _ = footprint_at(files.kicad_pcb, "R1")
    at = find(prop, "at")
    dx, dy = rotate(float(at[1]), float(at[2]), rot)
    x, y = from_kicad(X + dx, Y + dy)
    lab = labels["R1"]
    assert (round(x, 4), round(y, 4)) == (lab.x, lab.y)
    assert float(at[3]) == lab.angle and find(prop, "hide") is None
    font = find(find(prop, "effects"), "font")
    assert [float(v) for v in find(font, "size")[1:]] == [lab.size, lab.size]


def test_the_board_file_hides_a_hidden_label(fixture_libs):
    _, _, _, circuit, placement = labels_of(fixture_libs, 2, {"R1": (0, 0, 0)}, "b.label(r1, hide=True)\n")
    files = write_board(circuit, placement, FootprintLibrary(fixture_libs))
    prop = reference_of(files.kicad_pcb, "R1")
    assert str(find(prop, "hide")[1]) == "yes"
    assert [c[0] for c in prop if isinstance(c, list)][:4] == ["at", "layer", "hide", "uuid"]  # KiCad's order


def test_write_board_reports_the_hidden_labels(fixture_libs):
    _, _, _, circuit, placement = labels_of(fixture_libs, 5, boxed_in(5, 1.5))
    files = write_board(circuit, placement, FootprintLibrary(fixture_libs))
    assert [f.code for f in files.findings] == ["label_hidden"]


def test_same_board_file_across_hash_seeds(fixture_libs, tmp_path):
    code = ("import sys; sys.path.insert(0, sys.argv[1]); import hashlib, test_labels as t;"
            "from pino_kernel.libraries import discover;"
            "_, _, _, c, pl = t.labels_of(discover(), 6, {f'R{i}': (-12 + 3.2 * i, (i % 2) * 2.2, 0) for i in range(1, 7)});"
            "from pino_kernel.pcb.writer import write_board; from pino_kernel.pcb.footprint import FootprintLibrary;"
            "print(hashlib.sha256(write_board(c, pl, FootprintLibrary(discover())).kicad_pcb.encode()).hexdigest())")
    out = set()
    for seed in ("1", "4242"):
        r = subprocess.run([sys.executable, "-c", code, str(TESTS)], env={**os.environ, "PYTHONHASHSEED": seed},
                           capture_output=True, text=True, cwd=tmp_path)
        assert r.returncode == 0, r.stderr
        out.add(r.stdout.strip())
    assert len(out) == 1


# --- board.py ---------------------------------------------------------------------------------------------------


def test_label_is_in_the_circuit_and_survives_json(fixture_libs):
    c = board_from_text(parts_py(2, 'b.label(r1, side="left", rot=90)\nb.label(r2, hide=True)\n')).to_circuit()
    back = Circuit.from_json(c.to_json())
    assert [(s.ref, s.side, s.at, s.rot, s.hide) for s in back.labels] == [("R1", "left", None, 90.0, False),
                                                                          ("R2", None, None, None, True)]
    assert back.labels[0].line == 8  # the line of board.py that set it


@pytest.mark.parametrize("call, says", [
    ('b.label(r1, side="up")', "side='up'"),
    ('b.label(r1, side="top", at=(0, 1))', "side= and at= cannot go together"),
    ('b.label(r1, hide=True, rot=90)', "hide=True"),
    ('b.label(r1)', "needs side=, at=, rot= or hide=True"),
    ('b.label(r1, at=(1,))', "at= takes (dx, dy)"),
    ('b.label(r1, at={})', "at= takes (dx, dy)"),
    ("b.label(r1, at='12')", "at= takes (dx, dy)"),
    ('b.label(r1, at=(1, 2, 3))', "at= takes (dx, dy)"),
    ('b.label(r1, rot="up")', "rot= takes degrees"),
    ('b.label("R1", side="top")', "takes a part"),
    ('b.label(r1, side="top")\nb.label(r1, side="left")', "set twice"),
])
def test_label_refuses_what_it_cannot_do(fixture_libs, call, says):
    with pytest.raises(CircuitError) as e:
        board_from_text(parts_py(2, call + "\n"))
    assert says in str(e.value)


# --- turns that are not a multiple of 90 -----------------------------------------------------------------------


@pytest.mark.parametrize("rot", [30, 45])
def test_a_slanted_label_fits_beside_a_lone_part(fixture_libs, rot):
    labels, findings, placed, _, _ = labels_of(fixture_libs, 2, {"R1": (0, 0, 0)}, f"b.label(r1, rot={rot})\n")
    lab = labels["R1"]
    assert not lab.hidden and lab.angle == rot and findings == []
    box = boxed("R1", lab)
    r1 = next(p for p in placed if p.ref == "R1")
    assert box[1] > SILK_Y and not overlaps(box, fab_box(r1))


@pytest.mark.parametrize("rot", [30, 45])
def test_a_slanted_hand_label_on_a_side_stands_clear_of_its_part(fixture_libs, rot):
    labels, *_ = labels_of(fixture_libs, 2, {"R1": (0, 0, 0)}, f'b.label(r1, side="left", rot={rot})\n')
    box = boxed("R1", labels["R1"])
    assert labels["R1"].angle == rot and box[2] < -PAD_X and labels["R1"].y == 0


def test_spots_take_a_slanted_texts_whole_box():
    hw = label_box(0, 0, 1.0, 0.5, 45)[2]
    found = spots((0, 0, 4, 2), 1.0, 0.5, 45.0, gap=0.0)
    assert found[0] == ("top", 2.0, round(2 + hw, 4)) and found[6] == ("left", round(-hw, 4), 1.0)


# --- a label board.py sets that pino cannot draw ---------------------------------------------------------------


def test_a_hand_label_on_a_part_with_no_silk_reference_is_a_finding(fixture_libs):
    circuit = board_from_text(parts_py(2, 'b.label(r1, side="left")\n')).to_circuit()
    placement = {"R1": PartPose(0, 0, 0, False), "R2": PartPose(8, 0, 0, False)}
    placed = placed_parts(circuit, placement, FootprintLibrary(fixture_libs))
    r1 = next(p for p in placed if p.ref == "R1")
    # the footprint draws its Reference on F.Fab only
    node = [c if not (isinstance(c, list) and c and c[0] == "property" and c[1] == "Reference") else
            [x if not (isinstance(x, list) and x and x[0] == "layer") else [x[0], "F.Fab"] for x in c]
            for c in r1.footprint.node]
    r1.footprint = dataclasses.replace(r1.footprint, node=node)
    labels, findings = place_labels(circuit, placed, fab_of(circuit))
    assert "R1" not in labels
    f = [f for f in findings if f.code == "label_not_drawn"]
    assert len(f) == 1 and f[0].refs == ("R1",) and f[0].severity == "warning" and "R1" in f[0].message


# --- what a label keeps off: a part's body, not its courtyard ---------------------------------------------------


def test_a_label_may_sit_over_a_neighbours_courtyard_margin(fixture_libs):
    # R2 2.71 mm above R1: their courtyards are 1.21 mm apart, too little for R1's label (1.25 mm high), but R2's
    # body, pads and silk leave room for it
    labels, findings, placed, _, _ = labels_of(fixture_libs, 2, {"R1": (0, 0, 0), "R2": (0, 2.71, 0)})
    lab = labels["R1"]
    assert not lab.hidden and (lab.x, lab.angle, lab.size) == (0, 0, 1.0) and lab.y > 0
    r2 = next(p for p in placed if p.ref == "R2")
    box = boxed("R1", lab)
    assert overlaps(box, bbox(courtyard_world(r2)["F"][0]))
    assert not overlaps(box, fab_box(r2))
    assert not any(overlaps(box, bbox(q.poly)) for q in pad_world(r2))
    assert findings == []


def test_a_label_never_sits_over_a_neighbours_body(fixture_libs):
    # as above, but R2's body reaches 1 mm down from its origin, past its pads and silk: R1's label goes below
    circuit = board_from_text(parts_py(2)).to_circuit()
    placement = {"R1": PartPose(0, 0, 0, False), "R2": PartPose(0, 2.71, 0, False)}
    placed = placed_parts(circuit, placement, FootprintLibrary(fixture_libs))
    r2 = placed[1]
    tall = [["fp_rect", ["start", -0.8, -1.0], ["end", 0.8, 1.0], ["layer", "F.Fab"]] if is_fab(c) else c
            for c in r2.footprint.node]
    r2.footprint = dataclasses.replace(r2.footprint, node=tall)
    labels, _ = place_labels(circuit, placed, fab_of(circuit))
    assert labels["R1"].y < 0 and labels["R1"].x == 0
    assert not overlaps(boxed("R1", labels["R1"]), bbox(part_body(r2, "F")))


def is_fab(c) -> bool:
    return isinstance(c, list) and bool(c) and str(c[0]).startswith("fp_") and find(c, "layer") is not None \
        and find(c, "layer")[1] == "F.Fab"


def without_fab(p):
    node = [c for c in p.footprint.node if not is_fab(c)]
    p.footprint = dataclasses.replace(p.footprint, node=node)
    return p


def test_a_parts_body_is_its_fab_outline(fixture_libs):
    _, _, placed, _, _ = labels_of(fixture_libs, 2, {"R1": (2, 1, 0), "R2": (0, 0, 0, True)})
    r1, r2 = placed
    assert bbox(part_body(r1, "F")) == (2 - FAB_W / 2, 1 - FAB_H / 2, 2 + FAB_W / 2, 1 + FAB_H / 2)
    assert part_body(r1, "B") == []
    assert bbox(part_body(r2, "B")) == (-FAB_W / 2, -FAB_H / 2, FAB_W / 2, FAB_H / 2) and part_body(r2, "F") == []


def test_a_footprint_with_no_fab_outline_uses_its_pads_and_silk(fixture_libs):
    _, _, placed, _, _ = labels_of(fixture_libs, 2, {"R1": (2, 1, 0)})
    r1 = without_fab(placed[0])
    # the pads reach 1.2 mm either side, the silk lines run 0.55 mm above and below
    assert bbox(part_body(r1, "F")) == (2 - PAD_X, round(1 - 0.55, 6), 2 + PAD_X, 1 + 0.55)
    assert part_body(r1, "B") == []
