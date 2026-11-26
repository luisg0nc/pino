import math

import pytest

from pino_kernel.geometry import (
    arc_points, bbox, circle_polygon, distance_to_edges, inside, point_in_polygon, polygons_overlap,
)

SQ = [(0, 0), (10, 0), (10, 10), (0, 10)]


def test_touching_squares_do_not_overlap():
    right = [(10, 0), (20, 0), (20, 10), (10, 10)]
    assert not polygons_overlap(SQ, right)
    assert polygons_overlap(SQ, [(9, 0), (20, 0), (20, 10), (9, 10)])
    assert polygons_overlap(SQ, SQ) and polygons_overlap(SQ, [(2, 2), (3, 2), (3, 3), (2, 3)])


def test_crossing_bars_overlap():
    assert polygons_overlap([(4, -5), (6, -5), (6, 15), (4, 15)], SQ)


def test_l_shape_containment():
    ell = [(0, 0), (10, 0), (10, 4), (4, 4), (4, 10), (0, 10)]
    assert inside([(1, 1), (3, 1), (3, 3), (1, 3)], ell)
    assert not inside([(6, 6), (8, 6), (8, 8), (6, 8)], ell)          # in the notch of the L
    assert not inside([(2, 2), (8, 2), (8, 8), (2, 8)], ell)          # crosses the notch


def test_point_in_polygon_and_distance():
    assert point_in_polygon((5, 5), SQ) and point_in_polygon((0, 5), SQ) and not point_in_polygon((11, 5), SQ)
    assert distance_to_edges((5, 1), SQ) == pytest.approx(1.0)


def test_arc_points_run_from_start_to_end():
    pts = arc_points((1, 0), (math.cos(math.pi / 4), math.sin(math.pi / 4)), (0, 1), chord=0.05)
    assert pts[0] == (1, 0) and pts[-1] == (0, 1)
    assert all(abs(math.hypot(*p) - 1) < 1e-9 for p in pts) and len(pts) > 20
    assert bbox(circle_polygon(0, 0, 2)) == pytest.approx((-2, -2, 2, 2), abs=0.01)
