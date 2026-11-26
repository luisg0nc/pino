"""Copper in a .kicad_pcb text: read it in board mm, merge a router's copper into pino's board, hash its UUIDs,
write copper.json, strip it, move a footprint, and tell which pieces of copper touch.

Positions are board mm in the outline frame (y up); only `coords` converts. The text is parsed and written with
`sexpr`, never with pcbnew.
"""

from __future__ import annotations

import copy
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from .. import ids
from ..coords import from_kicad
from ..geometry import (Point, Polygon, arc_points, bbox, circle_polygon, distance_to_edges, point_in_polygon,
                        point_segment_distance, polygon_distance, segment_distance, segment_polygon_distance)
from ..sexpr import Sym, dump, find, find_all, num, parse
from .footprint import rotate
from .writer import track_order

COPPER_KINDS = ("segment", "arc", "via")
TOUCH = 0.02  # mm: copper of one net that comes this close counts as joined (pcb-kit's TOUCH)
NM = 1e-6  # mm


@dataclass(frozen=True)
class Track:
    uuid: str
    net: str
    layer: str
    width: float
    a: Point
    b: Point
    locked: bool


@dataclass(frozen=True)
class Arc:
    uuid: str
    net: str
    layer: str
    width: float
    start: Point
    mid: Point
    end: Point
    locked: bool


@dataclass(frozen=True)
class Via:
    uuid: str
    net: str
    at: Point
    diameter: float
    drill: float
    layers: tuple[str, str]
    locked: bool


@dataclass(frozen=True)
class PadShape:
    ref: str
    number: str
    net: str | None
    layers: tuple[str, ...]
    polygon: Polygon
    size: tuple[float, float]
    drill: float | None
    through: bool
    centre: Point = (0.0, 0.0)


@dataclass(frozen=True)
class Fill:
    net: str
    layer: str
    zone: str
    polygon: Polygon


@dataclass
class Copper:
    tracks: list[Track]
    arcs: list[Arc]
    vias: list[Via]
    pads: list[PadShape]
    fills: list[Fill]
    layers: list[str]
    unfilled: list[Fill] = field(default_factory=list)  # zone outlines of a net with no fill on that layer


# --- reading -------------------------------------------------------------------------------------------------


def _locked(node) -> bool:
    if Sym("locked") in node[1:]:
        return True
    lk = find(node, "locked")
    return lk is not None and len(lk) > 1 and str(lk[1]) == "yes"


def _net(node) -> str:
    n = find(node, "net")
    if n is None or len(n) < 2:
        return ""
    return str(n[-1]) if not (len(n) == 2 and isinstance(n[1], Sym) and str(n[1]).isdigit()) else ""


def _xy(node) -> Point:
    X, Y = float(node[1]), float(node[2])
    x, y = from_kicad(X, Y)
    return (round(x, 6) + 0.0, round(y, 6) + 0.0)


def _uuid(node) -> str:
    u = find(node, "uuid") or find(node, "tstamp")
    return str(u[1]) if u else ""


def board_layers(root) -> list[str]:
    lay = find(root, "layers")
    out = []
    for item in (lay[1:] if lay else []):
        if isinstance(item, list) and len(item) >= 3 and str(item[1]).endswith(".Cu"):
            out.append(str(item[1]))
    order = {"F.Cu": -1, "B.Cu": 10_000}
    return sorted(out, key=lambda n: order.get(n, int(n[2:-3]) if n[2:-3].isdigit() else 5000))


def expand_layers(names: Iterable[str], copper_layers: Sequence[str]) -> tuple[str, ...]:
    """Copper layers among `names`, with "*.Cu" and "F&B.Cu" expanded."""
    out: list[str] = []
    for n in names:
        if n in ("*.Cu", "*In.Cu"):
            out += [c for c in copper_layers if n == "*.Cu" or c.startswith("In")]
        elif n == "F&B.Cu":
            out += [c for c in ("F.Cu", "B.Cu") if c in copper_layers]
        elif n in copper_layers:
            out.append(n)
    seen: list[str] = []
    for n in out:
        if n not in seen:
            seen.append(n)
    return tuple(seen)


