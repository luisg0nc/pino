import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import schematic_cases
from helpers import FIXTURES, small_board
from pino_kernel import ids
from pino_kernel.checks.netlist import compare, net_names, read_netlist
from pino_kernel.schematic import writer
from pino_kernel.schematic.canvas import Canvas
from pino_kernel.schematic.writer import DrawingError, symbol_boxes, write_schematic
from pino_kernel.sexpr import find, find_all, parse
from pino_kernel.symbols import SymbolLibrary

TESTS = Path(__file__).resolve().parent


def syms():
    from pino_kernel.libraries import discover
    return SymbolLibrary(discover().symbols)


def write(board):
    return write_schematic(board.to_circuit(), syms())


def write_project(circuit, out: Path, symbols=None) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    f = write_schematic(circuit, symbols or syms())
    (out / "board.kicad_sch").write_text(f.kicad_sch, encoding="utf-8")
    (out / "sym-lib-table").write_text(f.sym_lib_table, encoding="utf-8")
    (out / "fp-lib-table").write_text(f.fp_lib_table, encoding="utf-8")
    (out / "board.kicad_pro").write_text(json.dumps({"meta": {"filename": "board.kicad_pro", "version": 3}}) + "\n")
    return out


def run_writer_in_subprocess(seed: str, tmp_path: Path) -> str:
    code = ("import hashlib, sys; sys.path.insert(0, sys.argv[1]);"
            "from helpers import small_board; from pino_kernel.symbols import SymbolLibrary;"
            "from pino_kernel.libraries import discover; from pino_kernel.schematic.writer import write_schematic;"
            "f = write_schematic(small_board().to_circuit(), SymbolLibrary(discover().symbols));"
            "print(hashlib.sha256((f.kicad_sch + f.sym_lib_table + f.fp_lib_table).encode()).hexdigest())")
    env = {**os.environ, "PYTHONHASHSEED": seed}
    out = subprocess.run([sys.executable, "-c", code, str(TESTS)], env=env, capture_output=True, text=True, cwd=tmp_path)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()


def test_same_bytes_in_two_processes(fixture_libs, tmp_path):
    digests = {seed: run_writer_in_subprocess(seed, tmp_path) for seed in ("1", "98765")}
    assert digests["1"] == digests["98765"]


def test_symbol_uuid_follows_key(fixture_libs):
    sch = parse(write(small_board(led_id="status")).kicad_sch)
    uuids = {find(s, "property")[2]: find(s, "uuid")[1] for s in find_all(sch, "symbol")}
    assert uuids["R1"] == ids.symbol_uuid("R1") and uuids["D1"] == ids.symbol_uuid("status")


def test_no_uuid_twice(fixture_libs):
    text = write(small_board()).kicad_sch
    found = [n[1] for n in _walk(parse(text)) if n and n[0] == "uuid"]
    assert len(found) == len(set(found))


def _walk(node):
    yield node
    for c in node:
        if isinstance(c, list):
            yield from _walk(c)


def test_every_named_signal_net_has_a_global_label(fixture_libs):
    files = write(small_board())
    labelled = {lab.net for lab in files.canvas.labels if lab.is_global}
    assert {n.name for n in small_board().to_circuit().nets if n.kind == "signal"} <= labelled


def test_canvas_pins_carry_the_model_nets(fixture_libs):
    c = small_board().to_circuit()
    cv = write_schematic(c, syms()).canvas
    part_refs = {p.ref for p in c.parts}
    for p in cv.pins:
        if p.ref in part_refs:
            net = c.net_of(p.ref, p.number)
            assert p.net == (net.name if net else None)


def test_a_short_is_refused():
    cv = Canvas()
    cv.wire("A", (0, 0), (2, 0)); cv.wire("B", (2, 0), (4, 0))
    with pytest.raises(DrawingError, match=r"nets \['A', 'B'\] meet at"):
        writer.connect(cv)


def test_unicode_value_is_written_as_utf8(fixture_libs):
    text = write(small_board(cap_value="4.7µF")).kicad_sch
    assert '"4.7µF"' in text


def test_lib_tables_use_path_variables(fixture_libs):
    f = write(small_board())
    assert '"${KICAD10_SYMBOL_DIR}/pino_test.kicad_sym"' in f.sym_lib_table
    assert '"${KICAD10_FOOTPRINT_DIR}/pino_test.pretty"' in f.fp_lib_table


