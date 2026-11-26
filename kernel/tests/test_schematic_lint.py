import pytest

import schematic_cases
from helpers import small_board, small_board_py
from pino_kernel.libraries import discover
from pino_kernel.schematic.layout import layout_sheet
from pino_kernel.schematic.lint import lint
from pino_kernel.symbols import SymbolLibrary


def syms():
    return SymbolLibrary(discover().symbols)


def board_from(text):
    scope = {"__name__": "__main__"}
    exec(compile(text, "board.py", "exec"), scope)
    return scope["b"]


def caps_reversed_board():
    """Caps on U2's VDD, IO1, IO2 and IO3 nets, declared in reverse order of the pins.

    The chain itself takes the VDD and IO1 caps; IO2's and IO3's stand apart and must follow the pins.
    """
    return board_from('''from pino import Board
b = Board("caps", outline=(30, 20))
mcu = b.block("mcu", "Controller")
u2 = mcu.path("U2", "pino_test:IC6")
c4 = mcu.shunt("C4", "pino_test:C", "1p")
c3 = mcu.shunt("C3", "pino_test:C", "1n")
c2 = mcu.shunt("C2", "pino_test:C", "10n")
c1 = mcu.shunt("C1", "pino_test:C", "100n")
b.supply("+3V3", u2.VDD, c1[1], u2.EN, external=True)
b.net("A", u2.IO1, c2[1])
b.net("B", u2.IO2, c3[1])
b.net("C", u2.IO3, c4[1])
b.gnd(u2.GND, c1[2], c2[2], c3[2], c4[2])
''')


def board_with_paths(n):
    """U2 then n - 1 resistors in series from IO1, plus two caps: the spike flipped its arrangement at three."""
    lines = ['from pino import Board', 'b = Board("paths", outline=(30, 20))', 'mcu = b.block("mcu", "Controller")',
             'u2 = mcu.path("U2", "pino_test:IC6")']
    for i in range(1, n):
        lines.append(f'r{i} = mcu.path("R{i}", "pino_test:R", "1k")')
    lines += ['c1 = mcu.shunt("C1", "pino_test:C", "100n")', 'c2 = mcu.shunt("C2", "pino_test:C", "1u")',
              'b.supply("+3V3", u2.VDD, u2.EN, c1[1], external=True)', 'b.net("SIG0", u2.IO1, r1[1])']
    for i in range(1, n - 1):
        lines.append(f'b.net("SIG{i}", r{i}[2], r{i + 1}[1])')
    lines += [f'b.net("OUT", r{n - 1}[2], c2[1])', 'b.gnd(u2.GND, c1[2], c2[2], external=True)', 'b.nc_rest(u2)']
    return board_from("\n".join(lines) + "\n")


def three_block_board():
    return small_board()


def test_clean_board_has_no_findings(fixture_libs):
    c = small_board().to_circuit(); cv, _ = layout_sheet(c, syms())
    assert [f.message for f in lint(cv, c, syms())] == []


def test_findings_carry_sheet_positions(fixture_libs):
    c = small_board().to_circuit(); cv, _ = layout_sheet(c, syms())
    r1 = next(s for s in cv.syms if s.ref == "R1"); d1 = next(s for s in cv.syms if s.ref == "D1")
    d1.body = r1.body                                   # draw D1 on top of R1
    found = [f for f in lint(cv, c, syms()) if f.code == "overlap"]
    assert found and found[0].at.space == "sheet" and found[0].at.x > 0 and found[0].severity == "warning"
    assert {"R1", "D1"} <= set(found[0].refs)


def test_frames_are_sized_per_block(fixture_libs):
    cv, _ = layout_sheet(three_block_board().to_circuit(), syms())
    heights = {f.key: f.box[3] - f.box[1] for f in cv.frames}
    tops = {f.box[1] for f in cv.frames}
    assert heights["reg"] < heights["mcu"] and len(tops) == 1


def _joined(cv, net, a, b):
    """Points a and b are joined by wires of net (wire ends only; the layout splits wires at joins)."""
    seen, todo = {a}, [a]
    while todo:
        p = todo.pop()
        for w in cv.wires:
            if w.net == net and p in (w.a, w.b):
                q = w.b if p == w.a else w.a
                if q not in seen:
                    seen.add(q); todo.append(q)
    return b in seen


def order_of_clusters(cv, hub="U2"):
    """The hub pins the free-standing caps serve, in the order the caps stand (left to right)."""
    caps = sorted((s for s in cv.syms if s.part is not None and s.part.role == "shunt"), key=lambda s: (s.x, s.y))
    hub_pins = {p.net: (p.x, p.y) for p in cv.pins if p.ref == hub and p.net}
    out = []
    for s in caps:
        pin = next(p for p in cv.pins if p.ref == s.ref and p.net != "GND")
        if pin.net in hub_pins and not _joined(cv, pin.net, (pin.x, pin.y), hub_pins[pin.net]):
            out.append(hub_pins[pin.net])
    return out


def test_satellites_follow_their_ic_pins(fixture_libs):
    cv, _ = layout_sheet(caps_reversed_board().to_circuit(), syms())
    order = order_of_clusters(cv)
    assert len(order) >= 2 and order == sorted(order)


def arrangement(cv, key):
    return next(f.arrangement for f in cv.frames if f.key == key)


def test_one_more_path_part_keeps_the_arrangement(fixture_libs):
    before = arrangement(layout_sheet(board_with_paths(2).to_circuit(), syms())[0], "mcu")
    after = arrangement(layout_sheet(board_with_paths(3).to_circuit(), syms())[0], "mcu")
    assert before == after == "below"


@pytest.mark.kicad_libs
def test_mosfet_in_a_path_is_a_lint_finding(real_libs):
    c = schematic_cases.mosfet_in_path().to_circuit(); lib = SymbolLibrary(real_libs.symbols)
    assert any(f.code == "direction" for f in lint(layout_sheet(c, lib)[0], c, lib))


@pytest.mark.kicad_libs
def test_base_case_is_lint_clean(real_libs):
    c = schematic_cases.plain().to_circuit(); lib = SymbolLibrary(real_libs.symbols)
    assert [f.message for f in lint(layout_sheet(c, lib)[0], c, lib)] == []
