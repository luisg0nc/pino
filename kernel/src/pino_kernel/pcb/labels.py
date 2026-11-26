"""Where each part's reference label goes on the silkscreen, after placement.

A footprint's Reference text sits where its library drew it, which on a packed board is on a neighbour's pads or
label. This step moves each label to the first clear spot beside its part: above, below, left, right (centred, then
flush with either end of that side), then the same four turned 90 degrees. A spot is clear when the text keeps off
every pad (by the fab's silk to pad distance), every part's body (so no label hides under a part once it is
assembled), every other label and footprint silk line, and the board edge. A part's body is its Fab outline, or for a
footprint that draws none, the outline round its pads and silk. The courtyard's margin outside the body does not
block: a label there can still be read. Tracks and zones do not count: silk over copper is fine for the fab.
When no spot fits, the text gets smaller, never below the fab's minimum height and line width; when still nothing
fits, the label is hidden and one info finding names those parts.

`board.py`'s `label()` sets one part's label by hand and wins: a side, an offset and a turn, or hidden. Hand labels
are placed first, so the automatic ones keep clear of them. Labels on the bottom go on B.SilkS by the same rules
(the writer mirrors them). Everything here is in board mm (y up) and runs in declaration order, so the same board.py
gives the same labels.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ..circuit import Circuit, LabelSpec
from ..fab import FabProfile
from ..findings import At, Finding
from ..geometry import (Point, Polygon, arc_points, bbox, circle_polygon, point_in_polygon, polygons_overlap,
                        segment_polygon_distance)
from ..outline import polygon as outline_polygon
from ..sexpr import find, find_all
from .footprint import Placed, _world, flip_layer, pad_world

# KiCad's stroke font at 1 mm: each glyph's ink width, and the space between two glyphs (measured from kicad-cli 10's
# SVG plot). Wider glyphs than these are taken as W.
GLYPH = {**dict.fromkeys("EFL", 0.476), **dict.fromkeys("BDHKNPRSTU0156890", 0.571),
         **dict.fromkeys("CG234", 0.619), **dict.fromkeys("AMOVXYZ7", 0.667), "J": 0.381, "I": 0.0, "Q": 0.714,
         "_": 0.762, "W": 0.857, "-": 0.5, "+": 0.6, ".": 0.1}
GLYPH_GAP = 0.381
INK_HEIGHT = 1.1  # cap height plus Q's tail, per mm of size

BODY_GAP = 0.02  # beyond the gaps the part's own body, pads and silk keep
LABEL_GAP = 0.2  # between two labels
SILK_GAP = 0.1  # from a footprint's silk line
FAB_GAP = 0.05  # from a part's body, and a mounting hole's courtyard
SHRINK = 0.8  # each smaller try is this much of the last
TURNS = (0.0, 90.0)
SIDE_ORDER = ("top", "bottom", "left", "right")
CELL = 2.0  # mm, the obstacle index's grid


@dataclass(frozen=True)
class Label:
    """A placed Reference text: its centre and turn in board mm and degrees (counter-clockwise), its size."""
    x: float
    y: float
    angle: float
    size: float
    thickness: float
    hidden: bool = False


@dataclass(frozen=True)
class RefText:
    """A footprint's Reference field as its library draws it."""
    layer: str  # F.SilkS or B.SilkS, as placed
    size: float
    thickness: float
    hidden: bool


Box = tuple[float, float, float, float]


def text_size(text: str, size: float, thickness: float) -> tuple[float, float]:
    """The ink box (width, height) of upright text in KiCad's stroke font."""
    glyphs = sum(GLYPH.get(c.upper(), GLYPH["W"]) for c in text) + GLYPH_GAP * max(0, len(text) - 1)
    return size * glyphs + thickness, size * INK_HEIGHT + thickness


def ref_text(p: Placed) -> RefText | None:
    """The Reference field of the part's footprint, or None when the footprint has none on the silkscreen."""
    for prop in find_all(p.footprint.node, "property"):
        if len(prop) < 3 or prop[1] != "Reference":
            continue
        lay = find(prop, "layer")
        layer = str(lay[1]) if lay else ""
        if p.back:
            layer = flip_layer(layer)
        if layer not in ("F.SilkS", "B.SilkS"):
            return None
        font = find(find(prop, "effects") or [], "font") or []
        size = find(font, "size")
        thick = find(font, "thickness")
        hide = find(prop, "hide")
        return RefText(layer, float(size[1]) if size else 1.0, float(thick[1]) if thick else 0.15,
                       bool(hide) and str(hide[1]) == "yes")
    return None