def test_symbol_boxes_for_the_views(fixture_libs):
    boxes = symbol_boxes(write(small_board()).canvas)
    assert [b["ref"] for b in boxes] == sorted(["J1", "C1", "U1", "C2", "U2", "C3", "R1", "D1"])
    u2 = next(b for b in boxes if b["ref"] == "U2")
    assert u2["x0"] < u2["x1"] and len(u2["pins"]) == 6


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
@pytest.mark.parametrize("case", schematic_cases.ALL, ids=lambda c: c.__name__)
def test_kicad_netlist_matches_intent(case, kicad, tmp_path, real_libs):
    c = case().to_circuit(); out = write_project(c, tmp_path / "sch")
    run = kicad.netlist(out / "board.kicad_sch", out / "netlist.xml")
    assert run.ok, run.output
    n = read_netlist(out / "netlist.xml")
    assert [f.message for f in compare(c, n)] == [] and [f.message for f in net_names(c, n)] == []


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_base_case_erc_is_clean(kicad, tmp_path, real_libs):
    out = write_project(schematic_cases.plain().to_circuit(), tmp_path / "sch")
    assert kicad.erc(out / "board.kicad_sch", out / "erc.json").ok
    violations = [v for s in json.loads((out / "erc.json").read_text())["sheets"] for v in s["violations"]]
    assert [(v["type"], v["description"]) for v in violations] == []


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_probe_pin_positions(kicad, tmp_path, real_libs):
    """KiCad's placement rules, measured: all 12 rotation and mirror poses of an asymmetric part."""
    import re

    from pino_kernel.schematic.canvas import Label, Pt, Sym, Text
    from pino_kernel.schematic.layout import MBlock, MPart, Model
    from pino_kernel.symbols import GRID, pin_at

    lib = syms()
    sym = lib.load("Regulator_Linear:AP2112K-3.3")
    model = Model(schematic_cases.plain().to_circuit(), lib)
    cv = Canvas()
    expected, fields = {}, {}
    poses = [(rot, mirror) for rot in (0, 90, 180, 270) for mirror in (None, "x", "y")]
    for i, (rot, mirror) in enumerate(poses):
        ref = f"U{i + 1}"
        tag = f"JUSTIFYLEFT{i:02d}"
        part = MPart(ref, f"probe-{ref}", sym, tag, "path", MBlock("b", "b"), "Package_TO_SOT_SMD:SOT-23-5", "", False)
        origin = (20 + 40 * (i % 4), 20 + 40 * (i // 4))
        where = Text(tag, origin[0], origin[1] - 14, "left")
        fields[tag] = (where.x * GRID, rot, mirror)
        cv.syms.append(Sym(ref, sym.lib_id, *origin, rot, mirror, ref, (0, 0, 0, 0),
                           Text(ref, origin[0], origin[1] + 14), where, part))
        for p in sym.pins:
            if p.etype == "no_connect":
                continue
            x, y = pin_at(p, origin, rot, mirror)
            net = f"N_{ref}_{p.number}"
            expected[(ref, p.number)] = net
            cv.pins.append(Pt(net, x, y, ref, p.number))
            cv.labels.append(Label(net, x, y, "R", False, f"{ref}.{p.number}"))
    out = tmp_path / "probe"; out.mkdir()
    (out / "board.kicad_sch").write_text(writer.schematic(model, lib, cv, "A3"))
    assert kicad.netlist(out / "board.kicad_sch", out / "netlist.xml").ok
    nets = read_netlist(out / "netlist.xml").nets
    got = {pin: name.lstrip("/") for name, pins in nets.items() for pin in pins}
    assert [(pin, want, got.get(pin)) for pin, want in expected.items() if got.get(pin) != want] == []
    assert len(expected) == 48
    assert kicad.sch_svg(out / "board.kicad_sch", out / "svg").ok
    svg = next((out / "svg").glob("*.svg")).read_text()
    drawn_left = 0
    for m in re.finditer(r'<text x="([\d.]+)" y="[\d.]+"\s+textLength="([\d.]+)"[^>]*>(JUSTIFYLEFT\d\d)<', svg):
        centre, tag = float(m[1]), m[3]
        if centre > fields[tag][0] + 1:
            drawn_left += 1
    assert drawn_left == len(poses)


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_kicad_resave_keeps_uuids(kicad, tmp_path, real_libs):
    c = schematic_cases.plain().to_circuit()
    out = write_project(c, tmp_path / "sch")
    before = parse((out / "board.kicad_sch").read_text())
    run = kicad.sch_upgrade(out / "board.kicad_sch")
    assert run.ok, run.output
    after = parse((out / "board.kicad_sch").read_text())

    def symbol_ids(root):
        return {find(s, "uuid")[1]: sorted(find(p, "uuid")[1] for p in find_all(s, "pin")) for s in find_all(root, "symbol")}
    assert symbol_ids(after) == symbol_ids(before)
    assert kicad.netlist(out / "board.kicad_sch", out / "netlist.xml").ok
    assert compare(c, read_netlist(out / "netlist.xml")) == []
