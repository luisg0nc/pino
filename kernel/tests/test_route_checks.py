import json
from pathlib import Path

import pytest

from copper_boards import QFN32_05, R0603, board, fp, pad, rect, track, via, zone
from pino_kernel.normalize import _unconnected
from pino_kernel.pcb.copper import read_copper
from pino_kernel.routing.checks import (NECK_LENGTH, PAIR_MIN_COUPLED, PAIR_TOLERANCE, TOUCH, Share, complete_nets,
                                        copper_findings, router_drc, unrouted_findings, unrouted_nets)
from pino_kernel.routing.plan import PairStep, RoutePlan, plan_route, router_rules
from route_cases import DRU_2L, PRO_2L

REPORTS = Path(__file__).resolve().parent / "fixtures" / "route_reports"
REFS = {}


def load(name):
    return json.loads((REPORTS / name).read_text())


TWO_R = [fp("R1", (-5, 0, 0), R0603, nets={"1": "A", "2": "A"}), fp("R2", (5, 0, 0), R0603, nets={"1": "A", "2": "A"})]
PLAN = plan_route(board(footprints=TWO_R), PRO_2L, DRU_2L)
WIDTHS = {"A": 0.2, "GND": 0.2, "USB_D+": 0.2, "USB_D-": 0.2}

ROUTED_BOARD = board(footprints=[
    fp("U4", (0, 0, 0), [pad("10", (1, -1)), pad("5", (-2, 1))], nets={"10": "SDA", "5": "GPIO4"}),
    fp("U6", (10, 1, 0), [pad("3", (0, 0))], nets={"3": "SDA"}),
    fp("R3", (-5.2, -2, 0), R0603, nets={"1": "GPIO4"}),
    fp("J1", (-10, -10, 0), [pad("2", (0, 0))], nets={"2": "GPIO4"})])


def test_constants():
    assert (NECK_LENGTH, PAIR_TOLERANCE, PAIR_MIN_COUPLED, TOUCH) == (2.5, 0.02, 0.5, 0.02)


def test_unrouted_nets_by_the_name_in_brackets():
    assert unrouted_nets(load("routed.json")) == {"SDA": 1, "GPIO4": 2}


def test_unrouted_nets_by_position_when_the_report_was_normalized():
    report = load("routed.json")
    report["unconnected_items"] = _unconnected(report["unconnected_items"])
    assert unrouted_nets(report, read_copper(ROUTED_BOARD)) == {"SDA": 1, "GPIO4": 2}


def test_complete_nets():
    c = read_copper(ROUTED_BOARD)
    assert complete_nets(load("routed.json"), c) == (2, 0)


def test_router_drc_drops_baseline_and_parity():
    found = router_drc(load("routed.json"), load("baseline.json"), REFS)
    assert {f.code for f in found} == {"clearance", "track_dangling"} and all(f.source == "drc" for f in found)


def test_share_counts_router_work_only():
    s = Share(nets=31, before=2, after_router=25, after_finish=31, router_seconds=4.0, finish_seconds=2.7)
    assert s.router_share() == pytest.approx(23 / 29)
    assert s.to_json()["router"] == {"routed": 23, "of": 29, "share": 0.793, "seconds": 4.0}
    assert s.to_json()["finish"] == {"routed": 6, "seconds": 2.7} and s.to_json()["nets"] == 31
    assert s.to_json()["done_before"] == 2


def test_nothing_to_route_has_no_share():
    s = Share(nets=3, before=3, after_router=3, after_finish=3, router_seconds=0.0, finish_seconds=0.0)
    assert s.router_share() is None and s.to_json()["router"]["share"] is None


# R1.2 (-4.2, 0) to R2.1 (4.2, 0) routed; a 1.2 mm stub up from R2.2 (5.8, 0); an orphan via
ORPHAN_VIA_AND_STUB = board(footprints=TWO_R, tracks=[track("A", (-4.2, 0), (4.2, 0)), track("A", (5.8, 0), (5.8, 1.2))],
                            vias=[via("A", (0, 8))])


