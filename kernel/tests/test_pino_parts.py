import inspect

import pytest

from helpers import small_board, small_board_without_led_nets
from pino import Board, CircuitError
from pino_kernel.circuit import PinRef


def block():
    return Board("t", outline=(20, 20)).block("p", "P")


def test_pin_name_gives_every_pad(fixture_libs):
    j = block().path("J1", "pino_test:CONN_VBUS", footprint="pino_test:USB_Edge")
    assert len(j["VBUS"]) == 4 and j.VBUS == j["VBUS"] and j[5] == (PinRef("J1", "5"),)


def test_unknown_pin_names_the_line(fixture_libs):
    r = block().path("R1", "pino_test:R", footprint="pino_test:R_0603")
    line = inspect.currentframe().f_lineno + 2
    with pytest.raises(CircuitError) as e:
        r["X"]
    assert "R1: no pin 'X' in pino_test:R" in str(e.value)
    assert e.value.file.endswith("test_pino_parts.py") and e.value.line == line


def test_unknown_pin_attribute(fixture_libs):
    r = block().path("R1", "pino_test:R")
    with pytest.raises(CircuitError, match="no pin 'NOPE'"):
        r.NOPE


def test_duplicate_ref_and_id(fixture_libs):
    b = block()
    b.path("R1", "pino_test:R", id="a")
    with pytest.raises(CircuitError, match="ref R1 used twice"):
        b.path("R1", "pino_test:R")
    with pytest.raises(CircuitError, match="id 'a' used twice"):
        b.path("R2", "pino_test:R", id="a")


def test_ref_must_look_like_a_ref(fixture_libs):
    for bad in ("r1", "#PWR1", "U"):
        with pytest.raises(CircuitError, match=f"ref '{bad}'"):
            block().path(bad, "pino_test:R")


def test_net_names_kicad_can_carry(fixture_libs):
    for bad in ("A B", "A/B", "~A", "Net-(R1-1)", "{x}", ""):
        b = small_board()
        with pytest.raises(CircuitError, match="net name"):
            b.net(bad, b.part("U2").IO2, b.part("U2").IO3)


def test_validate_collects_every_problem(fixture_libs):
    b = small_board_without_led_nets()
    with pytest.raises(CircuitError) as e:
        b.validate()
    assert len(e.value.problems) == 2 and all(p.line for p in e.value.problems)
    assert all("D1." in p.message for p in e.value.problems)


def test_shunt_needs_one_ground_pin(fixture_libs):
    b = Board("t", outline=(20, 20)); p = b.block("p", "P")
    r1, c1 = p.path("R1", "pino_test:R"), p.shunt("C1", "pino_test:C")
    b.net("A", r1[1], c1[1]); b.net("B", r1[2], c1[2])
    with pytest.raises(CircuitError, match="C1: a shunt has exactly one pin on GND"):
        b.validate()


def test_one_pin_net_needs_external(fixture_libs):
    b = Board("t", outline=(20, 20)); r1 = b.block("p", "P").path("R1", "pino_test:R")
    b.net("VBUS_IN", r1[1]); b.nc(r1[2])
    with pytest.raises(CircuitError, match="net VBUS_IN has only 1 pin"):
        b.validate()


def test_stacked_pins_on_different_nets(fixture_libs):
    b = Board("t", outline=(20, 20)); p = b.block("p", "P")
    j1 = p.path("J1", "pino_test:CONN_VBUS", footprint="pino_test:USB_Edge")
    r1, r2 = p.path("R1", "pino_test:R"), p.path("R2", "pino_test:R")
    b.net("A", j1[1], j1[2], j1[3], r1[1]); b.net("B", j1[4], r2[1]); b.gnd(j1.GND, r1[2], r2[2])
    with pytest.raises(CircuitError, match="J1: stacked pins"):
        b.validate()


def test_pin_on_two_nets(fixture_libs):
    b = small_board()
    with pytest.raises(CircuitError, match=r"U2.4 is already on no-connect"):
        b.net("X", b.part("U2").IO2, b.part("R1")[1])


def test_supply_needs_a_power_symbol(fixture_libs):
    b = small_board()
    with pytest.raises(CircuitError, match="no power symbol power:VFOO; pass symbol="):
        b.supply("VFOO", b.part("U2").IO3)


def test_part_needs_a_footprint(fixture_libs):
    with pytest.raises(CircuitError, match="J1 has no footprint: pass footprint="):
        block().path("J1", "pino_test:CONN_VBUS")


def test_unknown_symbol_is_a_circuit_error(fixture_libs):
    with pytest.raises(CircuitError, match="pino_test:Nope"):
        block().path("R1", "pino_test:Nope")


def test_missing_outline(fixture_libs):
    b = Board("t"); r1 = b.block("p", "P").path("R1", "pino_test:R"); b.nc(r1[1], r1[2])
    with pytest.raises(CircuitError, match="Board needs an outline"):
        b.validate()


def test_nc_rest_is_recorded(fixture_libs):
    c = small_board().to_circuit()
    assert c.nc_rest == {"U2": ["5"]}


def test_id_keeps_the_key_across_a_rename(fixture_libs):
    assert small_board(led_ref="D9", led_id="status").to_circuit().part("D9").key == "status"


