import math

import pytest

from helpers import FIXTURES
from pino_kernel.outline import OutlineError, load_outline, outline_keepouts, outline_points, polygon, rectangle


def test_rounded_rectangle_is_closed():
    segs = outline_points(40, 30, 2)
    assert [s[0] for s in segs].count("arc") == 4 and len(segs) == 8
    ends = [s[-1] for s in segs]; starts = [s[1] for s in segs]
    assert all(math.dist(e, s) < 1e-6 for e, s in zip(ends, starts[1:] + starts[:1]))


def test_load_keeps_y_up_and_reads_mounts():
    spec = load_outline(FIXTURES / "outline/enclosure.json")
    assert (spec.width, spec.height) == (56, 44)
    assert [(h.name, h.x, h.y, h.drill) for h in spec.holes][0] == ("H1", -24.5, 18.5, 3.2)
    assert [h.courtyard for h in spec.holes] == [5.0, 5.0, 6.0, pytest.approx(5.2)]
    assert spec.height_limit == {"top": 12.0, "bottom": 3.0} and spec.source == "outline.json"
    # the notch sits in the +x+y corner: the point (27, 21) is cut away
    from pino_kernel.geometry import point_in_polygon
    poly = polygon(spec)
    assert not point_in_polygon((27.0, 21.0), poly) and point_in_polygon((-26.5, 20.5), poly)


def test_cutout_that_does_not_fit():
    with pytest.raises(OutlineError, match="does not fit"):
        outline_points(20, 20, 1, cutouts=[{"x": 2, "y": 2, "boss": 6}])


def test_rectangle_and_polygon():
    spec = rectangle(40, 30)
    xs = [p[0] for p in polygon(spec)]; ys = [p[1] for p in polygon(spec)]
    assert (min(xs), max(xs), min(ys), max(ys)) == pytest.approx((-20, 20, -15, 15))
    assert spec.holes == [] and spec.source == "board.py"


def test_outline_keepouts_grow_by_half_a_millimetre():
    (k,) = outline_keepouts(FIXTURES / "outline/enclosure.json")
    assert k.source == "outline.json" and k.why == "lid screw boss" and k.layers == ["*.Cu"]
    assert set(k.forbid) == {"tracks", "vias", "pads", "copperpour", "footprints"}
    assert max(math.dist(p, (0, 10)) for p in k.polygon) == pytest.approx(2.5)