def test_floating_via_and_stub():
    found = copper_findings(read_copper(ORPHAN_VIA_AND_STUB), PLAN, WIDTHS)
    assert {f.code for f in found} == {"copper_floating", "copper_stub"}
    stub = next(f for f in found if f.code == "copper_stub")
    assert "1.2 mm" in stub.message and stub.nets == ("A",) and stub.at.space == "board"
    assert all(f.at is not None and f.nets for f in found)


def test_pour_reaching_one_pad():
    pads = [fp("R1", (-5, 0, 0), R0603, nets={"1": "GND"}), fp("R2", (5, 0, 0), R0603, nets={"1": "GND"})]
    z = zone("GND", "F.Cu", rect(-7, -2, -4, 2), fills=[rect(-7, -2, -5.4, 2)])
    found = copper_findings(read_copper(board(footprints=pads, zones=[z])), PLAN, WIDTHS)
    assert [f.code for f in found] == ["pour_one_pad"] and "R1.1" in found[0].message


def test_loop_on_one_layer():
    tracks = [track("A", (-4.2, 0), (4.2, 0)), track("A", (-4.2, 0), (-4.2, 2)), track("A", (-4.2, 2), (4.2, 2)),
              track("A", (4.2, 2), (4.2, 0))]
    found = copper_findings(read_copper(board(footprints=TWO_R, tracks=tracks)), PLAN, WIDTHS)
    assert [f.code for f in found] == ["copper_loop"] and found[0].severity == "info"


def test_thin_power_track_but_a_neck_at_a_small_pad_is_fine():
    parts = [fp("U1", (0, 0, 0), QFN32_05, nets={"1": "VBUS"}), fp("R1", (5, 10, 0), R0603, nets={"1": "VBUS"})]
    tracks = [track("VBUS", (-2.2, 1.75), (-3.2, 1.75), 0.25), track("VBUS", (-3.2, 1.75), (-3.2, 8), 0.5),
              track("VBUS", (-3.2, 8), (4, 8), 0.25), track("VBUS", (4, 8), (4.2, 10), 0.5)]
    found = copper_findings(read_copper(board(footprints=parts, tracks=tracks)), PLAN, {"VBUS": 0.5})
    thin = [f for f in found if f.code == "track_too_thin"]
    assert len(thin) == 1 and "0.25 mm" in thin[0].message and "0.5 mm" in thin[0].message
    assert thin[0].severity == "error" and thin[0].at.x == pytest.approx(-3.2)


def plan_with_pair(gap):
    rules = router_rules(PRO_2L, DRU_2L)
    return RoutePlan(["F.Cu", "B.Cu"], rules, 0.1, [], [PairStep("USB_D", "USB_D+", "USB_D-", 0.2, gap)], [], [], [], [],
                     [], [])


PAIR_AT_031 = board(tracks=[track("USB_D+", (-5, 0), (5, 0)), track("USB_D-", (-5, -0.51), (5, -0.51))])
PAIR_APART = board(tracks=[track("USB_D+", (-5, 0), (5, 0)), track("USB_D-", (-5, -5), (5, -5))])


def test_pair_gap_and_uncoupled():
    found = [f for f in copper_findings(read_copper(PAIR_AT_031), plan_with_pair(gap=0.2), WIDTHS) if f.code.startswith("pair_")]
    assert [f.code for f in found] == ["pair_gap"] and "0.31" in found[0].message and found[0].severity == "error"
    apart = [f for f in copper_findings(read_copper(PAIR_APART), plan_with_pair(gap=0.2), WIDTHS) if f.code.startswith("pair_")]
    assert [f.code for f in apart] == ["pair_uncoupled"] and apart[0].severity == "warning"
    right = [f for f in copper_findings(read_copper(PAIR_AT_031), plan_with_pair(gap=0.31), WIDTHS) if f.code.startswith("pair_")]
    assert right == []


def test_unrouted_findings_name_the_pins():
    f = unrouted_findings(load("routed.json"), read_copper(ROUTED_BOARD))
    assert [x.nets for x in f] == [("GPIO4",), ("SDA",)] and "U4.10" in f[1].message and f[1].at.space == "board"
    assert f[0].code == "net_unrouted" and f[0].source == "route" and f[0].severity == "error"
    assert "2 connections left" in f[0].message and "1 connection left" in f[1].message
    assert (f[1].at.x, f[1].at.y) == pytest.approx((1.0, 1.0))
