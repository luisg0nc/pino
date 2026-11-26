import json
import math

import pytest

from copper_boards import R0603, board, fp, pad
from pino_kernel.circuit import PairSpec, RouteHint
from pino_kernel.geometry import point_in_polygon
from pino_kernel.pcb.copper import read_copper
from pino_kernel.routing.plan import (FanoutStep, PlaneStep, PowerNet, RoutePlan, RouterRules, add_router_items,
                                      fab_overrides_text, hole_keepouts, net_class_widths, plan_route,
                                      region_keepouts, router_rules, strip_router_items)
from pino_kernel.sexpr import find, find_all, parse
from route_cases import (DRU_2L, MODULE, PRO_2L, PULLS, QFN, SOT, USB, USB_PAIR, board_with,
                         board_with_gnd_zone_and_usb, board_with_locked_vbus_and_gnd_zone, board_with_mounting_holes,
                         board_with_power_nets, pro)

BOARD = board(footprints=PULLS)


def test_rules_from_pro_and_dru():
    assert router_rules(PRO_2L, DRU_2L) == RouterRules(0.2, 0.2, 0.6, 0.3, 0.15, 0.15, 0.25, 0.5, 0.3)


def test_dru_raises_the_minimums():
    dru = DRU_2L.replace('(rule "pino: clearance"\n\t(constraint clearance (min 0.1mm))',
                         '(rule "pino: clearance"\n\t(constraint clearance (min 0.18mm))')
    assert router_rules(PRO_2L, dru).min_clearance == 0.18


def test_hole_clearance_defaults_to_kicads():
    assert router_rules(pro(hole_clearance=None), None).hole_clearance == 0.25


def test_hole_clearance_gap_grows_the_via():
    rr = router_rules(pro(clearance=0.15, min_clearance=0.15, via=(0.45, 0.3), hole_clearance=0.254), None)
    assert rr.via_diameter == 0.51


def test_fab_overrides_file():
    assert fab_overrides_text(router_rules(PRO_2L, DRU_2L)).splitlines() == [
        "track_width = 0.15", "clearance = 0.15", "via_diameter = 0.6", "via_drill = 0.3", "hole_to_hole = 0.5"]


def test_net_class_widths():
    assert net_class_widths(PRO_2L, ["VBUS", "SDA", "+3V3"]) == {"VBUS": 0.5, "SDA": 0.2, "+3V3": 0.5}


def test_fanout_only_for_four_sided_fine_pitch():
    p = plan_route(board_with(QFN, USB, SOT, MODULE), PRO_2L, DRU_2L)
    assert [s.ref for s in p.fanout] == ["U1"] and p.grid_step == 0.05
    s = p.fanout[0]
    assert s == FanoutStep("U1", 0.5, 0.2, 0.15)
    assert plan_route(board_with(SOT), PRO_2L, DRU_2L).grid_step == 0.1


def test_planes_from_zones_on_four_layers_and_signals_exclude_planes_and_pairs():
    p = plan_route(board_with_gnd_zone_and_usb(4), pro(), DRU_2L, pairs=[USB_PAIR])
    assert p.planes == [PlaneStep("GND", ["In1.Cu"])] and not {"GND", "USB_D+", "USB_D-"} & set(p.signals)
    assert p.pairs[0].width == 0.2 and p.pairs[0].gap == 0.2 and p.signals == sorted(p.signals)
    assert p.layers == ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]


def test_two_layer_ground_goes_as_tracks():
    p = plan_route(board_with_gnd_zone_and_usb(2), PRO_2L, DRU_2L)
    assert p.planes == [] and "GND" in p.signals


def test_planes_can_be_asked_for():
    p = plan_route(board_with_gnd_zone_and_usb(2), PRO_2L, DRU_2L, planes={"GND": ["B.Cu"]})
    assert p.planes == [PlaneStep("GND", ["B.Cu"])] and "GND" not in p.signals


def test_power_widths_from_net_classes():
    assert plan_route(board_with_power_nets(), PRO_2L, DRU_2L).power == [PowerNet("+3V3", 0.5), PowerNet("VBUS", 0.5)]


def test_rip_never_names_kept_or_plane_nets():
    p = plan_route(board_with_locked_vbus_and_gnd_zone(), PRO_2L, DRU_2L, hints=[RouteHint("SDA", None, None, None, ["*"], 9)])
    rip = p.hints[0].rip
    assert "*" not in rip and not {"VBUS", "GND", "SDA"} & set(rip) and "SCL" in rip


def test_a_net_joined_by_kept_copper_is_not_routed():
    assert "VBUS" not in plan_route(board_with_locked_vbus_and_gnd_zone(), PRO_2L, DRU_2L).signals


def test_hint_for_an_unknown_net_is_a_warning():
    p = plan_route(BOARD, PRO_2L, DRU_2L, hints=[RouteHint("NOPE", None, None, None, [], 4)])
    assert p.hints == [] and p.warnings[0].code == "route_hint_unknown" and "line 4" in p.warnings[0].message


def test_region_keepouts_cover_the_rest():
    ks = region_keepouts((-5, -5, 5, 5), (-20, -15, 20, 15), ["F.Cu", "B.Cu"])
    assert len(ks) == 4 and not any(point_in_polygon((0, 0), k.polygon) for k in ks)
    assert sum(point_in_polygon((10, 0), k.polygon) for k in ks) == 1
    assert all(k.name.startswith("pino-router:region:") and k.layers == ["F.Cu", "B.Cu"] for k in ks)


