"""board.py's own assertions, checked on KiCad's exported netlist by pins only.

expect_path without `through`: every pin of a and b sits on one exported net. With `through`: a
breadth-first walk over exported nets, where one step crosses one listed part from the net of
one of its pins to the net of another; it must reach b's net through listed parts only. Net
names are used in messages, never to decide.
"""

from __future__ import annotations

from typing import Mapping

from ..circuit import Circuit, PinRef
from ..findings import At, Finding
from .netlist import Netlist

NO_NET = "(no net)"


def _where(netlist: Netlist) -> dict[tuple[str, str], str]:
    return {pin: name for name, pins in netlist.nets.items() for pin in pins}


def _nets(pins: list[PinRef], where) -> list[str]:
    return sorted({where.get((p.ref, p.number), NO_NET) for p in pins})


def _at(pins: list[PinRef], pads) -> At | None:
    for p in pins:
        xy = pads.get((p.ref, p.number))
        if xy is not None:
            return At("board", xy[0], xy[1])
    return None


def _ends(e) -> str:
    return f"{'/'.join(str(p) for p in e.a)} -> {'/'.join(str(p) for p in e.b)}"


def check_expects(circuit: Circuit, netlist: Netlist, pads: Mapping[tuple[str, str], tuple[float, float]]) -> list[Finding]:
    where = _where(netlist)
    members: dict[str, set[tuple[str, str]]] = {n: set(p) for n, p in netlist.nets.items()}
    out = []
    for e in circuit.expects:
        a_nets, b_nets = _nets(e.a, where), _nets(e.b, where)
        pins = tuple(str(p) for p in e.a + e.b)
        if e.kind == "apart":
            shared = sorted((set(a_nets) & set(b_nets)) - {NO_NET})
            if shared:
                out.append(Finding("expect", "expect_apart_joined", "error",
                                   f"expect_apart {_ends(e)} (line {e.line}): both are on net {shared[0]}",
                                   _at(e.a, pads), tuple(sorted({p.ref for p in e.a + e.b})), pins, tuple(shared)))
            continue
        ok = False
        if not e.through:
            ok = len(set(a_nets) | set(b_nets)) == 1 and NO_NET not in a_nets
        elif len(a_nets) == 1 and NO_NET not in a_nets:
            through = set(e.through)
            seen, todo = {a_nets[0]}, [a_nets[0]]
            target = set(b_nets) - {NO_NET}
            while todo and not ok:
                net = todo.pop(0)
                if net in target and len(target) == 1:
                    ok = True
                    break
                for ref, number in sorted(members.get(net, ())):
                    if ref not in through:
                        continue
                    for other_net, pins_on in sorted(members.items()):
                        if other_net not in seen and any(r == ref and n != number for r, n in pins_on):
                            seen.add(other_net)
                            todo.append(other_net)
            ok = ok or (len(target) == 1 and next(iter(target)) in seen)
        if not ok:
            a_desc = ", ".join(f"{p} is on {where.get((p.ref, p.number), NO_NET)}" for p in e.a[:2])
            b_desc = ", ".join(f"{p} is on {where.get((p.ref, p.number), NO_NET)}" for p in e.b[:2])
            via = f" through {', '.join(e.through)}" if e.through else ""
            out.append(Finding("expect", "expect_path_broken", "error",
                               f"expect_path {_ends(e)}{via} (line {e.line}) does not hold: {a_desc}; {b_desc}",
                               _at(e.a, pads), tuple(sorted({p.ref for p in e.a + e.b} | set(e.through))),
                               (str(e.a[0]), str(e.b[0])), tuple(n for n in a_nets + b_nets if n != NO_NET)))
    return out
