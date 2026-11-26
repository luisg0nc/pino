"""board.py lines the finishing tools hand back: route hints, placements and kept routes. Numbers through `num()`,
board mm, y up. pino never writes these into board.py itself: Claude does."""

from __future__ import annotations

import json
import re
from collections import defaultdict

from ..circuit import PartPose
from ..geometry import distance_to_edges, point_in_polygon
from ..pcb.copper import Copper
from ..sexpr import num

_BOARD = re.compile(r"^\s*([A-Za-z_]\w*)\s*=\s*(?:pino\.)?Board\(", re.M)


def board_var(board_py: str) -> str:
    m = _BOARD.search(board_py)
    return m.group(1) if m else "b"


def _n(v: float) -> str:
    return str(num(float(v)))


def _q(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def _pt(p) -> str:
    return f"({_n(p[0])}, {_n(p[1])})"


def pin_expr(var: str, ref: str, number: str) -> str:
    return f"{var}.part({_q(ref)})[{number if number.isdigit() else _q(number)}]"


def hint_snippet(var: str, net: str, region=None, layers=None, corridor=None, rip=()) -> str:
    args = [_q(net)]
    if region is not None:
        args.append("region=(" + ", ".join(_n(v) for v in region) + ")")
    if layers:
        args.append("layers=[" + ", ".join(_q(x) for x in layers) + "]")
    if corridor:
        args.append("corridor=[" + ", ".join(_pt(p) for p in corridor) + "]")
    if rip:
        args.append("rip=[" + ", ".join(_q(x) for x in rip) + "]")
    return f"{var}.route_hint({', '.join(args)})"


def place_snippet(var: str, ref: str, pose: PartPose) -> str:
    back = ", back=True" if pose.back else ""
    return f"{var}.place({var}.part({_q(ref)}), at=({_n(pose.x)}, {_n(pose.y)}), rot={_n(pose.rot)}{back})"


def _key(p) -> tuple[float, float]:
    return (round(p[0], 4) + 0.0, round(p[1], 4) + 0.0)


def keep_snippets(var: str, copper: Copper, net: str) -> list[str]:
    """The net's unlocked copper as keep_route lines: one per path between pads and branch points, split where the
    width changes, with via(x, y, to=layer) where the path changes layer. Raises ValueError on arcs."""
    if any(a.net == net and not a.locked for a in copper.arcs):
        raise ValueError(f"the copper of {net} has arcs; keep_route writes straight legs only")
    tracks = [t for t in copper.tracks if t.net == net and not t.locked and _key(t.a) != _key(t.b)]
    pads = sorted((p for p in copper.pads if p.net == net), key=lambda p: (p.ref, p.number))
    edges_at: dict[tuple, list[int]] = defaultdict(list)
    for i, t in enumerate(tracks):
        edges_at[_key(t.a)].append(i)
        edges_at[_key(t.b)].append(i)

    def pin_at(node):
        for p in pads:
            if point_in_polygon(node, p.polygon) or distance_to_edges(node, p.polygon) <= 0.001:
                return p
        return None

    def stop(node) -> bool:
        e = edges_at[node]
        if len(e) != 2 or pin_at(node) is not None:
            return True
        return abs(tracks[e[0]].width - tracks[e[1]].width) > 1e-6

    def end(node) -> str:
        p = pin_at(node)
        return pin_expr(var, p.ref, p.number) if p else _pt(node)

    used: set[int] = set()
    lines = []
    def order(n):
        p = pin_at(n)
        return (0, p.ref, p.number, n) if p else (1, "", "", n)

    for node in sorted(edges_at, key=order):
        if not stop(node):
            continue
        for first in sorted(edges_at[node]):
            if first in used:
                continue
            path, legs, cur, e = [node], [], node, first
            while True:
                used.add(e)
                legs.append(tracks[e])
                t = tracks[e]
                nxt = _key(t.b) if _key(t.a) == cur else _key(t.a)
                path.append(nxt)
                if stop(nxt):
                    break
                e = next(x for x in edges_at[nxt] if x != e)
                if e in used:
                    break
                cur = nxt
            points = []
            for k in range(1, len(path) - 1):
                if legs[k - 1].layer != legs[k].layer:
                    points.append(f"via({_n(path[k][0])}, {_n(path[k][1])}, to={_q(legs[k].layer)})")
                else:
                    points.append(_pt(path[k]))
            pts = f", points=[{', '.join(points)}]" if points else ""
            lines.append(f"{var}.keep_route({_q(net)}, frm={end(path[0])}, to={end(path[-1])}, layer={_q(legs[0].layer)}, "
                         f"width={_n(legs[0].width)}{pts})")
    return lines
