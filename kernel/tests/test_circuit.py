import json
import pytest

from pino_kernel.circuit import (
    BlockSpec, Circuit, CircuitSchemaError, Expect, GroupSpec, Hole, Intent, Keepout, NetClassSpec, NetSpec,
    OutlineSpec, PartPose, PartSpec, PinInfo, PinRef, ZoneSpec, placement_from_json, placement_to_json,
)
from pino_kernel.findings import At, Finding


@pytest.fixture
def sample_circuit():
    outline = OutlineSpec(40.0, 30.0, [("line", (-18.0, -15.0), (18.0, -15.0)), ("arc", (18.0, -15.0), (19.4, -14.4), (20.0, -13.0))],
                          [Hole("H1", -17.5, 12.5, 3.2, 5.0)], {"top": 12.0, "bottom": 3.0}, "outline.json")
    pins = [PinInfo("1", "~", "passive"), PinInfo("2", "~", "passive")]
    return Circuit(
        schema="pino.circuit/1", name="sample", layers=2, fab="jlc-standard-2layer", outline=outline,
        blocks=[BlockSpec("p", "Power", ["R1", "C1"])],
        parts=[PartSpec("R1", "pullup", "pino_test:R", "pino_test:R_0603", "10k", "C25804", False, "p", "path", pins, 7),
               PartSpec("C1", "C1", "pino_test:C", "pino_test:C_0603", "4.7µF", "", True, "p", "shunt", pins, 8)],
        nets=[NetSpec("VBUS", "supply", True, "power:VBUS", [PinRef("R1", "1"), PinRef("C1", "1")], 9),
              NetSpec("GND", "gnd", False, "power:GND", [PinRef("C1", "2")], 10)],
        no_connects=[PinRef("R1", "2")], nc_rest={"R1": ["2"]},
        intents=[Intent("R1", "bottom", 0.0, None, None, None, None, False, 11),
                 Intent("C1", None, None, "R1.1", "top", None, 90.0, False, 12),
                 Intent("group:leds", None, None, None, None, (1.5, -2.0), 0.0, True, 13)],
        groups=[GroupSpec("leds", ["R1", "C1"], 14)],
        keepouts=[Keepout([(0.0, 0.0), (10.0, 0.0), (10.0, 6.0)], ["F.Cu", "B.Cu"], ["tracks", "vias"], "antenna", "board.py", 15)],
        zones=[ZoneSpec("GND", "B.Cu", None, 16), ZoneSpec("VBUS", "F.Cu", [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)], 17)],
        net_classes=[NetClassSpec("power", ["VBUS"], 0.5, 0.2, 0.6, 0.3, 18)],
        expects=[Expect("path", [PinRef("R1", "1")], [PinRef("C1", "1")], ["F1"], 19)],
        source_file="board.py",
    )


def test_json_round_trip_is_exact(sample_circuit):
    text = sample_circuit.to_json()
    assert Circuit.from_json(text) == sample_circuit and Circuit.from_json(text).to_json() == text


def test_json_keeps_declaration_order(sample_circuit):
    assert [p.ref for p in Circuit.from_json(sample_circuit.to_json()).parts] == [p.ref for p in sample_circuit.parts]


def test_other_schema_is_refused():
    with pytest.raises(CircuitSchemaError, match="pino.circuit/2"):
        Circuit.from_json('{"schema": "pino.circuit/2"}')


def test_net_of(sample_circuit):
    assert sample_circuit.net_of("R1", "1").name == "VBUS" and sample_circuit.net_of("R1", "9") is None


def test_part_and_pinref(sample_circuit):
    assert sample_circuit.part("C1").value == "4.7µF" and str(PinRef("U1", "3")) == "U1.3"
    assert '"4.7µF"' in sample_circuit.to_json()


def test_floats_are_rounded_in_json():
    assert '"x": 1.000001' in placement_to_json({"R1": PartPose(1.0000006, 0, 0, False)})


def test_placement_round_trip():
    p = {"R1": PartPose(1.5, -2.25, 90.0, True), "C1": PartPose(0.0, 0.0, 0.0, False)}
    assert placement_from_json(placement_to_json(p)) == p


def test_finding_json_drops_empty_fields():
    f = Finding("fit", "outside_outline", "error", "R1 is outside the outline", At("board", 1.0, 2.0, "F.Cu"), refs=("R1",))
    assert f.to_json() == {"source": "fit", "code": "outside_outline", "severity": "error",
                           "message": "R1 is outside the outline", "at": {"space": "board", "x": 1.0, "y": 2.0, "layer": "F.Cu"}, "refs": ["R1"]}
    assert Finding.from_json(f.to_json()) == f


def _with_routes(c):
    import dataclasses

    from pino_kernel.circuit import FixedVia, KeptRoute, PairSpec, PinRef, RouteHint, RouteStep

    return dataclasses.replace(
        c, pairs=[PairSpec("USB_D", "USB_D+", "USB_D-", 0.2, None, 4)],
        kept_routes=[KeptRoute("VBUS", PinRef("J1", "1"), (1.5, -2.0), "F.Cu", 0.5,
                               [RouteStep("point", 1.0, 2.0, None), RouteStep("via", 3.0, 2.0, "B.Cu")], 7)],
        fixed_vias=[FixedVia("GND", 1.0, 2.0, None, 0.3, 8)],
        route_hints=[RouteHint("SDA", (-5.0, -5.0, 5.0, 5.0), ["B.Cu"], [(0.0, 0.0), (1.0, 1.0)], ["SCL"], 9)])


def test_old_circuit_json_still_loads(sample_circuit):
    data = json.loads(sample_circuit.to_json())
    for k in ("pairs", "kept_routes", "fixed_vias", "route_hints"):
        data.pop(k)
    c = Circuit.from_json(json.dumps(data))
    assert (c.pairs, c.kept_routes, c.fixed_vias, c.route_hints) == ([], [], [], [])


def test_round_trip_with_routes(sample_circuit):
    c = _with_routes(sample_circuit)
    text = c.to_json()
    assert Circuit.from_json(text) == c and Circuit.from_json(text).to_json() == text
