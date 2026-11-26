"""The reference board (spec section 6) built end to end with kicad-cli and KiCad's own libraries."""

import hashlib
import json
import shutil
import subprocess
import sys

import pytest

from helpers import FIXTURES
from pino_kernel.build import build
from pino_kernel.checks.netlist import read_netlist
from pino_kernel.circuit import Circuit
from pino_kernel.sexpr import find, find_all, parse
from semdiff import changed_items

pytestmark = [pytest.mark.kicad_cli, pytest.mark.kicad_libs]


@pytest.fixture
def ref(tmp_path, real_libs):
    return shutil.copytree(FIXTURES / "reference", tmp_path / "reference")


def flatten(artifacts):
    for v in artifacts.values():
        if isinstance(v, dict):
            yield from v.values()
        else:
            yield v


def digests(folder, skip):
    return {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file() and p.name not in skip}


def ids_of(project, result, ref_name):
    d = project / ".pino/build" / result.hash
    sch = parse((d / "board.kicad_sch").read_text())
    sym = next(find(s, "uuid")[1] for s in find_all(sch, "symbol")
               if any(p[1] == "Reference" and p[2] == ref_name for p in find_all(s, "property")))
    pcb = parse((d / "board.kicad_pcb").read_text())
    fp = next(find(f, "uuid")[1] for f in find_all(pcb, "footprint")
              if any(p[1] == "Reference" and p[2] == ref_name for p in find_all(f, "property")))
    return sym, fp


def test_reference_builds_clean(ref):
    r = build(ref)
    assert r.verdict == "ok", [f.to_json() for f in r.findings if f.severity == "error"]
    assert r.counts["parts"] == 22 and r.counts["unrouted"] > 0
    for path in flatten(r.artifacts):
        assert (ref / path).is_file()
    assert {"F.Cu", "B.Cu", "Edge.Cuts"} <= set(r.artifacts["svg"]) and (ref / r.artifacts["glb"]).stat().st_size > 0
    assert [t.step for t in r.timings][:4] == ["libraries", "fetch parts", "run board.py", "hash"]
    assert sum(t.seconds for t in r.timings) < 60
    assert r.kicad_cli.startswith("10.")


def test_exported_names_and_parity(ref):
    r = build(ref); d = ref / ".pino/build" / r.hash
    names = set(read_netlist(d / "netlist.xml").nets)
    wanted = {n.name for n in Circuit.from_json((d / "circuit.json").read_text()).nets}
    assert wanted <= names and all(n.startswith("unconnected-(") for n in names - wanted)
    assert not [f for f in r.findings if f.code.startswith("parity_")]
    assert not [f for f in r.findings if f.source in ("netlist", "expect", "erc") and f.severity != "info"]


def test_same_bytes_in_a_second_copy(ref, tmp_path):
    a = build(ref); other = shutil.copytree(FIXTURES / "reference", tmp_path / "again"); b = build(other)
    assert a.hash == b.hash
    assert digests(ref / ".pino/build" / a.hash, skip={"result.json"}) == digests(other / ".pino/build" / b.hash, skip={"result.json"})


def test_refill_adds_only_fill(ref):
    d = ref / ".pino/build" / build(ref).hash
    assert {k for k, _ in changed_items((d / "board.kicad_pcb").read_text(), (d / "filled/board.kicad_pcb").read_text())} == {"zone"}


def test_ref_rename_with_id_keeps_the_link(ref):
    first = build(ref)
    (ref / "board.py").write_text((ref / "board.py").read_text().replace('"D2"', '"D12"'))
    second = build(ref)
    assert ids_of(ref, second, "D12") == ids_of(ref, first, "D2")          # symbol uuid and footprint uuid
    assert not [f for f in second.findings if f.code.startswith("parity_")]
    assert any("D2" in line or "D12" in line for line in second.changes["circuit"])


def test_serve_builds_the_reference(ref):
    lines = [{"id": 1, "op": "ping"}, {"id": 2, "op": "build", "project": str(ref)}, {"id": 3, "op": "shutdown"}]
    p = subprocess.run([sys.executable, "-m", "pino_kernel.cli", "serve"], input="\n".join(map(json.dumps, lines)) + "\n",
                       capture_output=True, text=True, timeout=300)
    out = [json.loads(line) for line in p.stdout.splitlines()]
    assert [o["id"] for o in out] == [1, 2, 3] and out[1]["result"]["verdict"] == "ok" and p.returncode == 0


def test_reference_labels_keep_off_pads_and_each_other(ref):
    r = build(ref)
    silk = [f.message for f in r.findings if f.source == "drc" and f.code in ("silk_overlap", "silk_over_copper")]
    assert silk == []
    # U1's own outline meets the board edge (it sits on it for its antenna); no label does
    assert not [f for f in r.findings if f.code == "silk_edge_clearance" and "Reference" in f.message]
    hidden = [f for f in r.findings if f.code == "label_hidden"]
    # a label may sit over a neighbour's courtyard margin, so R3 shows beside J1. C5 and C7 are boxed in by U1's body
    # and silk and their neighbours' pads; C3's last spot is taken by C1's label.
    assert len(hidden) == 1 and hidden[0].severity == "info" and hidden[0].refs == ("C3", "C5", "C7")
