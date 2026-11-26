import json

import pytest

from copper_boards import R0603, board, fp, pad, rect, track, via, zone
from pino_kernel.geometry import bbox, point_segment_distance, segment_distance, segment_polygon_distance
from pino_kernel.pcb.copper import (copper_json, copper_nodes, merge_copper, move_footprint, read_copper,
                                    rewrite_uuids, strip_copper)
from pino_kernel.sexpr import dump, find, find_all, parse

U1 = "11111111-1111-4111-8111-111111111111"
U2 = "22222222-2222-4222-8222-222222222222"


def pad_of(c, ref, number):
    return next(p for p in c.pads if p.ref == ref and p.number == number)


def uuid_of(node):
    return str(find(node, "uuid")[1])


KRT_LIKE = board(
    footprints=[fp("R1", (-10, 0, 0), R0603, nets={"1": "N0", "2": "N1"})],
    tracks=[track(f"N{i % 5}", (i * 0.5, 0), (i * 0.5, 1 + i * 0.1), 0.2, "F.Cu" if i % 2 else "B.Cu") for i in range(39)]
    + [track("N0", (0, 0), (0, 1), 0.2, "B.Cu")],
    vias=[via(f"N{i}", (i, 5)) for i in range(5)])


def test_geometry_distances():
    assert point_segment_distance((0, 1), (-1, 0), (1, 0)) == pytest.approx(1)
    assert segment_distance((0, 0), (2, 0), (1, -1), (1, 1)) == 0
    assert segment_distance((0, 0), (1, 0), (0, 2), (1, 2)) == pytest.approx(2)
    sq = rect(0, 0, 1, 1)
    assert segment_polygon_distance((0.5, 0.5), (0.6, 0.6), sq) == 0
    assert segment_polygon_distance((-1, 0.5), (2, 0.5), sq) == 0
    assert segment_polygon_distance((2, 0), (2, 1), sq) == pytest.approx(1)


def test_read_copper_in_board_frame():
    c = read_copper(board(tracks=[track("A", (-5, 2), (5, 2), 0.2, "F.Cu")]))
    t = c.tracks[0]
    assert (t.a, t.b, t.layer, t.net, t.locked, t.width) == ((-5.0, 2.0), (5.0, 2.0), "F.Cu", "A", False, 0.2)
    assert c.layers == ["F.Cu", "B.Cu"]


def test_read_vias_arcs_and_locked():
    c = read_copper(board(tracks=[track("A", (0, 0), (1, 0), locked=True)], vias=[via("A", (1, 0), 0.6, 0.3)]))
    assert c.tracks[0].locked and c.vias[0].at == (1.0, 0.0) and c.vias[0].layers == ("F.Cu", "B.Cu")
    assert (c.vias[0].diameter, c.vias[0].drill) == (0.6, 0.3)


def test_pad_polygons_turn_and_flip():
    c = read_copper(board(footprints=[fp("R1", (10, 5, 90), R0603), fp("R2", (0, 0, 0), R0603, back=True)]))
    assert bbox(pad_of(c, "R1", "1").polygon) == pytest.approx((9.6, 3.75, 10.4, 4.65), abs=0.01)
    assert pad_of(c, "R2", "1").layers == ("B.Cu", "B.Mask", "B.Paste")
    assert pad_of(c, "R1", "1").size == (0.9, 0.8) and pad_of(c, "R1", "1").through is False


def test_through_pad_and_npth():
    pads = [pad("1", (0, 0), (1.6, 1.6), shape="circle", kind="thru_hole", layers=("*.Cu", "*.Mask"), drill=0.8),
            pad("", (3, 0), (3.2, 3.2), shape="circle", kind="np_thru_hole", layers=("*.Cu", "*.Mask"), drill=3.2)]
    c = read_copper(board(footprints=[fp("J1", (0, 0, 0), pads, nets={"1": "A"})]))
    p1 = pad_of(c, "J1", "1")
    assert p1.through and p1.drill == 0.8 and p1.net == "A"
    h = pad_of(c, "J1", "")
    assert h.net is None and h.drill == 3.2


def test_fills_are_islands():
    z = zone("GND", "B.Cu", rect(-10, -10, 10, 10), fills=[rect(-9, -9, -1, 9), rect(1, -9, 9, 9)])
    c = read_copper(board(zones=[z]))
    assert len(c.fills) == 2 and {f.zone for f in c.fills} == {"GND_B.Cu"} and all(f.net == "GND" for f in c.fills)
    assert bbox(c.fills[1].polygon) == pytest.approx((1, -9, 9, 9))