def test_to_circuit_carries_parts_and_nets(fixture_libs):
    c = small_board().to_circuit()
    assert [p.ref for p in c.parts] == ["J1", "C1", "U1", "C2", "U2", "C3", "R1", "D1"]
    assert c.part("C1").footprint == "pino_test:C_0603" and c.part("C1").role == "shunt" and c.part("C1").block == "usb"
    assert c.net_of("J1", "3").name == "VBUS" and c.net_of("J1", "3").external
    assert c.net_of("D1", "1").kind == "gnd" and c.part("R1").line == 14


def test_to_circuit_is_deterministic(fixture_libs):
    assert small_board().to_circuit().to_json() == small_board().to_circuit().to_json()


# --- parts by LCSC number -----------------------------------------------------------------------------------

BY_NUMBER = '''from pino import Board
b = Board("n", outline=(20, 20))
r1 = b.block("p").path("R1", lcsc="c900001")
b.nc(r1[1], r1[2])
'''


def cached(*numbers):
    """Their recorded jlcsearch answers, put into this test's parts cache (the child process reads it)."""
    from pino_kernel.parts.cache import PartsCache, parts_root
    from pino_kernel.parts.jlcsearch import Jlcsearch
    from pino_kernel.parts.transport import RecordedTransport
    from helpers import FIXTURES

    client = Jlcsearch(RecordedTransport(FIXTURES / "parts" / "jlcsearch"), PartsCache(parts_root()))
    for n in numbers:
        assert client.part(n) is not None


@pytest.mark.kicad_libs
def test_board_py_part_by_number_only(make_project, real_libs):
    from pino_kernel.run_board import run_board

    cached("C900001")
    run = run_board(make_project(BY_NUMBER), libraries=real_libs)
    assert run.problems == [] and run.missing_parts == []
    p = run.circuit.part("R1")
    assert (p.symbol, p.footprint, p.value, p.lcsc, p.source) == (
        "Device:R", "Resistor_SMD:R_0603_1608Metric", "10k", "C900001", "kicad-rule")


@pytest.mark.kicad_libs
def test_explicit_footprint_and_value_still_win(make_project, real_libs):
    from pino_kernel.run_board import run_board

    cached("C900001")
    board = BY_NUMBER.replace('lcsc="c900001"', 'value="9k9", lcsc="C900001", footprint="Resistor_SMD:R_0402_1005Metric"')
    p = run_board(make_project(board), libraries=real_libs).circuit.part("R1")
    assert (p.footprint, p.value) == ("Resistor_SMD:R_0402_1005Metric", "9k9")


def test_missing_part_is_a_problem_with_its_number(make_project, fixture_libs):
    from pino_kernel.run_board import run_board

    run = run_board(make_project(BY_NUMBER), libraries=fixture_libs)
    assert run.missing_parts == ["C900001"] and run.problems[0].code == "part_not_cached"
    assert run.problems[0].line == 3 and run.problems[0].data == {"lcsc": "C900001"}
    assert "R1: C900001 is not in pino's parts cache yet" in run.problems[0].message
    assert "symbol=" in run.problems[0].message


def test_a_part_with_no_mapping_asks_for_symbol_and_footprint(make_project, fixture_libs):
    from pino_kernel.run_board import run_board

    cached("C900002")
    run = run_board(make_project(BY_NUMBER.replace("c900001", "C900002")), libraries=fixture_libs)
    assert run.missing_parts == [] and [p.code for p in run.problems] == ["part_no_mapping"] and run.problems[0].line == 3
    assert run.problems[0].message.startswith("R1: pino has no KiCad part for C900002 (SOT-23-5)")
    assert "symbol='Library:Name' and footprint='Library:Name'" in run.problems[0].message


def test_hand_fit_and_why_reach_the_circuit(fixture_libs):
    b = small_board()
    r = b.block("x").path("R9", "pino_test:R", "1k", footprint="pino_test:R_0603", lcsc="25804", hand_fit=True,
                          why="only one in stock")
    b.nc(r[1], r[2])
    p = b.to_circuit().part("R9")
    assert (p.hand_fit, p.why, p.lcsc, p.source) == (True, "only one in stock", "C25804", "kicad")
    assert b.to_circuit().part("R1").hand_fit is False


def test_symbol_none_without_lcsc_is_refused_at_its_line(fixture_libs):
    b = block()
    line = inspect.currentframe().f_lineno + 2
    with pytest.raises(CircuitError, match="U1: pass symbol='Library:Name'") as e:
        b.path("U1")
    assert e.value.line == line


@pytest.mark.parametrize("kw,match", [
    ({"lcsc": "R0603"}, "not an LCSC number"),
    ({"why": "x" * 201}, "why= takes one line of at most 200 characters"),
    ({"why": "two\nlines"}, "why= takes one line"),
])
def test_bad_part_fields_are_refused(fixture_libs, kw, match):
    with pytest.raises(CircuitError, match=match):
        block().path("R1", "pino_test:R", "1k", footprint="pino_test:R_0603", **kw)


def test_child_reads_only_the_cache(make_project, fixture_libs, monkeypatch, tmp_path):
    """Even with recorded answers on offer, the child never looks a part up."""
    from pino_kernel.run_board import run_board
    from helpers import FIXTURES

    monkeypatch.setenv("PINO_PARTS_RECORDED", str(FIXTURES / "parts" / "jlcsearch"))
    run = run_board(make_project(BY_NUMBER), libraries=fixture_libs)
    assert run.missing_parts == ["C900001"]
    assert not (tmp_path / "pino-cache" / "parts").exists()
