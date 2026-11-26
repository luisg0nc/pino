"""Checks on board.py's routing calls: a kept leg that no longer runs at 45 degrees, and pairs left undeclared."""

from __future__ import annotations

import math

from ..circuit import Circuit, pair_base
from ..findings import At, Finding
from ..pcb.footprint import Placed
from ..pcb.writer import fab_of, kept_geometry

ANGLE_TOLERANCE = 0.5  # degrees


def kept_findings(circuit: Circuit, placed: list[Placed]) -> list[Finding]:
    legs, _ = kept_geometry(circuit, placed, fab_of(circuit))
    out = []
    for g in legs:
        angle = math.degrees(math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0])) % 180.0
        off = min(angle % 45.0, 45.0 - angle % 45.0)
        if off <= ANGLE_TOLERANCE:
            continue
        line = f" (board.py line {g.line})" if g.line else ""
        out.append(Finding(
            "routing", "kept_route_bent", "warning",
            f"kept route {g.net}{line}: the leg from {g.start} runs at {round(angle):d} degrees; the pad may have "
            "moved. Route it again or update the points.",
            At("board", round(g.a[0], 6), round(g.a[1], 6), g.layer), nets=(g.net,)))
    return out


def pair_findings(circuit: Circuit) -> list[Finding]:
    names = {n.name for n in circuit.nets}
    declared = {n for p in circuit.pairs for n in (p.positive, p.negative)}
    out = []
    for name in sorted(names):
        for pos, neg in (("+", "-"), ("_P", "_N")):
            if not name.endswith(pos):
                continue
            other = name[: -len(pos)] + neg
            if other in names and pair_base(name, other) and not {name, other} & declared:
                out.append(Finding(
                    "routing", "pair_undeclared", "warning",
                    f"nets {name} and {other} look like a differential pair; declare it with "
                    f'b.diff_pair("{name}", "{other}") so the router couples them', nets=(name, other)))
    return out
