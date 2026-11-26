# Ported from pcb-kit (https://github.com/somebox/pcb-kit, commit 32867ca). MIT License, Copyright (c) 2026 Jeremy Seitz. See NOTICE.
"""The board outline: outline.json (pcb-kit's enclosure.json shape) or a plain rectangle.

outline.json is measured from the box: origin at the centre of the mounting pattern, x along
the long axis, y up, millimetres. pino uses that frame for every position it shows.

    {"board": {"width": 56, "height": 44, "corner_radius": 2,
               "notches": [{"corner": "+x+y", "width": 8, "height": 6}],
               "cutouts": [{"x": 22.6, "y": 19.1, "boss": 7.5, "clearance": 1.0, "fillet": 1.0}]},
     "mounts":   [{"x": -24.5, "y": 18.5, "hole": 3.2, "boss": 5.0, "name": "H1", "head": 5.5}],
     "keepouts": [{"x": 0, "y": 10, "d": 4, "what": "lid screw boss"}],
     "height_limit": {"top": 12, "bottom": 3}}

`outline_points`, `boss_notch` and `_mirror_items` are pcb-kit's, unchanged in logic, except
that a cut-out that does not fit raises OutlineError instead of SystemExit.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from .circuit import Hole, Keepout, OutlineSpec
from .geometry import arc_points, circle_polygon

ALL_FORBID = ["tracks", "vias", "pads", "copperpour", "footprints"]
ALL_COPPER = ["*.Cu"]


class OutlineError(ValueError):
    pass


def _mirror_items(items, sx, sy):
    """Mirror outline items of the +x+y corner into another corner, keeping the counter-clockwise walk."""
    m = lambda p: (sx * p[0], sy * p[1])
    out = [tuple([it[0]] + [m(p) for p in it[1:]]) for it in items]
    if sx * sy < 0:  # one mirror flips the orientation: walk the pieces backwards
        out = [(it[0], it[2], it[1]) if it[0] == "line" else ("arc", it[3], it[2], it[1]) for it in reversed(out)]
    return out


def boss_notch(hw, hh, xc, yc, R, f):
    """Corner cut around a boss at (xc, yc) (first quadrant): straight in from the long edge along y = yc - R,
    an arc of radius R around the boss, straight out to the short edge along x = xc - R, with convex fillets of
    radius f where the cut meets the edges. Counter-clockwise walk, arriving up the long edge x = hw."""
    pt = lambda cx, cy, r, a: (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
    items = []
    c1 = (hw - f, yc - R - f)
    items.append(("arc", pt(*c1, f, 0), pt(*c1, f, 45), pt(*c1, f, 90)))
    items.append(("line", pt(*c1, f, 90), (xc, yc - R)))
    items.append(("arc", (xc, yc - R), pt(xc, yc, R, 225), (xc - R, yc)))
    c2 = (xc - R - f, hh - f)
    items.append(("line", (xc - R, yc), pt(*c2, f, 0)))
    items.append(("arc", pt(*c2, f, 0), pt(*c2, f, 45), pt(*c2, f, 90)))
    return items


def outline_points(w, h, r, notches=None, cutouts=None):
    """Rounded rectangle with optional corner notches (rectangular) or boss cut-outs, walked counter-clockwise
    (y up). Returns ('line', a, b) and ('arc', start, mid, end) in enclosure mm."""
    hw, hh = w / 2, h / 2
    cut = {n["corner"]: (n["width"], n["height"]) for n in notches or []}
    boss = {}
    for c in cutouts or []:
        sx, sy = (1 if c["x"] > 0 else -1), (1 if c["y"] > 0 else -1)
        R = c.get("r") or c["boss"] / 2 + c.get("clearance", 1.0)
        boss[f"{'+' if sx > 0 else '-'}x{'+' if sy > 0 else '-'}y"] = (abs(c["x"]), abs(c["y"]), R, c.get("fillet", 1.0), sx, sy)
    corners = [
        ("+x+y", (hw - r, hh - r), 0, lambda nw, nh: [(hw, hh - nh), (hw - nw, hh - nh), (hw - nw, hh)]),
        ("-x+y", (-hw + r, hh - r), 90, lambda nw, nh: [(-hw + nw, hh), (-hw + nw, hh - nh), (-hw, hh - nh)]),
        ("-x-y", (-hw + r, -hh + r), 180, lambda nw, nh: [(-hw, -hh + nh), (-hw + nw, -hh + nh), (-hw + nw, -hh)]),
        ("+x-y", (hw - r, -hh + r), 270, lambda nw, nh: [(hw - nw, -hh), (hw - nw, -hh + nh), (hw, -hh + nh)]),
    ]
    pieces = []
    for name, (cx, cy), a0, notch in corners:
        if name in boss:
            xc, yc, R, f, sx, sy = boss[name]
            if xc - R - f <= 0 or yc - R - f <= 0 or xc - R >= hw or yc - R >= hh:
                raise OutlineError(f"boss cut-out at {name} does not fit the board: boss {xc},{yc}, cut radius {R}, fillet {f}")
            items = _mirror_items(boss_notch(hw, hh, xc, yc, R, f), sx, sy)
            entry = items[0][1]
            exit_ = items[-1][2] if items[-1][0] == "line" else items[-1][3]
            pieces.append((entry, items, exit_))
        elif name in cut:
            pts = notch(*cut[name])
            pieces.append((pts[0], [("line", pts[0], pts[1]), ("line", pts[1], pts[2])], pts[2]))
        else:
            pt = lambda a: (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
            pieces.append((pt(a0), [("arc", pt(a0), pt(a0 + 45), pt(a0 + 90))], pt(a0 + 90)))
    out = []
    for i, (entry, items, exit_) in enumerate(pieces):
        out += items
        nxt_entry = pieces[(i + 1) % 4][0]
        if any(abs(a - b) > 1e-6 for a, b in zip(nxt_entry, exit_)):
            out.append(("line", exit_, nxt_entry))
    return out


def _round(seg):
    return tuple([seg[0]] + [(round(p[0], 6) + 0.0, round(p[1], 6) + 0.0) for p in seg[1:]])


def _read(path: Path) -> dict:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise OutlineError(f"outline file {Path(path).name} not found next to board.py") from None
    except json.JSONDecodeError as e:
        raise OutlineError(f"outline file {Path(path).name} is not valid JSON: {e.msg} at line {e.lineno}") from None
    if not isinstance(data, dict) or not isinstance(data.get("board"), dict):
        raise OutlineError(f"outline file {Path(path).name} has no \"board\" object with width and height")
    return data


def load_outline(path: Path) -> OutlineSpec:
    data = _read(path)
    bd = data["board"]
    try:
        w, h = float(bd["width"]), float(bd["height"])
    except (KeyError, TypeError, ValueError):
        raise OutlineError(f"outline file {Path(path).name}: board needs a width and a height in mm") from None
    segments = [_round(s) for s in outline_points(w, h, float(bd.get("corner_radius", 2)), bd.get("notches"),
                                                   bd.get("cutouts"))]
    holes = []
    for i, m in enumerate(data.get("mounts") or []):
        hole = float(m["hole"])
        courtyard = max(float(m.get("boss") or 0), float(m.get("head") or 0)) or hole + 2
        holes.append(Hole(str(m.get("name") or f"H{i + 1}"), float(m["x"]), float(m["y"]), hole, courtyard))
    limit = data.get("height_limit")
    return OutlineSpec(bd["width"], bd["height"], segments, holes,
                       {k: float(v) for k, v in limit.items()} if isinstance(limit, dict) else None, "outline.json")


def rectangle(width: float, height: float, corner: float = 1.0) -> OutlineSpec:
    segments = [_round(s) for s in outline_points(float(width), float(height), corner)]
    return OutlineSpec(float(width), float(height), segments, [], None, "board.py")


def polygon(spec: OutlineSpec, chord: float = 0.1) -> list[tuple[float, float]]:
    """The outline as one closed polygon (no repeated last point), arcs cut into chords."""
    pts: list[tuple[float, float]] = []
    for seg in spec.segments:
        if seg[0] == "line":
            pts.append(tuple(seg[1]))
        else:
            pts.extend(arc_points(tuple(seg[1]), tuple(seg[2]), tuple(seg[3]), chord)[:-1])
    out = []
    for p in pts:
        if not out or math.dist(out[-1], p) > 1e-9:
            out.append(p)
    if len(out) > 1 and math.dist(out[0], out[-1]) < 1e-9:
        out.pop()
    return out


def outline_keepouts(path: Path) -> list[Keepout]:
    data = _read(path)
    out = []
    for k in data.get("keepouts") or []:
        r = float(k["d"]) / 2 + 0.5  # grown by 0.5 mm, as pcb-kit
        poly = [(round(x, 6) + 0.0, round(y, 6) + 0.0) for x, y in circle_polygon(float(k["x"]), float(k["y"]), r)]
        out.append(Keepout(poly, list(ALL_COPPER), list(ALL_FORBID), str(k.get("what", "")), "outline.json"))
    return out
