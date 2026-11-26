import os
import subprocess
import sys
from pathlib import Path

import pytest

from helpers import board_with_usb_nets, board_with_usb_pair, small_board
from pino import via
from pino_kernel import ids
from pino_kernel.circuit import KeptRoute, PinRef, RouteStep
from pino_kernel.coords import to_kicad
from pino_kernel.pcb.footprint import FootprintLibrary, pad_world
from pino_kernel.pcb.writer import placed_parts, write_board
from pino_kernel.checks.kept import kept_findings, pair_findings
from pino_kernel.sexpr import find, parse
from semdiff import changed_items
from test_board_writer import REAL_POSES, drc_types, grid_placement, real_circuit, refill_copy, write_real

TESTS = Path(__file__).resolve().parent


def top_level(text, kind):
    return [n for n in parse(text)[1:] if isinstance(n, list) and n and n[0] == kind]


def legs(text, net="VBUS"):
    """The kept route's segments in route order (the file holds them in KiCad's save order)."""
    by_uuid = {str(find(s, "uuid")[1]): s for s in top_level(text, "segment")}
    out = []
    for k in range(len(by_uuid)):
        u = ids.uid("kept", net, "0", "seg", str(k))
        if u in by_uuid:
            out.append(by_uuid[u])
    return out


def start_of(seg):
    s = find(seg, "start")
    return (float(s[1]), float(s[2]))


def placement_for(circuit, j1_at):
    pl = grid_placement(circuit)
    pl["J1"].x, pl["J1"].y = j1_at
    return pl


def board_with_kept_route(*, j1_at=(0.0, -10.0), points=None, power_class=None):
    """keep_route VBUS from J1.1 to U1.VIN: down to B.Cu and back up (two vias), unless `points` are given."""
    b = small_board()
    if power_class:
        b.net_class("power", ["VBUS"], width=power_class)
    pts = points if points is not None else [via(1.0, -6.0, to="B.Cu"), via(4.0, -3.0, to="F.Cu")]
    b.keep_route("VBUS", frm=b.part("J1")[1], to=b.part("U1")["VIN"], layer="F.Cu", points=pts)
    return b, j1_at


def write(made, libs=None):
    from pino_kernel.libraries import discover

    b, j1_at = made
    c = b.to_circuit()
    return write_board(c, placement_for(c, j1_at), FootprintLibrary(libs or discover()))


def pad_centre_kicad(files, ref, number):
    p = next(p for p in files.placed if p.ref == ref)
    q = next(q for q in pad_world(p) if q.number == number)
    return to_kicad(q.x, q.y)


def circuit_and_placed(made):
    from pino_kernel.libraries import discover

    b, j1_at = made
    c = b.to_circuit()
    return c, placed_parts(c, placement_for(c, j1_at), FootprintLibrary(discover()))


def test_kept_route_becomes_locked_segments_and_vias(fixture_libs):
    files = write(board_with_kept_route())
    segs, vias = legs(files.kicad_pcb), top_level(files.kicad_pcb, "via")
    assert len(top_level(files.kicad_pcb, "segment")) == 3 and len(vias) == 2 and all(find(n, "locked") for n in segs + vias)
    assert [find(s, "layer")[1] for s in segs] == ["F.Cu", "B.Cu", "F.Cu"]
    assert start_of(segs[0]) == pytest.approx(pad_centre_kicad(files, "J1", "1"))
    end = find(segs[-1], "end")
    assert (float(end[1]), float(end[2])) == pytest.approx(pad_centre_kicad(files, "U1", "1"))
    assert all(find(n, "net")[1] == "VBUS" for n in segs + vias)
    assert [str(x) for x in find(vias[0], "layers")[1:]] == ["F.Cu", "B.Cu"]


def test_kept_route_follows_the_pad(fixture_libs):
    a, b = write(board_with_kept_route(j1_at=(0, -10))), write(board_with_kept_route(j1_at=(2, -10)))
    dx = start_of(legs(b.kicad_pcb)[0])[0] - start_of(legs(a.kicad_pcb)[0])[0]
    assert dx == pytest.approx(2.0)


def test_width_and_via_from_the_net_class(fixture_libs):
    files = write(board_with_kept_route(power_class=0.5))
    assert {find(s, "width")[1] for s in top_level(files.kicad_pcb, "segment")} == {"0.5"}
    assert {(find(v, "size")[1], find(v, "drill")[1]) for v in top_level(files.kicad_pcb, "via")} == {("0.6", "0.3")}


def test_default_width_without_a_class(fixture_libs):
    files = write(board_with_kept_route())
    assert {find(s, "width")[1] for s in top_level(files.kicad_pcb, "segment")} == {"0.25"}


