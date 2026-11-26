# Ported from pcb-kit (https://github.com/somebox/pcb-kit, commit 32867ca). MIT License, Copyright (c) 2026 Jeremy Seitz. See NOTICE.
"""Score a placement by its ratsnest, before routing anything.

The score adds up crossings between different nets' ratsnest edges (each net's minimum spanning
tree over its pads), counted only where the two could meet on one layer: an edge between
front-only pads never meets one between back-only pads; through-hole pads, and edges that change
sides, meet everything. Plus the ratsnest length in mm. Plane nets stay out: their pads only need
a via. pino keeps pcb-kit's weights.

The geometry functions (WEIGHTS, mst, edge, net_edges, length, _segx, _bbox, crosses, EdgeIndex,
count_among, _meet_point) are pcb-kit's; PadPoint, ratsnest, Score and score are pino's, without
pcbnew, the study loader or the SVG drawing.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Collection, Mapping, NamedTuple, Sequence

WEIGHTS = dict(cross=10.0, length=0.2)

# ---------------------------------------------------------------- ratsnest geometry (pcb-kit)


def mst(pts):
    """Prim's minimum spanning tree over points [(x, y, ...)]: [(i, j)]."""
    if len(pts) < 2:
        return []
    d = {i: math.hypot(pts[0][0] - pts[i][0], pts[0][1] - pts[i][1]) for i in range(1, len(pts))}
    par, out = {i: 0 for i in d}, []
    while d:
        i = min(d, key=d.get)
        out.append((par[i], i))
        del d[i]
        for j in d:
            dj = math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1])
            if dj < d[j]:
                d[j], par[j] = dj, i
    return out


def edge(net, a, c):
    """Ratsnest edge between pads a, c (x, y, side, ref, num): (net, (x, y), (x, y), side). Side F or B when both
    pads are on that side only, X otherwise (it can change sides through a via, or a pad is through-hole)."""
    return (net, (a[0], a[1]), (c[0], c[1]), a[2] if a[2] == c[2] and a[2] != "X" else "X")


def net_edges(net, pads):
    return [edge(net, pads[i], pads[j]) for i, j in mst(pads)]


def length(edges):
    return sum(math.hypot(e[1][0] - e[2][0], e[1][1] - e[2][1]) for e in edges)


def _segx(p1, p2, p3, p4):
    o = lambda a, b, c: (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    return o(p1, p2, p3) * o(p1, p2, p4) < 0 and o(p3, p4, p1) * o(p3, p4, p2) < 0


def _bbox(e):
    return min(e[1][0], e[2][0]), min(e[1][1], e[2][1]), max(e[1][0], e[2][0]), max(e[1][1], e[2][1])


def crosses(e, f, any_side=False):
    """Different nets, sides that can meet on one layer, and the segments intersect."""
    if e[0] == f[0] or (not any_side and {e[3], f[3]} == {"F", "B"}):
        return False
    a, b = _bbox(e), _bbox(f)
    if a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1]:
        return False
    return _segx(e[1], e[2], f[1], f[2])


class EdgeIndex:
    """Edges bucketed on a coarse grid, for counting crossings against a fixed set quickly."""
    CELL = 4.0

    def __init__(self, edges, any_side=False):
        self.edges, self.any_side, self.buckets = list(edges), any_side, defaultdict(list)
        for k, e in enumerate(self.edges):
            for key in self._keys(e):
                self.buckets[key].append(k)

    def _keys(self, e):
        x0, y0, x1, y1 = _bbox(e)
        C = self.CELL
        return [(i, j) for i in range(int(x0 // C), int(x1 // C) + 1) for j in range(int(y0 // C), int(y1 // C) + 1)]

    def count(self, edges, points=None):
        """Crossings of `edges` with the indexed ones (points: a list to collect where they cross)."""
        n = 0
        for e in edges:
            seen = set()
            for key in self._keys(e):
                for k in self.buckets.get(key, ()):
                    if k not in seen:
                        seen.add(k)
                        if crosses(e, self.edges[k], self.any_side):
                            n += 1
                            if points is not None:
                                points.append(_meet_point(e, self.edges[k]))
        return n

    def count_within(self, points=None):
        """Crossings among the indexed edges themselves, each pair once."""
        n = 0
        for k, e in enumerate(self.edges):
            seen = set()
            for key in self._keys(e):
                for m in self.buckets.get(key, ()):
                    if m > k and m not in seen:
                        seen.add(m)
                        if crosses(e, self.edges[m], self.any_side):
                            n += 1
                            if points is not None:
                                points.append(_meet_point(e, self.edges[m]))
        return n


def count_among(edges, any_side=False, points=None):
    n = 0
    for i, e in enumerate(edges):
        for f in edges[i + 1:]:
            if crosses(e, f, any_side):
                n += 1
                if points is not None:
                    points.append(_meet_point(e, f))
    return n


def _meet_point(e, f):
    (x1, y1), (x2, y2), (x3, y3), (x4, y4) = e[1], e[2], f[1], f[2]
    d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d if d else 0.5
    return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))


# ---------------------------------------------------------------- pino's entry points


class PadPoint(NamedTuple):
    """A pad for the ratsnest, board mm. side: F, B, or X for through-hole."""
    x: float
    y: float
    side: str
    ref: str
    number: str


Edge = tuple  # (net, (x, y), (x, y), side), as pcb-kit


def ratsnest(nets: Mapping[str, Sequence[PadPoint]], planes: Collection[str] = ()) -> list[Edge]:
    """Every signal net's minimum spanning tree, nets in sorted name order so ties come out the same every run."""
    out: list[Edge] = []
    for name in sorted(nets):
        if name in planes:
            continue
        pads = sorted(nets[name], key=lambda p: (p.ref, p.number, p.x, p.y))
        out += net_edges(name, pads)
    return out


@dataclass(frozen=True)
class Score:
    crossings: int
    length: float
    total: float
    points: list = field(default_factory=list, compare=False)


def score(nets: Mapping[str, Sequence[PadPoint]], planes: Collection[str] = (), weights=WEIGHTS,
          any_side: bool = False) -> Score:
    edges = ratsnest(nets, planes)
    points: list = []
    crossings = EdgeIndex(edges, any_side).count_within(points)
    total_len = length(edges)
    return Score(crossings, total_len, weights["cross"] * crossings + weights["length"] * total_len, points)