def _grow(b: Box, d: float) -> Box:
    return (b[0] - d, b[1] - d, b[2] + d, b[3] + d)


def _rect(b: Box) -> Polygon:
    return [(b[0], b[1]), (b[2], b[1]), (b[2], b[3]), (b[0], b[3])]


def _meets(a: Box, b: Box) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def label_box(x: float, y: float, w: float, h: float, angle: float) -> Box:
    """The box of text w by h centred at (x, y) and turned by angle, as an axis-aligned box."""
    a = math.radians(angle)
    c, s = abs(math.cos(a)), abs(math.sin(a))
    hw, hh = (w * c + h * s) / 2, (w * s + h * c) / 2
    return (x - hw, y - hh, x + hw, y + hh)


class _Obstacles:
    """What a label on one silk layer must keep off, on a grid so a test only looks at what is near."""

    def __init__(self):
        self.items: list[tuple[Box, str, object, float]] = []  # (box with its gap, kind, shape, gap)
        self.grid: dict[tuple[int, int], list[int]] = {}

    def _add(self, box: Box, kind: str, shape, gap: float) -> None:
        grown = _grow(box, gap)
        i = len(self.items)
        self.items.append((grown, kind, shape, gap))
        for cell in self._cells(grown):
            self.grid.setdefault(cell, []).append(i)

    @staticmethod
    def _cells(b: Box):
        for i in range(math.floor(b[0] / CELL), math.floor(b[2] / CELL) + 1):
            for j in range(math.floor(b[1] / CELL), math.floor(b[3] / CELL) + 1):
                yield (i, j)

    def polygon(self, poly: Polygon, gap: float) -> None:
        if len(poly) >= 3:
            self._add(bbox(poly), "poly", poly, gap)

    def segment(self, a: Point, b: Point, half_width: float, gap: float) -> None:
        box = (min(a[0], b[0]) - half_width, min(a[1], b[1]) - half_width,
               max(a[0], b[0]) + half_width, max(a[1], b[1]) + half_width)
        self._add(box, "seg", (a, b, half_width), gap)

    def box(self, b: Box, gap: float) -> None:
        self._add(b, "box", b, gap)

    def hits(self, b: Box) -> bool:
        seen: set[int] = set()
        for cell in self._cells(b):
            for i in self.grid.get(cell, ()):
                if i in seen:
                    continue
                seen.add(i)
                grown, kind, shape, gap = self.items[i]
                if not _meets(grown, b):
                    continue
                if kind == "box":
                    return True
                if kind == "poly":
                    if polygons_overlap(_rect(_grow(b, gap)), shape):
                        return True
                else:
                    a, e, hw = shape
                    if segment_polygon_distance(a, e, _rect(b)) < hw + gap:
                        return True
        return False


def _drawings(p: Placed, layer: str):
    """The footprint's own drawings on `layer` as (points, closed, stroke width, filled polygon or None), board mm."""
    out = []
    for item in p.footprint.node:
        if not (isinstance(item, list) and item and item[0] in ("fp_line", "fp_rect", "fp_circle", "fp_arc", "fp_poly")):
            continue
        lay = find(item, "layer")
        if not lay or (flip_layer(str(lay[1])) if p.back else str(lay[1])) != layer:
            continue
        stroke = find(item, "stroke")
        width = find(stroke, "width") if stroke else None
        w = float(width[1]) if width else 0.12
        kind = item[0]
        pt = lambda key, item=item: tuple(map(float, find(item, key)[1:3]))
        if kind == "fp_line":
            pts, closed = [pt("start"), pt("end")], False
        elif kind == "fp_rect":
            (x0, y0), (x1, y1) = pt("start"), pt("end")
            pts, closed = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], True
        elif kind == "fp_circle":
            (cx, cy), (ex, ey) = pt("center"), pt("end")
            pts, closed = circle_polygon(cx, cy, math.hypot(ex - cx, ey - cy), 24), True
        elif kind == "fp_arc":
            pts, closed = arc_points(pt("start"), pt("mid"), pt("end"), chord=0.2), False
        else:
            pts, closed = [tuple(map(float, xy[1:3])) for xy in find_all(find(item, "pts"), "xy")], True
        world = [_world(p, x, y) for x, y in pts]
        fill = find(item, "fill")
        filled = closed and fill is not None and len(fill) > 1 and str(fill[1]) in ("yes", "solid")
        out.append((world, closed, w, world if filled else None))
    return out