def _pad_local(shape: str, w: float, h: float) -> list[Point]:
    if shape == "circle":
        return circle_polygon(0.0, 0.0, w / 2, 16)
    if shape == "oval" and abs(w - h) > 1e-9:
        r = min(w, h) / 2
        if w > h:
            c1, c2 = (-(w / 2 - r), 0.0), (w / 2 - r, 0.0)
            arc1 = [(c2[0] + r * math.cos(t), r * math.sin(t)) for t in (math.pi * (k / 8 - 0.5) for k in range(9))]
            arc2 = [(c1[0] + r * math.cos(t), r * math.sin(t)) for t in (math.pi * (k / 8 + 0.5) for k in range(9))]
        else:
            c1, c2 = (0.0, -(h / 2 - r)), (0.0, h / 2 - r)
            arc1 = [(r * math.cos(t), c2[1] + r * math.sin(t)) for t in (math.pi * k / 8 for k in range(9))]
            arc2 = [(r * math.cos(t), c1[1] + r * math.sin(t)) for t in (math.pi * (k / 8 + 1) for k in range(9))]
        return arc1 + arc2
    if shape == "oval":
        return circle_polygon(0.0, 0.0, w / 2, 16)
    hw, hh = w / 2, h / 2
    return [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]


def _pads(fp_node, copper_layers: list[str]) -> list[PadShape]:
    at = find(fp_node, "at")
    FX, FY = float(at[1]), float(at[2])
    FA = float(at[3]) if len(at) > 3 else 0.0
    ref = ""
    for p in find_all(fp_node, "property"):
        if len(p) > 2 and p[1] == "Reference":
            ref = str(p[2])
    if not ref:
        for t in find_all(fp_node, "fp_text"):
            if len(t) > 2 and str(t[1]) == "reference":
                ref = str(t[2])
    out = []
    for pad in find_all(fp_node, "pad"):
        number, kind, shape = str(pad[1]), str(pad[2]), str(pad[3])
        pat = find(pad, "at")
        px, py = float(pat[1]), float(pat[2])
        pa = float(pat[3]) if len(pat) > 3 else 0.0
        size = find(pad, "size")
        w, h = float(size[1]), float(size[2])
        dx, dy = rotate(px, py, FA)
        CX, CY = FX + dx, FY + dy
        poly = []
        for lx, ly in _pad_local(shape, w, h):
            rx, ry = rotate(lx, ly, pa)
            x, y = from_kicad(CX + rx, CY + ry)
            poly.append((round(x, 6) + 0.0, round(y, 6) + 0.0))
        drill = None
        dn = find(pad, "drill")
        if dn is not None:
            nums = [v for v in dn[1:] if not isinstance(v, list) and str(v) != "oval"]
            drill = float(nums[0]) if nums else None
        layers = find(pad, "layers")
        names = tuple(str(v) for v in layers[1:]) if layers else ()
        net = _net(pad) or None
        if kind == "np_thru_hole":
            net = None
        cx, cy = from_kicad(CX, CY)
        out.append(PadShape(ref, number, net, names, poly, (w, h), drill, kind in ("thru_hole", "np_thru_hole"),
                            (round(cx, 6) + 0.0, round(cy, 6) + 0.0)))
    return out


def read_copper(text: str) -> Copper:
    root = parse(text)
    layers = board_layers(root)
    tracks, arcs, vias, pads, fills, unfilled = [], [], [], [], [], []
    for n in root[1:]:
        if not isinstance(n, list) or not n:
            continue
        kind = str(n[0])
        if kind == "segment":
            tracks.append(Track(_uuid(n), _net(n), str(find(n, "layer")[1]), float(find(n, "width")[1]),
                                _xy(find(n, "start")), _xy(find(n, "end")), _locked(n)))
        elif kind == "arc":
            arcs.append(Arc(_uuid(n), _net(n), str(find(n, "layer")[1]), float(find(n, "width")[1]),
                            _xy(find(n, "start")), _xy(find(n, "mid")), _xy(find(n, "end")), _locked(n)))
        elif kind == "via":
            lay = [str(v) for v in find(n, "layers")[1:]] if find(n, "layers") else ["F.Cu", "B.Cu"]
            vias.append(Via(_uuid(n), _net(n), _xy(find(n, "at")), float(find(n, "size")[1]),
                            float(find(n, "drill")[1]), (lay[0], lay[-1]), _locked(n)))
        elif kind == "footprint":
            pads += _pads(n, layers)
        elif kind == "zone":
            if find(n, "keepout") is not None:
                continue
            net = _net(n)
            if not net:
                continue
            name_node = find(n, "name")
            name = str(name_node[1]) if name_node else _uuid(n)
            lay = find(n, "layers") or find(n, "layer")
            zone_layers = expand_layers([str(v) for v in lay[1:]], layers) if lay else ()
            filled_on = set()
            for fp_ in find_all(n, "filled_polygon"):
                fl = str(find(fp_, "layer")[1])
                filled_on.add(fl)
                fills.append(Fill(net, fl, name, [_xy(p) for p in find(fp_, "pts")[1:] if p[0] == "xy"]))
            outline = find(n, "polygon")
            if outline is not None:
                poly = [_xy(p) for p in find(outline, "pts")[1:] if p[0] == "xy"]
                for zl in zone_layers:
                    if zl not in filled_on:
                        unfilled.append(Fill(net, zl, name, poly))
    return Copper(tracks, arcs, vias, pads, fills, layers, unfilled)