def test_merge_keeps_locked_and_replaces_the_rest():
    base = board(tracks=[track("A", (0, 0), (1, 0), locked=True, uuid=U1), track("B", (0, 1), (1, 1), uuid=U2)])
    routed = board(tracks=[track("A", (0, 0), (1, 0), locked=True), track("C", (0, 2), (1, 2))])
    out = read_copper(merge_copper(base, copper_nodes(routed)))
    assert sorted((t.net, t.locked) for t in out.tracks) == [("A", True), ("C", False)]
    assert [t.uuid for t in out.tracks if t.net == "A"] == [U1]


def test_merge_puts_copper_before_the_zones():
    base = board(zones=[zone("GND", "B.Cu", rect(-10, -10, 10, 10))])
    out = parse(merge_copper(base, copper_nodes(board(tracks=[track("C", (0, 2), (1, 2))]))))
    kinds = [str(n[0]) for n in out[1:] if isinstance(n, list)]
    assert kinds.index("segment") < kinds.index("zone")


def test_rewrite_uuids_is_order_free_and_unique():
    nodes = copper_nodes(KRT_LIKE)
    assert len(nodes) == 45
    a, b = rewrite_uuids(nodes), rewrite_uuids(list(reversed(nodes)))
    assert [dump(n) for n in a] == [dump(n) for n in b] and len({uuid_of(n) for n in a}) == len(a)
    assert {uuid_of(n) for n in a}.isdisjoint({uuid_of(n) for n in nodes})


def test_rewrite_uuids_leaves_locked_alone():
    nodes = copper_nodes(board(tracks=[track("A", (0, 0), (1, 0), locked=True, uuid=U1)]))
    assert uuid_of(rewrite_uuids(nodes)[0]) == U1


def test_net_names_with_plus_quotes_and_unicode_survive_merge():
    nets = ["+3V3", "Net-(R1-Pad2)", "Ω_SENSE", 'A"B']
    out = read_copper(merge_copper(board(), copper_nodes(board(tracks=[track(n, (0, i), (1, i)) for i, n in enumerate(nets)]))))
    assert sorted(t.net for t in out.tracks) == sorted(nets)


def test_copper_json_is_canonical():
    c = read_copper(KRT_LIKE)
    assert copper_json(c) == copper_json(read_copper(KRT_LIKE))
    data = json.loads(copper_json(c))
    assert data["schema"] == "pino.copper/1" and len(data["tracks"]) == 40 and len(data["vias"]) == 5
    assert [t["uuid"] for t in data["tracks"]] == sorted(t["uuid"] for t in data["tracks"])
    assert set(data["tracks"][0]) == {"uuid", "net", "layer", "width", "points", "kept"}
    assert set(data["vias"][0]) == {"uuid", "net", "layers", "diameter", "drill", "points", "kept"}
    assert copper_json(c).endswith("}\n")


def test_strip_and_move():
    z = zone("GND", "B.Cu", rect(-10, -10, 10, 10), fills=[rect(-9, -9, 9, 9)])
    text = board(footprints=[fp("R1", (1, 1, 0), R0603)], tracks=[track("A", (0, 0), (1, 0))], vias=[via("A", (1, 0))],
                 zones=[z])
    bare = parse(strip_copper(text))
    assert not find_all(bare, "segment") and not find_all(bare, "via")
    assert find_all(bare, "footprint") and find(find(bare, "zone"), "polygon") and not find(find(bare, "zone"), "filled_polygon")
    moved = read_copper(move_footprint(text, "R1", 1.0, 0.0))
    assert pad_of(moved, "R1", "1").polygon[0][0] - pad_of(read_copper(text), "R1", "1").polygon[0][0] == pytest.approx(1.0)


def test_move_footprint_moves_its_own_zones():
    text = board(footprints=[fp("U1", (0, 0, 0), R0603)])
    root = parse(text)
    fpn = find(root, "footprint")
    fpn.append(parse('(zone (layer "F.Cu") (uuid "u") (name "ant") (keepout (tracks not_allowed)) (polygon (pts (xy 99 99) (xy 101 99) (xy 101 101))))'))
    moved = parse(move_footprint(dump(root), "U1", 1.0, 2.0))
    pts = find(find(find(find(moved, "footprint"), "zone"), "polygon"), "pts")
    assert [float(v) for v in pts[1][1:]] == [100.0, 97.0]