def _on_side(layers, side: str) -> bool:
    return any(s in (f"{side}.Cu", f"{side}.Mask", "*.Cu", "*.Mask", "F&B.Cu") for s in layers)


def _hull(points) -> Polygon:
    """The convex hull of the points, counter-clockwise (Andrew's monotone chain)."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return []

    def half(seq):
        out: list[Point] = []
        for q in seq:
            while len(out) >= 2 and ((out[-1][0] - out[-2][0]) * (q[1] - out[-2][1])
                                     - (out[-1][1] - out[-2][1]) * (q[0] - out[-2][0])) <= 0:
                out.pop()
            out.append(q)
        return out[:-1]

    hull = half(pts) + half(reversed(pts))
    return hull if len(hull) >= 3 else []


def part_body(p: Placed, side: str) -> Polygon:
    """What of the part a label on side "F" or "B" must keep off, in board mm: the hull of its Fab drawings there, or,
    for a footprint that draws no Fab outline (or one with no area, such as a single line), the hull of its pads and
    silk on its own side. [] when nothing."""
    body = _hull([q for pts, *_ in _drawings(p, f"{side}.Fab") for q in pts])
    if not body and side == ("B" if p.back else "F"):
        pts = [q for pad in pad_world(p) if _on_side(pad.layers, side) for q in pad.poly]
        pts += [q for pts, *_ in _drawings(p, f"{side}.SilkS") for q in pts]
        body = _hull(pts)
    return body


def _body(p: Placed, side: str, pad_gap: float) -> Box:
    """The part's extent on a side, with the gap a label keeps from each: its body, its pads and its own silk
    drawings. Its courtyard's margin is left out."""
    body = part_body(p, side)
    boxes = [_grow(bbox(body), FAB_GAP)] if body else []
    boxes += [_grow(bbox(pad.poly), pad_gap) for pad in pad_world(p) if _on_side(pad.layers, side)]
    boxes += [_grow(bbox(pts), w / 2 + SILK_GAP) for pts, _, w, _ in _drawings(p, f"{side}.SilkS")]
    if not boxes:
        return (p.x, p.y, p.x, p.y)
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def spots(body: Box, w: float, h: float, angle: float, gap: float = BODY_GAP):
    """Where a label of w by h (upright) turned by `angle` may go beside `body`, in order: each side centred, then
    flush with each end. The spot keeps the whole box of the turned text clear of the body."""
    x0, y0, x1, y1 = body
    _, _, hx, hy = label_box(0, 0, w, h, angle)
    w, h = 2 * hx, 2 * hy
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    out = []
    for side in SIDE_ORDER:
        if side in ("top", "bottom"):
            y = y1 + gap + h / 2 if side == "top" else y0 - gap - h / 2
            xs = [cx, x0 + w / 2, x1 - w / 2]
            cand = [(x, y) for x in xs]
        else:
            x = x0 - gap - w / 2 if side == "left" else x1 + gap + w / 2
            ys = [cy, y1 - h / 2, y0 + h / 2]
            cand = [(x, y) for y in ys]
        for x, y in cand:
            spot = (side, round(x, 4) + 0.0, round(y, 4) + 0.0)
            if spot not in out:
                out.append(spot)
    return out


def _sizes(size: float, floor: float) -> list[float]:
    out = [max(size, floor)]
    while out[-1] * SHRINK > floor + 0.05:
        out.append(round(out[-1] * SHRINK, 3))
    if out[-1] > floor:
        out.append(floor)
    return out


def _hand(spec: LabelSpec, p: Placed, rt: RefText, fab: FabProfile) -> Label:
    size = max(rt.size, fab.silk_min_text_height)
    thick = max(rt.thickness, fab.silk_min_width)
    angle = spec.rot or 0.0
    if spec.hide:
        return Label(p.x, p.y, angle, size, thick, hidden=True)
    if spec.at is not None:
        return Label(round(p.x + spec.at[0], 4) + 0.0, round(p.y + spec.at[1], 4) + 0.0, angle, size, thick)
    w, h = text_size(p.ref, size, thick)
    side = spec.side or "top"
    _, x, y = next(s for s in spots(_body(p, rt.layer[0], fab.silk_to_pad), w, h, angle) if s[0] == side)
    return Label(x, y, angle, size, thick)