def copper_nodes(text: str) -> list[list]:
    return [n for n in parse(text)[1:] if isinstance(n, list) and n and str(n[0]) in COPPER_KINDS]


# --- merging and UUIDs ---------------------------------------------------------------------------------------


def _signature(node) -> tuple:
    """(kind, net, layer text, numbers) of a copper node, numbers rounded to 1 nm."""
    kind = str(node[0])
    if kind == "via":
        lay = " ".join(str(v) for v in (find(node, "layers") or [None])[1:])
        nums = [float(v) for v in find(node, "at")[1:3]] + [float(find(node, "size")[1]), float(find(node, "drill")[1])]
    else:
        lay = str(find(node, "layer")[1])
        pts = ["start", "mid", "end"] if kind == "arc" else ["start", "end"]
        nums = [float(v) for k in pts for v in find(node, k)[1:3]] + [float(find(node, "width")[1])]
    return (kind, _net(node), lay, tuple(round(v, 6) for v in nums))


def _same(a, b) -> bool:
    sa, sb = _signature(a), _signature(b)
    if sa[:3] != sb[:3]:
        return False
    if all(abs(x - y) <= NM for x, y in zip(sa[3], sb[3])):
        return True
    if sa[0] == "segment":  # the same segment drawn the other way round
        x0, y0, x1, y1, w = sb[3]
        return all(abs(x - y) <= NM for x, y in zip(sa[3], (x1, y1, x0, y0, w)))
    return False


_AFTER_TRACKS = ("zone", "group", "generated", "embedded_fonts", "embedded_files")


def merge_copper(board_text: str, nodes: Sequence[list]) -> str:
    """The board's unlocked copper replaced by `nodes`; its locked copper kept (and a node equal to a kept locked
    item dropped). Copper goes where KiCad saves it: after the drawings, before the zones, in KiCad's order."""
    root = parse(board_text)
    body = [n for n in root[1:] if not (isinstance(n, list) and n and str(n[0]) in COPPER_KINDS)]
    locked = [n for n in root[1:] if isinstance(n, list) and n and str(n[0]) in COPPER_KINDS and _locked(n)]
    added = [n for n in nodes if not any(_same(n, k) for k in locked)]
    tracks = sorted(locked + list(added), key=track_order)
    at = next((i for i, n in enumerate(body) if isinstance(n, list) and n and str(n[0]) in _AFTER_TRACKS), len(body))
    return dump([root[0], *body[:at], *tracks, *body[at:]]) + "\n"


def rewrite_uuids(nodes: Sequence[list]) -> list[list]:
    """Unlocked copper gets UUIDs hashed from what it is, so a router's random UUIDs never reach pino's files;
    locked copper keeps its own. The result is sorted, so the input order does not matter."""
    locked = sorted((n for n in nodes if _locked(n)), key=_uuid)
    loose = sorted((n for n in nodes if not _locked(n)), key=lambda n: (_signature(n)[0], _signature(n)[2],
                                                                         _signature(n)[1], _signature(n)[3]))
    seen: dict[tuple, int] = defaultdict(int)
    out = []
    for n in loose:
        kind, net, lay, values = _signature(n)
        parts = ("copper", kind, net, lay, *(str(num(v)) for v in values))
        seen[parts] += 1
        if seen[parts] > 1:
            parts = (*parts, f"#{seen[parts]}")
        m = copy.deepcopy(n)
        u = find(m, "uuid") or find(m, "tstamp")
        if u is None:
            m.append([Sym("uuid"), ids.uid(*parts)])
        else:
            u[0], u[1] = Sym("uuid"), ids.uid(*parts)
        out.append(m)
    return [copy.deepcopy(n) for n in locked] + out


