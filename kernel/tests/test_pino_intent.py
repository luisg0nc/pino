import runpy
from unittest.mock import ANY

import pytest

from helpers import FIXTURES, small_board, small_board_py
from pino import Board, CircuitError, fab
from pino_kernel.circuit import Intent, PinRef


def test_edge_intent_is_recorded(fixture_libs):
    b = small_board(); b.place(b.part("J1"), edge="bottom", center=True)
    assert b.to_circuit().intents[0] == Intent("J1", "bottom", 0.0, None, None, None, None, False, ANY)


def test_near_a_pin_and_a_group(fixture_libs):
    b = small_board(); u2 = b.part("U2")
    leds = b.group("leds", b.part("R1"), b.part("D1"))
    b.place(b.part("C3"), near=u2.VDD, side="left")
    b.place(leds, near=u2, side="right", rot=90)
    c = b.to_circuit()
    assert [(i.target, i.near, i.side, i.rot) for i in c.intents] == [("C3", "U2.1", "left", None), ("group:leds", "U2", "right", 90.0)]
    assert c.groups[0].name == "leds" and c.groups[0].refs == ["R1", "D1"]


def test_fixed_position(fixture_libs):
    b = small_board(); b.place(b.part("R1"), at=(3, -2), rot=90, back=True)
    i = b.to_circuit().intents[0]
    assert (i.at, i.rot, i.back) == ((3.0, -2.0), 90.0, True)


def test_conflicting_intent(fixture_libs):
    for kw in ({"edge": "bottom", "at": (0, 0)}, {"near": "x", "at": (0, 0)}, {"side": "top"}, {"edge": "north"},
               {"center": True}, {"edge": "top", "near": "U1"}, {"along": 3.0}):
        b = small_board()
        with pytest.raises(CircuitError):
            b.place(b.part("J1"), **kw)


def test_place_twice(fixture_libs):
    b = small_board(); j1 = b.part("J1")
    b.place(j1, edge="bottom"); first = j1.board._intents["J1"].line
    with pytest.raises(CircuitError, match=rf"J1 is placed twice \(lines {first} and \d+\)"):
        b.place(j1, edge="top")


def test_outline_path_is_relative_to_board_py(tmp_path, fixture_libs, monkeypatch):
    project = tmp_path / "proj"; project.mkdir()
    (project / "outline.json").write_text((FIXTURES / "outline/enclosure.json").read_text())
    (project / "board.py").write_text(small_board_py(outline='"outline.json"'))
    elsewhere = tmp_path / "elsewhere"; elsewhere.mkdir(); monkeypatch.chdir(elsewhere)
    c = runpy.run_path(str(project / "board.py"))["b"].to_circuit()
    assert (c.outline.width, c.outline.source, len(c.outline.holes)) == (56, "outline.json", 4)
    assert [k.source for k in c.keepouts] == ["outline.json"]


def test_missing_outline_file(tmp_path, fixture_libs):
    b = small_board(outline='"nowhere.json"')
    with pytest.raises(CircuitError, match="outline file nowhere.json"):
        b.validate()


def test_keepout_rectangle_becomes_a_polygon(fixture_libs):
    b = small_board(); b.keepout(region=(0, 0, 10, 6), why="antenna")
    k = b.to_circuit().keepouts[0]
    assert k.polygon == [(0, 0), (10, 0), (10, 6), (0, 6)] and k.layers == ["*.Cu"] and k.source == "board.py"


def test_keepout_arguments(fixture_libs):
    with pytest.raises(CircuitError, match="forbid"):
        small_board().keepout(region=(0, 0, 1, 1), forbid=("cars",))
    with pytest.raises(CircuitError, match="this board has no In1.Cu"):
        small_board().keepout(region=(0, 0, 1, 1), layers="In1.Cu")


def test_net_class_with_unknown_net(fixture_libs):
    b = small_board(); b.net_class("power", ["VBUSS"], width=0.5)
    with pytest.raises(CircuitError, match="net class power names VBUSS, which is no net"):
        b.validate()


def test_net_class_takes_fab_minimums(fixture_libs):
    b = small_board(); vbus = b.net_class("power", ["VBUS", "+3V3"], width=0.5)
    nc = b.to_circuit().net_classes[0]
    assert (nc.nets, nc.width, nc.clearance, nc.via_diameter, nc.via_drill) == (["VBUS", "+3V3"], 0.5, 0.15, 0.6, 0.3)


def test_zone_layer_must_exist(fixture_libs):
    with pytest.raises(CircuitError, match="this board has no In1.Cu"):
        small_board().zone("GND", layer="In1.Cu")
    b = small_board(layers=4); b.zone("GND", layer="In1.Cu")
    z = b.to_circuit().zones[0]
    assert (z.net, z.layer, z.polygon) == ("GND", "In1.Cu", None)


def test_zone_with_unknown_net(fixture_libs):
    b = small_board(); b.zone("NOPE", layer="B.Cu")
    with pytest.raises(CircuitError, match="zone on B.Cu names NOPE, which is no net"):
        b.validate()


def test_layers_and_fab_must_agree(fixture_libs):
    with pytest.raises(CircuitError, match="2 or 4"):
        Board("t", layers=3, outline=(10, 10))
    with pytest.raises(CircuitError, match="jlc-standard-4layer is for 4 layers"):
        Board("t", layers=2, outline=(10, 10), fab=fab.jlc_standard_4layer)
    assert Board("t", layers=4, outline=(10, 10)).fab is None


def test_expect_path_records_pins(fixture_libs):
    b = small_board(); j1, u1 = b.part("J1"), b.part("U1")
    b.expect_path(j1["VBUS"], u1["VIN"])
    e = b.to_circuit().expects[0]
    assert e.kind == "path" and e.a == [PinRef("J1", n) for n in "1234"] and e.b == [PinRef("U1", "1")]


def test_expect_apart_and_through(fixture_libs):
    b = small_board(); u2, r1, d1 = b.part("U2"), b.part("R1"), b.part("D1")
    b.expect_path(u2.IO1, d1.A, through=[r1]); b.expect_apart(u2.IO1, d1.K)
    a, c = b.to_circuit().expects
    assert (a.kind, a.through) == ("path", ["R1"]) and (c.kind, c.a, c.b) == ("apart", [PinRef("U2", "3")], [PinRef("D1", "1")])
