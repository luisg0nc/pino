import math
import os
import subprocess
import sys
from itertools import combinations
from pathlib import Path

import pytest

from helpers import small_board, small_board_py
from pino_kernel.circuit import PartPose, placement_to_json
from pino_kernel.geometry import bbox, inside, polygons_overlap
from pino_kernel.outline import polygon
from pino_kernel.pcb.footprint import FootprintLibrary, courtyard_world, pad_world
from pino_kernel.placement.placer import place

TESTS = Path(__file__).resolve().parent


@pytest.fixture
def fp_lib(fixture_libs):
    return FootprintLibrary(fixture_libs)


def board_from(text):
    scope = {"__name__": "__main__"}
    exec(compile(text, "board.py", "exec"), scope)
    return scope["b"]


MODULE = '''
u3 = mcu.path("U3", "pino_test:IC6", "MOD", footprint="pino_test:MODULE_ANT")
b.nc_rest(u3)
'''


def board_with(intent, outline=(40, 30), module=False, groups=None):
    text = small_board_py(outline=repr(str(outline)) if isinstance(outline, str) else str(tuple(outline)))
    text += MODULE if module else ""
    for name, refs in (groups or {}).items():
        text += f'{name} = b.group("{name}", ' + ", ".join(f'b.part("{r}")' for r in refs) + ")\n"
    for ref, kw in intent.items():
        target = ref if ref in (groups or {}) else f'b.part("{ref}")'
        args = ", ".join(f"{k}={v!r}" if k != "near" else f'near=b.part("{v}")' if "." not in v else
                         f'near=b.part("{v.split(".")[0]}")["{v.split(".")[1]}"]' for k, v in kw.items())
        text += f"b.place({target}, {args})\n"
    return board_from(text).to_circuit()


def many_parts(n, outline=(40, 30)):
    lines = ["from pino import Board", f"b = Board('many', outline={tuple(outline)})", "m = b.block('m', 'Many')"]
    lines += [f"r{i} = m.path('R{i}', 'pino_test:R', '1k')" for i in range(1, n + 1)]
    lines += [f"b.net('N{i}', r{i}[2], r{i + 1}[1])" for i in range(1, n)]
    lines += [f"b.gnd(r1[1], r{n}[2])"]
    return board_from("\n".join(lines) + "\n").to_circuit()


def placed_of(r, ref):
    return next(p for p in r.placed if p.ref == ref)


def pad(r, ref, number):
    p = next(q for q in pad_world(placed_of(r, ref)) if q.number == number)
    return (p.x, p.y)


def distance(a, b):
    return math.dist(a, b)


def no_overlaps(r):
    for a, b in combinations(r.placed, 2):
        ca, cb = courtyard_world(a), courtyard_world(b)
        for side in ("F", "B"):
            for pa in ca.get(side, []):
                for pb in cb.get(side, []):
                    if polygons_overlap(pa, pb):
                        return False
    return True


def all_inside(r, circuit):
    outline = polygon(circuit.outline)
    return all(inside(poly, outline) for p in r.placed for polys in courtyard_world(p).values() for poly in polys)


def test_fixed_position_is_exact(fixture_libs, fp_lib):
    r = place(board_with(intent={"R1": {"at": (3.0, -2.0), "rot": 90}}), fp_lib)
    assert r.placement["R1"] == PartPose(3.0, -2.0, 90, False)


def test_edge_center_is_flush(fixture_libs, fp_lib):
    r = place(board_with(intent={"J1": {"edge": "bottom", "center": True}}, outline=(40, 30)), fp_lib)
    assert r.placement["J1"].x == 0 and r.placement["J1"].rot == 0
    assert bbox(courtyard_world(placed_of(r, "J1"))["F"][0])[1] == pytest.approx(-15.0, abs=0.05)


def test_edge_face_sets_rotation(fixture_libs, fp_lib):
    r = place(board_with(intent={"U3": {"edge": "top"}, "J1": {"edge": "right"}}, module=True), fp_lib)   # MODULE_ANT faces top, USB_Edge faces bottom
    assert (r.placement["U3"].rot, r.placement["J1"].rot) == (0, 90)
    assert bbox(courtyard_world(placed_of(r, "J1"))["F"][0])[2] == pytest.approx(20.0, abs=0.05)


def test_near_side_top(fixture_libs, fp_lib):
    r = place(board_with(intent={"J1": {"edge": "bottom", "center": True}, "U1": {"near": "J1", "side": "top"}}), fp_lib)
    assert r.placement["U1"].y > r.placement["J1"].y and no_overlaps(r)
    assert bbox(courtyard_world(placed_of(r, "U1"))["F"][0])[1] >= bbox(courtyard_world(placed_of(r, "J1"))["F"][0])[3]


