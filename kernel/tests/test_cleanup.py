from copper_boards import R0603, board, fp, rect, track, via, zone
from pino_kernel.pcb.cleanup import cleanup
from pino_kernel.pcb.copper import read_copper

PADS = [fp("R1", (-5, 0, 0), R0603, nets={"1": "A", "2": "A"}), fp("R2", (5, 0, 0), R0603, nets={"1": "A", "2": "A"})]

# R1.2 at (-4.2, 0), R2.1 at (4.2, 0)
STUBS = board(footprints=PADS, tracks=[
    track("A", (-4.2, 0), (4.2, 0)),                 # joins the pads, stays
    track("A", (0, 0), (0, 0)),                      # zero-length
    track("A", (-4.2, 0), (4.2, 0)),                 # duplicate
    track("A", (-1, 0), (1, 0)),                     # covered by the first
    track("A", (-4.2, 1), (0, 1), layer="B.Cu"),     # two collinear halves on B.Cu, held by vias at both ends
    track("A", (0, 1), (4.2, 1), layer="B.Cu"),
], vias=[via("A", (-4.2, 1)), via("A", (4.2, 1))])


def test_plan_reasons():
    text, report = cleanup(STUBS, read_copper(STUBS))
    assert sorted(set(report.removed.values())) == ["covered", "duplicate", "merged", "zero-length"]
    assert report.merged == 1
    b = [t for t in read_copper(text).tracks if t.layer == "B.Cu"]
    assert len(b) == 1 and sorted([b[0].a, b[0].b]) == [(-4.2, 1.0), (4.2, 1.0)]


# R1.2 at (-4.2, 0) has a dead end of two segments going up; R1.1 (-5.8, 0) to R2.2 (5.8, 0) joined below
DEAD_END = board(footprints=PADS, tracks=[
    track("A", (-4.2, 0), (-4.2, 3)), track("A", (-4.2, 3), (-2, 3)),
    track("A", (-5.8, 0), (-5.8, -3)), track("A", (-5.8, -3), (5.8, -3)), track("A", (5.8, -3), (5.8, 0)),
])


def test_dead_end_chain_goes_whole_and_never_splits_a_net():
    text, report = cleanup(DEAD_END, read_copper(DEAD_END))
    assert list(report.removed.values()) == ["dangling", "dangling"]
    assert len(read_copper(text).tracks) == 3


def test_single_bridge_between_pads_stays():
    text = board(footprints=PADS, tracks=[track("A", (-4.2, 0), (4.2, 0))])
    _, report = cleanup(text, read_copper(text))
    assert report.removed == {}


def test_locked_copper_is_never_touched():
    text = board(footprints=PADS, tracks=[track("A", (-4.2, 0), (-4.2, 3), locked=True), track("A", (0, 5), (0, 5), locked=True)])
    out, report = cleanup(text, read_copper(text))
    assert report.removed == {} and len(read_copper(out).tracks) == 2


def test_a_track_into_a_fill_island_is_held():
    z = zone("A", "F.Cu", rect(0, 2, 10, 10), fills=[rect(0, 2, 10, 10)])
    text = board(footprints=PADS, tracks=[track("A", (-4.2, 0), (-4.2, 5)), track("A", (-4.2, 5), (3, 5))], zones=[z])
    _, report = cleanup(text, read_copper(text))
    assert report.removed == {}


def test_a_track_touching_an_unfilled_zone_stays():
    z = zone("A", "F.Cu", rect(0, 2, 10, 10))
    text = board(footprints=PADS, tracks=[track("A", (-4.2, 0), (-4.2, 5)), track("A", (-4.2, 5), (3, 5))], zones=[z])
    _, report = cleanup(text, read_copper(text))
    assert report.removed == {}