def _r(v: float) -> float:
    return round(v, 6) + 0.0


def copper_json(copper: Copper) -> str:
    def pts(*ps):
        return [[_r(p[0]), _r(p[1])] for p in ps]

    data = {
        "schema": "pino.copper/1",
        "tracks": sorted(({"uuid": t.uuid, "net": t.net, "layer": t.layer, "width": _r(t.width),
                           "points": pts(t.a, t.b), "kept": t.locked} for t in copper.tracks), key=lambda d: d["uuid"]),
        "arcs": sorted(({"uuid": a.uuid, "net": a.net, "layer": a.layer, "width": _r(a.width),
                         "points": pts(a.start, a.mid, a.end), "kept": a.locked} for a in copper.arcs),
                       key=lambda d: d["uuid"]),
        "vias": sorted(({"uuid": v.uuid, "net": v.net, "layers": list(v.layers), "diameter": _r(v.diameter),
                         "drill": _r(v.drill), "points": pts(v.at), "kept": v.locked} for v in copper.vias),
                       key=lambda d: d["uuid"]),
    }
    return json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


# --- stripping and moving ------------------------------------------------------------------------------------


def strip_copper(text: str) -> str:
    """Top-level tracks, arcs and vias removed, and every zone's fill; footprints and zone outlines stay."""
    root = parse(text)
    out = [root[0]]
    for n in root[1:]:
        if isinstance(n, list) and n and str(n[0]) in COPPER_KINDS:
            continue
        if isinstance(n, list) and n and str(n[0]) == "zone":
            n = [c for c in n if not (isinstance(c, list) and c and str(c[0]) == "filled_polygon")]
        out.append(n)
    return dump(out) + "\n"


def _shift_xy(node, dX: float, dY: float) -> None:
    for c in node:
        if isinstance(c, list) and c:
            if str(c[0]) == "xy" and len(c) >= 3:
                c[1], c[2] = num(float(c[1]) + dX), num(float(c[2]) + dY)
            else:
                _shift_xy(c, dX, dY)


def footprint_ref(fp_node) -> str:
    for p in find_all(fp_node, "property"):
        if len(p) > 2 and p[1] == "Reference":
            return str(p[2])
    for t in find_all(fp_node, "fp_text"):
        if len(t) > 2 and str(t[1]) == "reference":
            return str(t[2])
    return ""


def move_footprint(text: str, ref: str, dx: float, dy: float) -> str:
    """Footprint `ref` moved by (dx, dy) board mm, with the zones it owns (KiCad keeps those in board coordinates)."""
    root = parse(text)
    dX, dY = dx, -dy
    found = False
    for n in root[1:]:
        if isinstance(n, list) and n and str(n[0]) == "footprint" and footprint_ref(n) == ref:
            at = find(n, "at")
            at[1], at[2] = num(float(at[1]) + dX), num(float(at[2]) + dY)
            for z in find_all(n, "zone"):
                _shift_xy(z, dX, dY)
            found = True
    if not found:
        raise KeyError(ref)
    return dump(root) + "\n"


# --- contact ---------------------------------------------------------------------------------------------------

Prim = tuple  # ("cap", a, b, r) | ("poly", polygon)


@dataclass
class Item:
    kind: str  # track | arc | via | pad | fill | zone
    net: str
    layers: frozenset[str]
    prims: list[Prim]
    box: tuple[float, float, float, float]
    obj: object
    uuid: str | None = None  # tracks, arcs and vias
    locked: bool = False


def _prim_box(p: Prim) -> tuple[float, float, float, float]:
    if p[0] == "cap":
        _, a, b, r = p
        return (min(a[0], b[0]) - r, min(a[1], b[1]) - r, max(a[0], b[0]) + r, max(a[1], b[1]) + r)
    return bbox(p[1])


