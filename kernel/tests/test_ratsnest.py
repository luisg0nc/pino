import pytest

from pino_kernel.placement.ratsnest import (
    WEIGHTS, EdgeIndex, PadPoint, count_among, length, mst, net_edges, ratsnest, score,
)

CROSSING_NETS = {"A": [PadPoint(0, 0, "F", "R1", "1"), PadPoint(10, 10, "F", "R2", "1")],
                 "B": [PadPoint(0, 10, "F", "R3", "1"), PadPoint(10, 0, "F", "R4", "1")]}


def _fixed_edges():
    """60 edges from a fixed formula (no randomness), on a mix of sides and nets."""
    out = []
    for k in range(60):
        a = ((k * 37) % 50, (k * 53) % 40)
        b = ((k * 71 + 13) % 50, (k * 29 + 7) % 40)
        out.append((f"N{k % 7}", a, b, "FBX"[k % 3]))
    return out


FIXED_EDGES = _fixed_edges()


def test_mst_of_a_square():
    pts = [(0, 0), (10, 0), (10, 10), (0, 10)]
    assert len(mst(pts)) == 3 and length(net_edges("N", [(*p, "F", "R", "1") for p in pts])) == pytest.approx(30)


def test_crossings_know_sides():
    x = lambda side: {"A": [PadPoint(0, 0, side, "R1", "1"), PadPoint(10, 10, side, "R2", "1")]}
    other = {"B": [PadPoint(0, 10, "F", "R3", "1"), PadPoint(10, 0, "F", "R4", "1")]}
    assert score({**x("F"), **other}).crossings == 1
    assert score({**x("B"), **other}).crossings == 0
    assert score({**x("X"), **other}).crossings == 1
    assert score({**x("B"), **other}, any_side=True).crossings == 1


def test_planes_are_left_out():
    assert score(CROSSING_NETS, planes={"A"}).crossings == 0
    assert [e[0] for e in ratsnest(CROSSING_NETS, planes={"A"})] == ["B"]


def test_total_uses_pcb_kit_weights():
    s = score(CROSSING_NETS)
    assert WEIGHTS == {"cross": 10.0, "length": 0.2}
    assert s.total == pytest.approx(10.0 * s.crossings + 0.2 * s.length)
    assert s.points == [pytest.approx((5.0, 5.0))]


def test_index_agrees_with_brute_force():
    edges = FIXED_EDGES
    assert EdgeIndex(edges).count_within() == count_among(edges) > 0


def test_net_order_does_not_change_the_score():
    a = score({"B": CROSSING_NETS["B"], "A": CROSSING_NETS["A"]})
    assert a == score(CROSSING_NETS)