def _search(p: Placed, rt: RefText, turns, obstacles: _Obstacles, board: Polygon, fab: FabProfile) -> Label | None:
    """The first clear spot: by size (largest first), then turn, then side."""
    body = _body(p, rt.layer[0], fab.silk_to_pad)
    start = max(rt.size, fab.silk_min_text_height)
    base = max(rt.thickness, fab.silk_min_width)
    for size in _sizes(rt.size, fab.silk_min_text_height):
        thick = max(fab.silk_min_width, round(base * size / start, 3))
        w, h = text_size(p.ref, size, thick)
        for angle in turns:
            for _, x, y in spots(body, w, h, angle):
                box = label_box(x, y, w, h, angle)
                centre = ((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)
                if (not board or point_in_polygon(centre, board)) and not obstacles.hits(box):
                    return Label(x, y, angle, size, thick)
    return None


def _by_hand(spec: LabelSpec) -> bool:
    """A label board.py puts somewhere itself; rot= alone only turns the automatic search."""
    return spec.hide or spec.side is not None or spec.at is not None


def place_labels(circuit: Circuit, placed: list[Placed], fab: FabProfile) -> tuple[dict[str, Label], list[Finding]]:
    """Each part's label, by ref (a part whose footprint draws no Reference on the silkscreen has none), and the
    finding that names the parts whose labels were hidden for want of room."""
    texts = {p.ref: ref_text(p) for p in placed}
    hand = {s.ref: s for s in circuit.labels}
    obstacles = {"F.SilkS": _Obstacles(), "B.SilkS": _Obstacles()}
    board = outline_polygon(circuit.outline) if circuit.outline.segments else []
    for layer, obs in obstacles.items():
        side = layer[0]
        for p in placed:
            obs.polygon(part_body(p, side), FAB_GAP)
            for pad in pad_world(p):
                if _on_side(pad.layers, side):
                    obs.polygon(pad.poly, fab.silk_to_pad)
            for pts, closed, w, filled in _drawings(p, layer):
                n = len(pts)
                for i in range(n if closed else n - 1):
                    obs.segment(pts[i], pts[(i + 1) % n], w / 2, SILK_GAP)
                if filled:
                    obs.polygon(filled, SILK_GAP)
        for h in circuit.outline.holes:
            obs.polygon(circle_polygon(h.x, h.y, max(h.courtyard, h.drill) / 2, 24), FAB_GAP)
        for i in range(len(board)):
            obs.segment(board[i], board[(i + 1) % len(board)], 0.0, fab.copper_to_edge)

    def keep(label: Label, layer: str, w: float, h: float) -> None:
        if not label.hidden:
            obstacles[layer].box(label_box(label.x, label.y, w, h, label.angle), LABEL_GAP)

    out: dict[str, Label] = {}
    for p in placed:
        rt, spec = texts[p.ref], hand.get(p.ref)
        if rt is None or spec is None or not _by_hand(spec):
            continue
        label = _hand(spec, p, rt, fab)
        out[p.ref] = label
        keep(label, rt.layer, *text_size(p.ref, label.size, label.thickness))

    hidden: list[str] = []
    for p in placed:
        rt = texts[p.ref]
        if rt is None or p.ref in out:
            continue
        spec = hand.get(p.ref)
        if rt.hidden and spec is None:
            continue  # the footprint hides its own reference: leave it so
        turns = (spec.rot % 360,) if spec is not None and spec.rot is not None else TURNS
        found = _search(p, rt, turns, obstacles[rt.layer], board, fab)
        if found is None:
            size = max(rt.size, fab.silk_min_text_height)
            found = Label(p.x, p.y, 0.0, size, max(rt.thickness, fab.silk_min_width), hidden=True)
            hidden.append(p.ref)
        out[p.ref] = found
        keep(found, rt.layer, *text_size(p.ref, found.size, found.thickness))

    findings = []
    if hidden:
        names = ", ".join(hidden)
        what = f"the reference label of {names} is" if len(hidden) == 1 else f"the reference labels of {names} are"
        findings.append(Finding("placement", "label_hidden", "info",
                                f"No room on the silkscreen, so {what} hidden. Make room beside the part, or set the "
                                "label in board.py with b.label().", refs=tuple(hidden)))
    lines = {s.ref: s.line for s in circuit.labels}
    for p in placed:
        if p.ref in hand and texts[p.ref] is None:
            findings.append(Finding(
                "placement", "label_not_drawn", "warning",
                f"b.label() sets the label of {p.ref}, but its footprint {p.footprint.lib_id} draws no reference on "
                "the silkscreen, so there is nothing to place. Take the b.label() line out.",
                At("source", file=circuit.source_file, line=lines[p.ref]) if lines[p.ref] else None, refs=(p.ref,)))
    return out, findings
