import pytest

from helpers import ANY_LINE, board_from_text, board_with_usb_pair, small_board, usb_nets_board_py
from pino import CircuitError, via
from pino_kernel.circuit import FixedVia, PairSpec, PinRef, RouteHint, RouteStep


def test_keep_route_records_pins_steps_and_line(fixture_libs):
    b = small_board()
    j1, u1 = b.part("J1"), b.part("U1")
    b.keep_route("VBUS", frm=j1[1], to=u1["VIN"], layer="F.Cu", points=[(2.0, 1.0), via(3.0, 1.0, to="B.Cu"), (5.0, 1.0)])
    k = b.to_circuit().kept_routes[0]
    assert (k.net, k.frm, k.to, k.layer, k.width) == ("VBUS", PinRef("J1", "1"), PinRef("U1", "1"), "F.Cu", None)
    assert k.steps == [RouteStep("point", 2.0, 1.0, None), RouteStep("via", 3.0, 1.0, "B.Cu"), RouteStep("point", 5.0, 1.0, None)]
    assert k.line > 0


def test_keep_route_from_a_point(fixture_libs):
    b = small_board()
    b.keep_route("VBUS", frm=(1.0, 2.0), to=b.part("U1")["VIN"], layer="B.Cu", width=0.5)
    k = b.to_circuit().kept_routes[0]
    assert k.frm == (1.0, 2.0) and k.width == 0.5


def test_keep_route_point_outside_the_board(fixture_libs):
    b = small_board()
    b.keep_route("VBUS", frm=(40.0, 0.0), to=b.part("U1")["VIN"], layer="F.Cu")
    with pytest.raises(CircuitError, match=r"\(40, 0\) is outside the board"):
        b.validate()


def test_keep_route_pin_on_another_net(fixture_libs):
    b = small_board()
    with pytest.raises(CircuitError, match=r"keep_route VBUS: U2\.6 is on net \S+, not VBUS") as e:
        b.keep_route("VBUS", frm=b.part("U2")[6], to=b.part("U1")["VIN"], layer="F.Cu")
        b.validate()
    assert e.value.line > 0


def test_keep_route_needs_one_pin(fixture_libs):
    b = small_board()
    with pytest.raises(CircuitError, match="frm must be one pin"):
        b.keep_route("VBUS", frm=b.part("J1")["VBUS"], to=b.part("U1")["VIN"], layer="F.Cu")


def test_keep_route_width_below_the_fab(fixture_libs):
    b = small_board()
    b.keep_route("VBUS", frm=b.part("J1")[1], to=b.part("U1")["VIN"], layer="F.Cu", width=0.1)
    with pytest.raises(CircuitError, match="below the fab's 0.15 mm"):
        b.validate()


def test_via_step_must_change_layer(fixture_libs):
    b = small_board()
    with pytest.raises(CircuitError, match=r"via at \(3, 1\) does not change layer"):
        b.keep_route("VBUS", frm=b.part("J1")[1], to=b.part("U1")["VIN"], layer="F.Cu", points=[via(3, 1, to="F.Cu")])


def test_keep_route_unknown_layer(fixture_libs):
    b = small_board()
    with pytest.raises(CircuitError, match="this board has no In1.Cu"):
        b.keep_route("VBUS", frm=b.part("J1")[1], to=b.part("U1")["VIN"], layer="In1.Cu")


def test_route_hint_records_region_layers_rip(fixture_libs):
    b = small_board()
    b.route_hint("VBUS", region=(-5, -5, 5, 5), layers=["B.Cu"], rip=["*"])
    assert b.to_circuit().route_hints[0] == RouteHint("VBUS", (-5.0, -5.0, 5.0, 5.0), ["B.Cu"], None, ["*"], ANY_LINE)


def test_route_hint_corridor(fixture_libs):
    b = small_board()
    b.route_hint("STATUS", corridor=[(0, 0), (5, 5)])
    assert b.to_circuit().route_hints[0].corridor == [(0.0, 0.0), (5.0, 5.0)]
    with pytest.raises(CircuitError, match="corridor needs at least two points"):
        b.route_hint("STATUS", corridor=[(0, 0)])
    with pytest.raises(CircuitError, match="rip patterns must not be empty"):
        b.route_hint("STATUS", rip=[""])


def test_route_hint_bad_region_and_layer(fixture_libs):
    b = small_board()
    with pytest.raises(CircuitError, match=r"region must be \(x0, y0, x1, y1\) with x0 < x1 and y0 < y1"):
        b.route_hint("VBUS", region=(5, 5, -5, -5))
    with pytest.raises(CircuitError, match="this board has no In1.Cu"):
        b.route_hint("VBUS", layers=["In1.Cu"])


def test_route_hint_unknown_net(fixture_libs):
    b = small_board()
    b.route_hint("SDA")
    with pytest.raises(CircuitError, match="route_hint: no net SDA"):
        b.validate()


def test_diff_pair_recorded(fixture_libs):
    c = board_with_usb_pair().to_circuit()
    assert c.pairs == [PairSpec("USB_D", "USB_D+", "USB_D-", None, None, ANY_LINE)]


def test_diff_pair_names_must_pair(fixture_libs):
    with pytest.raises(CircuitError, match="named like USB_D\\+ and USB_D- or USB_D_P and USB_D_N"):
        board_from_text(usb_nets_board_py(pair=True, names=("DP", "DM")))


def test_net_in_two_pairs(fixture_libs):
    text = usb_nets_board_py(pair=True) + 'b.diff_pair("USB_D+", "USB_D-")\n'
    with pytest.raises(CircuitError, match="net USB_D\\+ is in two diff pairs"):
        board_from_text(text)


def test_fixed_via_recorded_and_unknown_net(fixture_libs):
    b = small_board()
    b.fixed_via("GND", at=(1, 2))
    assert b.to_circuit().fixed_vias == [FixedVia("GND", 1.0, 2.0, None, None, ANY_LINE)]
    b.fixed_via("GNDD", at=(1, 2))
    with pytest.raises(CircuitError, match="fixed_via: no net GNDD"):
        b.validate()


def test_fixed_via_too_small(fixture_libs):
    b = small_board()
    b.fixed_via("GND", at=(1, 2), diameter=0.4, drill=0.2)
    with pytest.raises(CircuitError, match="below the fab's"):
        b.validate()