def test_group_stays_together(fixture_libs, fp_lib):
    r = place(board_with(intent={"leds": {"edge": "left"}}, groups={"leds": ["R1", "D1"]}), fp_lib)
    assert distance((r.placement["R1"].x, r.placement["R1"].y), (r.placement["D1"].x, r.placement["D1"].y)) < 8
    assert r.placement["R1"].x < -10


def test_satellite_sits_by_its_pin(fixture_libs, fp_lib):
    r = place(small_board().to_circuit(), fp_lib)
    assert distance(pad(r, "C3", "1"), pad(r, "U2", "1")) < 6.0          # C3 decouples U2's VDD


def test_keepout_is_respected(fixture_libs, fp_lib):
    b = small_board(); b.keepout(region=(-15, -10, -2, 10), why="no parts here", forbid=("footprints",))
    r = place(b.to_circuit(), fp_lib)
    keep = [(-15, -10), (-2, -10), (-2, 10), (-15, 10)]
    assert not any(polygons_overlap(poly, keep) for p in r.placed for polys in courtyard_world(p).values() for poly in polys)
    assert not [f for f in r.findings if f.code == "placement_no_room"]


def test_module_keepout_keeps_other_parts_out(fixture_libs, fp_lib):
    from pino_kernel.pcb.footprint import keepouts_world
    r = place(board_with(intent={"U3": {"edge": "top", "center": True}}, module=True), fp_lib)
    zone = keepouts_world(placed_of(r, "U3"))[0]
    others = [p for p in r.placed if p.ref != "U3"]
    assert not any(polygons_overlap(poly, zone) for p in others for polys in courtyard_world(p).values() for poly in polys)


def test_no_overlaps_on_a_full_board(fixture_libs, fp_lib):
    c = many_parts(30, outline=(40, 30)); r = place(c, fp_lib)
    assert no_overlaps(r) and all_inside(r, c) and not r.findings


def test_no_room_is_a_finding_not_a_crash(fixture_libs, fp_lib):
    r = place(many_parts(30, outline=(10, 10)), fp_lib)
    room = [f for f in r.findings if f.code == "placement_no_room"]
    assert room and len(r.placement) == 30 and room[0].at.space == "board" and room[0].severity == "warning"


def test_intent_loop(fixture_libs, fp_lib):
    r = place(board_with(intent={"U1": {"near": "U2"}, "U2": {"near": "U1"}}), fp_lib)
    loops = [f for f in r.findings if f.code == "placement_loop"]
    assert loops and set(loops[0].refs) == {"U1", "U2"} and loops[0].severity == "error" and len(r.placement) == 8


def test_same_placement_across_hash_seeds(fixture_libs, tmp_path):
    code = ("import sys; sys.path.insert(0, sys.argv[1]); import test_placer as t; from helpers import small_board;"
            "from pino_kernel.libraries import discover; from pino_kernel.pcb.footprint import FootprintLibrary;"
            "from pino_kernel.circuit import placement_to_json;"
            "print(placement_to_json(t.place(small_board().to_circuit(), FootprintLibrary(discover())).placement))")
    outs = set()
    for seed in ("1", "98765"):
        p = subprocess.run([sys.executable, "-c", code, str(TESTS)], env={**os.environ, "PYTHONHASHSEED": seed},
                           capture_output=True, text=True, cwd=tmp_path)
        assert p.returncode == 0, p.stderr
        outs.add(p.stdout)
    assert len(outs) == 1


def test_hundred_parts_in_under_five_seconds(fixture_libs, fp_lib):
    r = place(many_parts(100, outline=(80, 60)), fp_lib)
    assert r.seconds < 5.0 and len(r.placement) == 100 and no_overlaps(r)


def test_score_is_reported(fixture_libs, fp_lib):
    r = place(small_board().to_circuit(), fp_lib)
    assert r.score.length > 0 and r.score.total >= r.score.length * 0.2 - 1e-9


def test_a_module_meets_the_edge_where_its_antenna_keepout_begins(fixture_libs, fp_lib):
    from pino_kernel.pcb.footprint import keepouts_world
    r = place(board_with(intent={"U3": {"edge": "top", "center": True}}, module=True), fp_lib)
    zone = keepouts_world(placed_of(r, "U3"))[0]
    assert bbox(zone)[1] >= 15.0 - 0.3                    # the keep-out starts at the top edge (y 15), off the board
    pads = [q for q in pad_world(placed_of(r, "U3"))]
    assert max(y for q in pads for _, y in q.poly) <= 15.0 - 0.3 + 1e-6


def test_edge_part_pads_keep_the_copper_to_edge_distance(fixture_libs, fp_lib):
    from pino_kernel.geometry import distance_to_edges
    c = board_with(intent={"U3": {"edge": "top", "center": True}}, module=True)
    r = place(c, fp_lib)
    outline = polygon(c.outline)
    assert min(distance_to_edges(pt, outline) for q in pad_world(placed_of(r, "U3")) for pt in q.poly) >= 0.3 - 1e-6