def test_npth_holes_get_router_keepouts():
    ks = hole_keepouts(read_copper(board_with_mounting_holes()), router_rules(PRO_2L, DRU_2L))
    assert [k.name for k in ks] == ["pino-router:hole:H1", "pino-router:hole:H2", "pino-router:hole:H3", "pino-router:hole:H4"]
    assert max(math.dist((-24.5, 18.5), pt) for pt in ks[0].polygon) == pytest.approx(1.6 + 0.25 + 0.1, abs=0.02)


def test_router_items_are_rule_areas_and_strip_cleanly():
    text = add_router_items(BOARD, region_keepouts((-5, -5, 5, 5), (-20, -15, 20, 15), ["F.Cu"]), corridor=[(0, 0), (5, 5)])
    z = [n for n in find_all(parse(text), "zone") if str(find(n, "name")[1]).startswith("pino-router:")]
    assert len(z) == 4 and all(find(find(n, "keepout"), "tracks")[1] == "not_allowed" for n in z)
    assert all(find(find(n, "keepout"), "vias")[1] == "not_allowed" for n in z)
    lines = [n for n in find_all(parse(text), "gr_line") if find(n, "layer")[1] == "User.1"]
    assert len(lines) == 1
    assert strip_router_items(text) == BOARD


def test_plan_json_round_trip():
    p = plan_route(board_with_locked_vbus_and_gnd_zone(), PRO_2L, DRU_2L, pairs=[USB_PAIR],
                   hints=[RouteHint("SDA", (-5, -5, 5, 5), ["F.Cu"], [(0.0, 0.0), (1.0, 1.0)], ["SC*"], 9)])
    assert RoutePlan.from_json(p.to_json()) == p and RoutePlan.from_json(p.to_json()).to_json() == p.to_json()
    assert json.loads(p.to_json())["grid_step"] == p.grid_step


def test_fine_grid_for_any_fine_pitch_row():
    # a USB-C receptacle's pads are 0.5 mm apart: off the 0.1 mm grid, so the router needs 0.05 mm
    p = plan_route(board_with(USB, SOT), PRO_2L, DRU_2L)
    assert p.fanout == [] and p.grid_step == 0.05


def antenna_board():
    """A footprint with no-net copper drawn on F.Cu: one rectangle touching its feed pad, one apart."""
    from pino_kernel.sexpr import dump, parse

    text = board(footprints=[fp("AE1", (10, 5, 0), [pad("1", (0, 0), (0.5, 0.5), net="FEED")], nets={"1": "FEED"}),
                             fp("R1", (0, 0, 0), R0603, nets={"1": "FEED"})])
    root = parse(text)
    ae = next(n for n in root[1:] if isinstance(n, list) and n[0] == "footprint" and "AE1" in dump(n))
    ae.append(parse('(fp_poly (pts (xy -0.25 -4) (xy 0.25 -4) (xy 0.25 0) (xy -0.25 0)) (stroke (width 0) (type solid)) (fill yes) (layer "F.Cu") (uuid "g1"))'))
    ae.append(parse('(fp_poly (pts (xy 2 -4) (xy 3 -4) (xy 3 -3) (xy 2 -3)) (stroke (width 0) (type solid)) (fill yes) (layer "F.Cu") (uuid "g2"))'))
    return dump(root) + "\n"


def test_no_net_footprint_copper_gets_router_keepouts():
    from copper_boards import pad
    p = plan_route(antenna_board(), PRO_2L, DRU_2L)
    ks = {k.name: k for k in p.keepouts if k.name.startswith("pino-router:graphic:")}
    assert sorted(ks) == ["pino-router:graphic:AE1#1", "pino-router:graphic:AE1#2"]
    touching, apart = ks["pino-router:graphic:AE1#1"], ks["pino-router:graphic:AE1#2"]
    assert touching.forbid_tracks is False and apart.forbid_tracks is True and touching.layers == ["F.Cu"]
    # grown by the clearance and half a via: the apart rectangle spans x 12..13, y 8..9 in board mm (AE1 at (10, 5))
    assert min(x for x, _ in apart.polygon) == pytest.approx(12 - 0.2 - 0.3) and max(y for _, y in apart.polygon) == pytest.approx(9 + 0.5)
    text = add_router_items(antenna_board(), p.keepouts)
    zones = {str(find(z, "name")[1]): z for z in find_all(parse(text), "zone")}
    assert find(find(zones["pino-router:graphic:AE1#1"], "keepout"), "tracks")[1] == "allowed"
    assert find(find(zones["pino-router:graphic:AE1#1"], "keepout"), "vias")[1] == "not_allowed"


def test_router_keeps_the_pad_hole_spacing_of_the_fab_rules():
    from pino_kernel import fab
    from pino_kernel.pcb.rules import kicad_dru

    # the fab's rules split hole to hole into vias (0.2) and pads (0.45): the router keeps the wider one
    assert router_rules(pro(hole_to_hole=0.2), kicad_dru(fab.jlc_standard_2layer)).hole_to_hole == 0.45
