"""Courtyard overlaps on one side of the board (a through-hole part counts on both)."""

from __future__ import annotations

from itertools import combinations

from ..findings import At, Finding
from ..geometry import bbox, polygons_overlap
from ..pcb.footprint import Placed, courtyard_world


def courtyard_overlaps(placed: list[Placed]) -> list[Finding]:
    yards = [(p, courtyard_world(p)) for p in placed]
    out = []
    for (a, ca), (b, cb) in combinations(yards, 2):
        for side, layer in (("F", "F.CrtYd"), ("B", "B.CrtYd")):
            hit = None
            for pa in ca.get(side, []):
                for pb in cb.get(side, []):
                    if polygons_overlap(pa, pb):
                        hit = (bbox(pa), bbox(pb))
                        break
                if hit:
                    break
            if hit:
                (ax0, ay0, ax1, ay1), (bx0, by0, bx1, by1) = hit
                x = (max(ax0, bx0) + min(ax1, bx1)) / 2
                y = (max(ay0, by0) + min(ay1, by1)) / 2
                refs = tuple(sorted((a.ref, b.ref)))
                out.append(Finding("courtyard", "courtyard_overlap", "error",
                                   f"courtyards of {refs[0]} and {refs[1]} overlap on the {'front' if side == 'F' else 'back'}",
                                   At("board", round(x, 4) + 0.0, round(y, 4) + 0.0, layer), refs))
    return out
