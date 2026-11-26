"""Compare KiCad's own netlist export with the intended circuit, by part and pin only.

Net names are never used to match: an intended net is its set of (ref, pin). Whether each
net exports under its board.py name is a separate, softer check (net_names).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from .. import ids
from ..circuit import Circuit
from ..findings import Finding


@dataclass
class Netlist:
    comps: dict
    nets: dict[str, frozenset[tuple[str, str]]]


def read_netlist(path: Path) -> Netlist:
    root = ET.parse(path).getroot()
    comps = {}
    for c in root.iter("comp"):
        comps[c.get("ref")] = {
            "value": c.findtext("value", ""),
            "footprint": c.findtext("footprint", ""),
            "fields": {f.get("name"): f.text or "" for f in c.iter("field")},
            "tstamps": (c.findtext("tstamps") or "").split(),
            "properties": {p.get("name"): p.get("value") for p in c.findall("property")},
        }
    nets_node = root.find("nets")
    nets = {
        n.get("name"): frozenset((x.get("ref"), x.get("pin")) for x in n.findall("node"))
        for n in (nets_node if nets_node is not None else [])
    }
    return Netlist(comps, nets)


def _fmt(pins) -> str:
    return " ".join(sorted(f"{r}.{p}" for r, p in pins)) or "-"


def _err(message: str, refs=(), pins=(), nets=()) -> Finding:
    return Finding("netlist", "netlist_mismatch", "error", message, None, tuple(refs), tuple(pins), tuple(nets))


def compare(circuit: Circuit, netlist: Netlist) -> list[Finding]:
    comps, exported = netlist.comps, netlist.nets
    parts = {p.ref: p for p in circuit.parts}
    out: list[Finding] = []

    for ref in sorted(set(parts) ^ set(comps)):
        where = "board.py" if ref in parts else "KiCad's netlist"
        out.append(_err(f"part {ref} is only in {where}", refs=[ref]))
    for ref in sorted(set(parts) & set(comps)):
        part, comp = parts[ref], comps[ref]
        for what, want, got in (
            ("value", part.value, comp["value"]),
            ("footprint", part.footprint, comp["footprint"]),
            ("LCSC", part.lcsc, comp["fields"].get("LCSC", "")),
            ("symbol uuid", [ids.symbol_uuid(part.key)], comp["tstamps"]),
            ("dnp", part.dnp, "dnp" in comp["properties"]),
        ):
            if want != got:
                out.append(_err(f"{ref} {what}: board.py has {want!r}, KiCad's netlist has {got!r}", refs=[ref]))

    where: dict = {}
    for name, pins in exported.items():
        for pin in pins:
            if pin in where:
                out.append(_err(f"{pin[0]}.{pin[1]} is on two exported nets", pins=[f"{pin[0]}.{pin[1]}"]))
            where[pin] = name
    every = {(p.ref, q.number) for p in circuit.parts for q in p.pins}
    for pin in sorted(set(where) - every):
        out.append(_err(f"KiCad's netlist has a pin board.py does not: {pin[0]}.{pin[1]}"))

    matched = set()
    for net in circuit.nets:
        want = frozenset((p.ref, p.number) for p in net.pins)
        touched = sorted({where[p] for p in want if p in where})
        if len(touched) == 1 and exported[touched[0]] == want:
            matched.add(touched[0])
            continue
        matched.update(touched)
        got = " | ".join(f"[{_fmt(exported[t])}]" for t in touched)
        out.append(_err(f"net {net.name}: board.py joins [{_fmt(want)}], KiCad's netlist has {got or 'nothing'}",
                        refs=sorted({r for r, _ in want}), nets=[net.name]))
    for pin in sorted((p.ref, p.number) for p in circuit.no_connects):
        name = where.get(pin)
        if name is None:
            continue
        if len(exported[name]) != 1:
            out.append(_err(f"no-connect {_fmt([pin])} is wired to [{_fmt(exported[name])}]", refs=[pin[0]]))
        matched.add(name)
    for name in sorted(set(exported) - matched):
        out.append(_err(f"KiCad's netlist has a net board.py does not: [{_fmt(exported[name])}]"))
    return out


def net_names(circuit: Circuit, netlist: Netlist) -> list[Finding]:
    """Each board.py net should export under its own name (a warning when it does not)."""
    where = {pin: name for name, pins in netlist.nets.items() for pin in pins}
    out = []
    for net in circuit.nets:
        names = sorted({where[(p.ref, p.number)] for p in net.pins if (p.ref, p.number) in where})
        if len(names) == 1 and names[0] != net.name:
            out.append(Finding("netlist", "net_name", "warning", f"net {net.name} exports as {names[0]}",
                               nets=(net.name,)))
    return out