def _box(prims: list[Prim]) -> tuple[float, float, float, float]:
    boxes = [_prim_box(p) for p in prims]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def via_layers(v: Via, layers: Sequence[str]) -> frozenset[str]:
    """A via is copper on every layer from its first to its last."""
    if v.layers[0] in layers and v.layers[1] in layers:
        i, j = sorted((layers.index(v.layers[0]), layers.index(v.layers[1])))
        return frozenset(layers[i:j + 1])
    return frozenset(layers)


def pad_copper_layers(p: PadShape, layers: Sequence[str]) -> frozenset[str]:
    if p.net is None:
        return frozenset()
    if p.through:
        return frozenset(layers)
    return frozenset(expand_layers(p.layers, layers))


def items_of(copper: Copper) -> list[Item]:
    out: list[Item] = []
    for t in copper.tracks:
        prims = [("cap", t.a, t.b, t.width / 2)]
        out.append(Item("track", t.net, frozenset([t.layer]), prims, _box(prims), t, t.uuid, t.locked))
    for a in copper.arcs:
        pts = arc_points(a.start, a.mid, a.end, chord=0.1)
        prims = [("cap", pts[i], pts[i + 1], a.width / 2) for i in range(len(pts) - 1)]
        out.append(Item("arc", a.net, frozenset([a.layer]), prims, _box(prims), a, a.uuid, a.locked))
    for v in copper.vias:
        prims = [("cap", v.at, v.at, v.diameter / 2)]
        out.append(Item("via", v.net, via_layers(v, copper.layers), prims, _box(prims), v, v.uuid, v.locked))
    for p in copper.pads:
        lay = pad_copper_layers(p, copper.layers)
        if lay and p.polygon:
            prims = [("poly", p.polygon)]
            out.append(Item("pad", p.net or "", lay, prims, _box(prims), p))
    for f in copper.fills:
        if len(f.polygon) >= 3:
            prims = [("poly", f.polygon)]
            out.append(Item("fill", f.net, frozenset([f.layer]), prims, _box(prims), f))
    for f in copper.unfilled:
        if len(f.polygon) >= 3:
            prims = [("poly", f.polygon)]
            out.append(Item("zone", f.net, frozenset([f.layer]), prims, _box(prims), f))
    return out


def _prim_distance(p: Prim, q: Prim) -> float:
    if p[0] == "cap" and q[0] == "cap":
        return segment_distance(p[1], p[2], q[1], q[2]) - p[3] - q[3]
    if p[0] == "cap":
        return segment_polygon_distance(p[1], p[2], q[1]) - p[3]
    if q[0] == "cap":
        return segment_polygon_distance(q[1], q[2], p[1]) - q[3]
    return polygon_distance(p[1], q[1])


def boxes_near(a, b, grow: float = TOUCH) -> bool:
    return a[0] <= b[2] + grow and b[0] <= a[2] + grow and a[1] <= b[3] + grow and b[1] <= a[3] + grow


def touch(i: Item, j: Item, grow: float = TOUCH) -> bool:
    """Two items of one net touch: their copper, grown by `grow`, meets on a layer they share."""
    if not (i.layers & j.layers) or not boxes_near(i.box, j.box, grow):
        return False
    return any(_prim_distance(p, q) <= grow for p in i.prims for q in j.prims
               if boxes_near(_prim_box(p), _prim_box(q), grow))


def holds(i: Item, pt: Point, grow: float = TOUCH) -> bool:
    """The item's copper covers the point (within `grow`)."""
    for p in i.prims:
        if p[0] == "cap":
            if point_segment_distance(pt, p[1], p[2]) <= p[3] + grow:
                return True
        elif point_in_polygon(pt, p[1]) or distance_to_edges(pt, p[1]) <= grow:
            return True
    return False


def contact_map(items: Sequence[Item], grow: float = TOUCH) -> dict[int, list[int]]:
    """index -> indexes of the items of the same net it touches."""
    by_net: dict[str, list[int]] = defaultdict(list)
    for k, it in enumerate(items):
        if it.net:
            by_net[it.net].append(k)
    out: dict[int, list[int]] = {k: [] for k in range(len(items))}
    for idx in by_net.values():
        idx = sorted(idx, key=lambda k: items[k].box[0])
        for a_pos, a in enumerate(idx):
            ia = items[a]
            for b in idx[a_pos + 1:]:
                ib = items[b]
                if ib.box[0] > ia.box[2] + grow:
                    break
                if touch(ia, ib, grow):
                    out[a].append(b)
                    out[b].append(a)
    return out
