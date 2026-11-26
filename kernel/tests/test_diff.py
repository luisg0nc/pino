from pino_kernel.diff import changes, circuit, layout
from pino_kernel.sexpr import Sym as S
from pino_kernel.sexpr import dump, num


def fp(ref, value, x, y, rot=0, back=False, nets=None, lib="Resistor_SMD:R_0603_1608Metric"):
    nets = nets or {}
    pads = [[S("pad"), n, S("smd"), S("roundrect"), [S("at"), num(px), num(0)], [S("size"), num(0.8), num(0.95)],
             [S("layers"), "B.Cu" if back else "F.Cu"], *([[S("net"), nets[n]]] if n in nets else [])]
            for n, px in (("1", -0.8), ("2", 0.8))]
    at = [S("at"), num(x), num(y)] + ([num(rot)] if rot else [])
    return [S("footprint"), lib, [S("layer"), "B.Cu" if back else "F.Cu"], at,
            [S("property"), "Reference", ref], [S("property"), "Value", value], [S("attr"), S("smd")], *pads]


def board_text(r3="10k", r1=(100, 100), r2_rot=0, r3_back=False, vin=None, extra=(), rename=None):
    vin = vin or {"U2": "1"}
    name = rename or "VIN"
    parts = [fp("R1", "1k", *r1, nets={"1": name, "2": "GND"}),
             fp("R2", "1k", 104, 100, r2_rot, nets={"1": name, "2": "OUT"}),
             fp("R3", r3, 108, 100, back=r3_back, nets={"1": "OUT", "2": "GND"}),
             fp("U2", "LDO", 112, 100, nets={**{p: name for p in vin.values()}}, lib="Package_TO_SOT_SMD:SOT-23-5")]
    parts += list(extra)
    return dump([S("kicad_pcb"), [S("version"), S("20260206")], *parts]) + "\n"


base = board_text()
with_r5 = board_text(extra=[fp("R5", "100k", 120, 100, nets={"1": "OUT"})])
vin_plus_u2_5 = board_text(vin={"a": "1", "b": "2"})
renamed_vin = board_text(rename="VIN_RENAMED")
moved_r1_turned_r2_flipped_r3 = board_text(r1=(101, 100), r2_rot=90, r3_back=True)


def test_value_change():
    assert "R3 value 10k -> 4.7k" in changes(board_text(r3="10k"), board_text(r3="4.7k"))["circuit"]


def test_added_part():
    assert any(line.startswith("adds R5") for line in changes(base, with_r5)["circuit"])


def test_net_gains_a_pin():
    assert "net VIN gains U2.2" in changes(base, vin_plus_u2_5)["circuit"]


def test_renamed_net_is_no_change():
    assert changes(base, renamed_vin)["circuit"] == []


def test_moved_turned_flipped():
    lines = changes(base, moved_r1_turned_r2_flipped_r3)["layout"]
    assert {"moves 1 part: R1", "turns R2 0 -> 90", "puts R3 on the back"} <= set(lines)


def test_first_build():
    assert changes(None, base) == {"circuit": ["first build"], "layout": []}


def test_same_board_no_changes():
    assert changes(base, base) == {"circuit": [], "layout": []}
    assert circuit(base)["nets"]["GND"] == [["R1", "2"], ["R3", "2"]] and layout(base)["parts"]["R2"][2] == 0