def test_fixed_via_is_written_locked(fixture_libs):
    b = small_board()
    b.fixed_via("GND", at=(2, 3), drill=0.4, diameter=0.8)
    files = write((b, (0.0, -10.0)))
    (v,) = top_level(files.kicad_pcb, "via")
    assert find(v, "locked") and (find(v, "size")[1], find(v, "drill")[1]) == ("0.8", "0.4")
    assert (float(find(v, "at")[1]), float(find(v, "at")[2])) == pytest.approx(to_kicad(2, 3))


def test_kept_uuids_are_stable_across_hash_seeds(fixture_libs, tmp_path):
    code = ("import hashlib, sys; sys.path.insert(0, sys.argv[1]); import test_kept_copper as t;"
            "f = t.write(t.board_with_kept_route());"
            "print(hashlib.sha256(''.join(map(str, t.top_level(f.kicad_pcb, 'segment') + t.top_level(f.kicad_pcb, 'via'))).encode()).hexdigest())")
    digests = set()
    for seed in ("1", "98765"):
        out = subprocess.run([sys.executable, "-c", code, str(TESTS)], env={**os.environ, "PYTHONHASHSEED": seed},
                             capture_output=True, text=True, cwd=tmp_path)
        assert out.returncode == 0, out.stderr
        digests.add(out.stdout.strip())
    assert len(digests) == 1


def test_no_kept_copper_no_tracks(fixture_libs):
    files = write((small_board(), (0.0, -10.0)))
    assert top_level(files.kicad_pcb, "segment") == [] and top_level(files.kicad_pcb, "via") == []


def test_bent_leg_is_a_warning(fixture_libs):
    c, placed = circuit_and_placed(board_with_kept_route(points=[(3.7, -8.1)]))
    f = kept_findings(c, placed)
    assert f[0].code == "kept_route_bent" and f[0].severity == "warning" and f[0].source == "routing"
    assert "board.py line" in f[0].message and "from J1.1" in f[0].message and f[0].at.space == "board"
    assert f[0].nets == ("VBUS",)


def test_straight_legs_are_fine(fixture_libs):
    c, placed = circuit_and_placed(board_with_kept_route())
    pads = {(p.ref, q.number): (q.x, q.y) for p in placed for q in pad_world(p)}
    (x0, y0), (x1, y1) = pads[("J1", "1")], pads[("U1", "1")]
    c.kept_routes = [KeptRoute("VBUS", PinRef("J1", "1"), PinRef("U1", "1"), "F.Cu", None,
                               [RouteStep("point", x0, y1, None)], 5)]
    assert kept_findings(c, placed) == []


def test_undeclared_pair_is_suggested(fixture_libs):
    f = pair_findings(board_with_usb_nets().to_circuit())
    assert [x.code for x in f] == ["pair_undeclared"] and f[0].severity == "warning"
    assert 'b.diff_pair("USB_D+", "USB_D-")' in f[0].message
    assert pair_findings(board_with_usb_pair().to_circuit()) == []


def kept_real_circuit(layers):
    """The real-library board with a kept route on LED: R2.2 up to a via, across B.Cu, a via, down to D1.2."""
    from pino_kernel.circuit import PartPose
    from pino_kernel.libraries import discover

    c = real_circuit(layers)
    env = {k: v for k, v in os.environ.items() if not k.startswith("PINO_KICAD_")}
    placed = placed_parts(c, {r: PartPose(*p) for r, p in REAL_POSES.items()}, FootprintLibrary(discover(env)))
    pads = {(p.ref, q.number): (q.x, q.y) for p in placed for q in pad_world(p)}
    (ax, ay), (bx, by) = pads[("R2", "2")], pads[("D1", "2")]
    c.kept_routes = [KeptRoute("LED", PinRef("R2", "2"), PinRef("D1", "2"), "F.Cu", None,
                               [RouteStep("via", ax, ay + 2.0, "B.Cu"), RouteStep("via", bx, ay + 2.0, "F.Cu")], 3)]
    return c


@pytest.mark.kicad_cli
@pytest.mark.kicad_libs
def test_kept_copper_survives_kicad_resave(kicad, tmp_path):
    out = write_real(tmp_path, kept_real_circuit(2), REAL_POSES)
    filled = refill_copy(kicad, out)
    assert {k for k, _ in changed_items(out.read_text(), filled.read_text())} == {"zone"}
    assert not {"track_dangling", "via_dangling"} & drc_types(kicad, filled)


def test_build_reports_the_routing_findings(make_project, fixture_libs):
    from helpers import usb_nets_board_py
    from pino_kernel.build import BuildOptions, build

    r = build(make_project(usb_nets_board_py() + 'b.keep_route("STATUS", frm=u2.IO1, to=r1[1], layer="F.Cu", points=[(3.7, -8.1)])\n'),
              BuildOptions(kicad=False))
    codes = {f.code for f in r.findings}
    assert {"pair_undeclared", "kept_route_bent"} <= codes, codes
