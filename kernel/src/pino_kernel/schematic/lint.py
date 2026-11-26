"""Readability lint on the drawing model: overlaps, label collisions, crossings and direction rules.

Each finding carries a sheet position in mm and the parts involved. Text boxes are estimates,
so this finds collisions, not hairline touches.
"""

from __future__ import annotations

from itertools import combinations

from ..circuit import Circuit
from ..findings import At, Finding
from ..symbols import GRID, SymbolLibrary, pin_at, pin_outward
from .canvas import Canvas
from .layout import Model

SLACK = 0.15  # grid units two boxes may bite into each other before it counts


def overlap(a, b, slack=SLACK):
    return min(a[2], b[2]) - max(a[0], b[0]) > slack and min(a[3], b[3]) - max(a[1], b[1]) > slack


def _mm(v: float) -> float:
    return round(v * GRID, 3)


def _find(code: str, message: str, x: float, y: float, refs) -> Finding:
    return Finding("lint", code, "warning", message, At("sheet", _mm(x), _mm(y)), tuple(sorted(set(refs))))


def lint(cv: Canvas, circuit: Circuit, symbols: SymbolLibrary) -> list[Finding]:
    model = Model(circuit, symbols)
    refs = set(model.parts)
    found: list[Finding] = []

    def owner_refs(*keys):
        return [k for k in keys if k in refs]

    solids = []  # (kind, name, box, owner)
    for s in cv.syms:
        solids.append(("body", s.ref, tuple(s.body), s.key))
        for t in (s.ref_text, s.value_text):
            if not t.hidden:
                solids.append(("text", f"{s.ref}:{t.value}", t.box(), s.key))
    for lab in cv.labels:
        solids.append(("label", f"{lab.net}@{lab.key}", lab.box(), lab.key))
    for a, b in combinations(solids, 2):
        if a[3] == b[3] and a[0] != "label" and (a[3].startswith("#") and {a[0], b[0]} == {"body", "text"}):
            continue
        if overlap(a[2], b[2]):
            cx = (max(a[2][0], b[2][0]) + min(a[2][2], b[2][2])) / 2
            cy = (max(a[2][1], b[2][1]) + min(a[2][3], b[2][3])) / 2
            found.append(_find("overlap", f"{a[0]} {a[1]} overlaps {b[0]} {b[1]}", cx, cy, owner_refs(a[3], b[3])))

    leaving = {}  # (symbol key, pin point) -> the way out of the symbol
    for s in cv.syms:
        for p in symbols.load(s.lib_id).pins:
            leaving[(s.key, pin_at(p, (s.x, s.y), s.rot, s.mirror))] = pin_outward(p, s.rot, s.mirror)

    def leads_away(key, w):
        for start, end in ((w.a, w.b), (w.b, w.a)):
            way = leaving.get((key, start))
            if way and (end[0] - start[0]) * way[0] + (end[1] - start[1]) * way[1] > 0:
                return True
        return False

    for w in cv.wires:
        box = (min(w.a[0], w.b[0]), min(w.a[1], w.b[1]), max(w.a[0], w.b[0]), max(w.a[1], w.b[1]))
        for kind, name, other, owner in solids:
            if kind == "body" and leads_away(owner, w):
                continue  # one box per symbol is coarse: an LED's arrows widen it past its pin
            x0, y0, x1, y1 = other
            inner = (x0 + 0.3, y0 + 0.3, x1 - 0.3, y1 - 0.3)
            if box[2] > inner[0] and box[0] < inner[2] and box[3] > inner[1] and box[1] < inner[3]:
                cx = (max(box[0], inner[0]) + min(box[2], inner[2])) / 2
                cy = (max(box[1], inner[1]) + min(box[3], inner[3])) / 2
                found.append(_find("wire_through", f"a wire of {w.net} runs through {kind} {name}", cx, cy,
                                   owner_refs(owner)))

    flat = [w for w in cv.wires if w.a[1] == w.b[1]]
    upright = [w for w in cv.wires if w.a[0] == w.b[0]]
    for h in flat:
        for v in upright:
            lo, hi = sorted((h.a[0], h.b[0]))
            top, bottom = sorted((v.a[1], v.b[1]))
            if h.net != v.net and lo < v.a[0] < hi and top < h.a[1] < bottom:
                found.append(_find("crossing", f"wire of {h.net} crosses wire of {v.net}", v.a[0], h.a[1], []))

    # direction rules, read back from where the pins ended up
    for part in model.parts.values():
        item = next((s for s in cv.syms if s.part is not None and s.part.ref == part.ref), None)
        if item is None:
            continue
        ys = {}
        for p in part.symbol.pins:
            net = model.net_of(part.ref, p.number)
            ys[net.kind if net else "nc"] = pin_at(p, (item.x, item.y), item.rot, item.mirror)[1]
        if part.role == "shunt" and "gnd" in ys and any(ys["gnd"] <= y for k, y in ys.items() if k != "gnd"):
            found.append(_find("direction", f"shunt {part.ref} does not hang down to ground", item.x, item.y,
                               [part.ref]))
        if part.role == "tap" and "supply" in ys and any(ys["supply"] >= y for k, y in ys.items() if k != "supply"):
            found.append(_find("direction", f"tap {part.ref} does not have its supply on top", item.x, item.y,
                               [part.ref]))
    for s in cv.syms:
        if s.rot == 180 and s.part is None:
            found.append(_find("direction", f"{s.value_text.value} symbol is upside down", s.x, s.y, []))
    frames = sorted(cv.frames, key=lambda f: (f.box[1], f.box[0]))
    for a, b in zip(frames, frames[1:]):
        if a.box[1] == b.box[1] and a.box[2] > b.box[0]:
            found.append(_find("blocks_overlap", f"blocks {a.title!r} and {b.title!r} overlap",
                               (a.box[2] + b.box[0]) / 2, a.box[1], []))
    return sorted(found, key=lambda f: (f.code, f.at.y, f.at.x, f.message))
