"""Load .kicad_mod footprints and turn them into placed board footprints.

Placed positions are board mm (pino's frame, y up); the S-expression is written in KiCad's
frame through coords.to_kicad. Items are written in KiCad's own save order so that a KiCad
re-save of the board only adds zone fill. Library UUIDs are replaced: two instances of one
footprint must never share an id.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from pathlib import Path

from .. import ids
from ..circuit import Circuit
from ..coords import from_kicad, to_kicad
from ..findings import Finding
from ..geometry import Polygon, arc_points, bbox, circle_polygon
from ..libraries import Libraries
from ..sexpr import Sym, find, find_all, num, parse

_DROP = {"version", "generator", "generator_version"}
_POINT_KEYS = {"at", "start", "end", "mid", "center", "xy"}
_GRAPHICS = {"fp_line", "fp_arc", "fp_circle", "fp_rect", "fp_poly", "fp_curve", "fp_text", "fp_text_box",
             "group", "dimension", "image"}
MODEL_VARS = ("KICAD10_3DMODEL_DIR", "KICAD9_3DMODEL_DIR", "KICAD8_3DMODEL_DIR", "KICAD7_3DMODEL_DIR",
              "KICAD6_3DMODEL_DIR")


class FootprintNotFound(KeyError):
    def __str__(self) -> str:
        return str(self.args[0]) if self.args else "footprint not found"


def flip_layer(name: str) -> str:
    if name.startswith("F."):
        return "B." + name[2:]
    if name.startswith("B."):
        return "F." + name[2:]
    return name


def rotate(x: float, y: float, deg: float) -> tuple[float, float]:
    """KiCad's RotatePoint, in KiCad's frame: positive angle is counter-clockwise on screen (y down)."""
    if deg == 0:
        return x, y
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return x * c + y * s, -x * s + y * c


def norm_angle(a: float) -> float:
    a = round(a % 360, 6)
    return 0 if a == 360 else a


@dataclass(frozen=True)
class LocalPad:
    number: str
    kind: str  # smd | thru_hole | np_thru_hole | connect
    x: float  # footprint-local, KiCad frame (y down)
    y: float
    angle: float
    w: float
    h: float
    layers: tuple[str, ...]

    @property
    def through(self) -> bool:
        return self.kind in ("thru_hole", "np_thru_hole")


@dataclass
class Footprint:
    lib_id: str
    node: list
    pads: list[LocalPad]
    courtyard: dict[str, list[Polygon]]  # "F" / "B", local KiCad frame
    models: list[str]
    edge_face: str  # top | bottom | left | right (local)
    keepouts: list[Polygon]  # footprint-owned keep-out zones, local KiCad frame

    @property
    def through_hole(self) -> bool:
        return any(p.through for p in self.pads)


@dataclass
class Pad:
    number: str
    x: float  # board mm
    y: float
    layers: list[str]
    net: str | None
    through: bool
    poly: Polygon = field(default_factory=list)  # pad outline (its rotated box), board mm


@dataclass
class Placed:
    ref: str
    key: str
    footprint: Footprint
    x: float  # board mm
    y: float
    rot: float = 0.0
    back: bool = False
    value: str = ""
    pad_nets: dict[str, str] = field(default_factory=dict)
    dnp: bool = False
    lcsc: str = ""
    datasheet: str = ""
    description: str = ""
    hand_fit: bool = False


# --- loading -------------------------------------------------------------------------


def _shape_polygon(item) -> Polygon | None:
    kind = item[0]
    if kind == "fp_rect":
        (x0, y0), (x1, y1) = (tuple(map(float, find(item, k)[1:3])) for k in ("start", "end"))
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    if kind == "fp_poly":
        return [tuple(map(float, p[1:3])) for p in find_all(find(item, "pts"), "xy")]
    if kind == "fp_circle":
        cx, cy = map(float, find(item, "center")[1:3])
        ex, ey = map(float, find(item, "end")[1:3])
        return circle_polygon(cx, cy, math.hypot(ex - cx, ey - cy), 32)
    return None


def _loops(segments: list[list[tuple[float, float]]]) -> list[Polygon]:
    """Join open pieces (lines and arcs as point lists) end to end into closed loops."""
    out, pieces = [], [list(s) for s in segments]
    close = lambda a, b: math.dist(a, b) < 1e-3
    while pieces:
        loop = pieces.pop(0)
        grown = True
        while grown and not close(loop[0], loop[-1]):
            grown = False
            for i, p in enumerate(pieces):
                if close(loop[-1], p[0]):
                    loop += p[1:]
                elif close(loop[-1], p[-1]):
                    loop += list(reversed(p))[1:]
                else:
                    continue
                pieces.pop(i)
                grown = True
                break
        if len(loop) >= 3 and close(loop[0], loop[-1]):
            out.append(loop[:-1])
        elif loop:
            out.append(None)  # an open piece: the caller falls back to a box
    return out


def _courtyards(node) -> dict[str, list[Polygon]]:
    out: dict[str, list[Polygon]] = {}
    for side, layer in (("F", "F.CrtYd"), ("B", "B.CrtYd")):
        polys, pieces, points = [], [], []
        for item in node:
            if not (isinstance(item, list) and item and item[0] in _GRAPHICS):
                continue
            lay = find(item, "layer")
            if not lay or lay[1] != layer:
                continue
            poly = _shape_polygon(item)
            if poly is not None:
                polys.append(poly)
                points += poly
            elif item[0] == "fp_line":
                seg = [tuple(map(float, find(item, k)[1:3])) for k in ("start", "end")]
                pieces.append(seg)
                points += seg
            elif item[0] == "fp_arc":
                seg = arc_points(*(tuple(map(float, find(item, k)[1:3])) for k in ("start", "mid", "end")), chord=0.2)
                pieces.append(seg)
                points += seg
        loops = _loops(pieces) if pieces else []
        if any(lp is None for lp in loops):
            x0, y0, x1, y1 = bbox(points)
            polys = [[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]
        else:
            polys += loops
        if polys:
            out[side] = polys
    return out


def _zone_polygon(zone) -> Polygon:
    poly = find(zone, "polygon")
    return [tuple(map(float, p[1:3])) for p in find_all(find(poly, "pts"), "xy")] if poly else []


def _edge_face(node, pads: list[LocalPad], courtyard, keepouts) -> str:
    pts = [(p.x, p.y) for p in pads] + [q for polys in courtyard.values() for poly in polys for q in poly]
    if not pts:
        return "bottom"
    x0, y0, x1, y1 = bbox(pts)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    target = None
    if keepouts:
        zx0, zy0, zx1, zy1 = bbox([q for k in keepouts for q in k])
        target = ((zx0 + zx1) / 2, (zy0 + zy1) / 2)
    else:
        for item in find_all(node, "fp_text"):
            lay = find(item, "layer")
            if len(item) > 2 and str(item[2]).strip().lower() == "pcb edge" and lay and lay[1] == "Dwgs.User":
                at = find(item, "at")
                target = (float(at[1]), float(at[2]))
                break
    if target is None:
        return "bottom"  # KiCad's connector convention: mating face toward local +y
    dx, dy = target[0] - cx, target[1] - cy
    if abs(dy) >= abs(dx):
        return "top" if dy < 0 else "bottom"
    return "left" if dx < 0 else "right"


def _footprint(lib_id: str, node: list) -> Footprint:
    pads = []
    for p in find_all(node, "pad"):
        at, size = find(p, "at"), find(p, "size")
        lay = find(p, "layers")
        pads.append(LocalPad(str(p[1]), str(p[2]), float(at[1]), float(at[2]),
                             float(at[3]) if len(at) > 3 else 0.0,
                             float(size[1]) if size else 0.0, float(size[2]) if size else 0.0,
                             tuple(str(s) for s in lay[1:]) if lay else ()))
    keepouts = [_zone_polygon(z) for z in find_all(node, "zone") if find(z, "keepout")]
    courtyard = _courtyards(node)
    models = [str(m[1]) for m in find_all(node, "model")]
    return Footprint(lib_id, node, pads, courtyard, models, _edge_face(node, pads, courtyard, keepouts),
                     [k for k in keepouts if k])


class FootprintLibrary:
    def __init__(self, libraries: Libraries):
        self.libraries = libraries
        self._cache: dict[str, tuple[int, Footprint]] = {}

    def path(self, lib_id: str) -> Path:
        lib, sep, name = lib_id.partition(":")
        if not sep:
            raise FootprintNotFound(f"footprint {lib_id!r} is not in the form Library:Name")
        return self.libraries.footprints / f"{lib}.pretty" / f"{name}.kicad_mod"

    def load(self, lib_id: str) -> Footprint:
        path = self.path(lib_id)
        try:
            mtime = path.stat().st_mtime_ns
        except FileNotFoundError:
            raise FootprintNotFound(f"footprint {lib_id} not found in {self.libraries.footprints}") from None
        hit = self._cache.get(lib_id)
        if hit and hit[0] == mtime:
            return hit[1]
        fp = _footprint(lib_id, parse(path.read_text(encoding="utf-8")))
        self._cache[lib_id] = (mtime, fp)
        return fp

    def source_digest(self, lib_id: str) -> str:
        return hashlib.sha256(self.path(lib_id).read_bytes()).hexdigest()

    def model_exists(self, path: str) -> bool:
        resolved = path
        for var in MODEL_VARS:
            resolved = resolved.replace("${" + var + "}", str(self.libraries.models))
        if "${" in resolved:
            return False
        p = Path(resolved)
        if p.is_file():
            return True
        return any(p.with_suffix(s).is_file() for s in (".step", ".stp", ".wrl"))


# --- placement -------------------------------------------------------------------------


def _world(p: Placed, lx: float, ly: float) -> tuple[float, float]:
    """A footprint-local point (KiCad frame) to board mm."""
    if p.back:
        ly = -ly
    X, Y = to_kicad(p.x, p.y)
    dx, dy = rotate(lx, ly, p.rot)
    bx, by = from_kicad(X + dx, Y + dy)
    return (round(bx, 6) + 0.0, round(by, 6) + 0.0)


def pad_world(p: Placed) -> list[Pad]:
    out = []
    for pad in p.footprint.pads:
        x, y = _world(p, pad.x, pad.y)
        layers = [flip_layer(s) for s in pad.layers] if p.back else list(pad.layers)
        a = math.radians(pad.angle)
        hw, hh = pad.w / 2, pad.h / 2
        corners = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
        # pad angle is local to the footprint (KiCad frame, counter-clockwise on screen)
        poly = [_world(p, pad.x + cx * math.cos(a) + cy * math.sin(a), pad.y - cx * math.sin(a) + cy * math.cos(a))
                for cx, cy in corners]
        out.append(Pad(pad.number, x, y, layers, p.pad_nets.get(pad.number) if pad.number else None, pad.through, poly))
    return out


def courtyard_world(p: Placed) -> dict[str, list[Polygon]]:
    out: dict[str, list[Polygon]] = {}
    for side, polys in p.footprint.courtyard.items():
        world_side = ("B" if side == "F" else "F") if p.back else side
        out.setdefault(world_side, []).extend([_world(p, x, y) for x, y in poly] for poly in polys)
    if p.footprint.through_hole:
        both = [poly for polys in out.values() for poly in polys]
        out = {"F": both, "B": both}
    return out


def keepouts_world(p: Placed) -> list[Polygon]:
    return [[_world(p, x, y) for x, y in poly] for poly in p.footprint.keepouts]


def _flip_tree(node, back: bool):
    """Mirror a footprint-local subtree for the back side: y -> -y, angles negated, layers swapped."""
    if not back or not isinstance(node, list):
        return node
    head = node[0] if node else None
    out = [node[0]] if node else []
    for c in node[1:]:
        if isinstance(c, list):
            out.append(_flip_tree(c, back))
        elif head in ("layer", "layers") and isinstance(c, str):
            # quoted ("F.Cu") as KiCad 10 writes it, or bare (F.Cu) as older and converted libraries do
            out.append(Sym(flip_layer(c)) if isinstance(c, Sym) else flip_layer(c))
        else:
            out.append(c)
    if head in _POINT_KEYS and len(out) >= 3:
        out[2] = num(-float(out[2]))
        if head == "at" and len(out) >= 4:
            out[3] = num(norm_angle(-float(out[3])))
    if head == "effects":
        j = find(out, "justify")
        if j is None:
            out.append([Sym("justify"), Sym("mirror")])
        elif Sym("mirror") not in j:
            j.append(Sym("mirror"))
    return out


def _abs_angle(at_node, rot: float, always: bool):
    """Footprint text and pad angles are written as absolute angles in a board.
    KiCad always writes the angle for text, and only a non-zero one for pads."""
    local = float(at_node[3]) if len(at_node) >= 4 else 0.0
    a = norm_angle(rot + local)
    base = at_node[:3]
    return base + [num(a)] if (a or always) else base


_PAD_OPTS = {
    "roundrect_rratio", "chamfer_ratio", "chamfer", "remove_unused_layers", "keep_end_layers",
    "solder_mask_margin", "solder_paste_margin", "solder_paste_margin_ratio", "clearance",
    "zone_connect", "thermal_bridge_width", "thermal_gap", "thermal_bridge_angle", "property", "die_length",
}
_TEXT_FIRST = ("at", "unlocked", "layer", "hide")


def _text_order(item, item_uuid):
    """KiCad's order for property/fp_text: at, unlocked, layer, hide, uuid, then effects and the rest."""
    head = [c for c in item if not isinstance(c, list)]
    lists = [c for c in item if isinstance(c, list)]
    first = [c for k in _TEXT_FIRST for c in lists if c[0] == k]
    rest = [c for c in lists if c[0] not in _TEXT_FIRST]
    return head + first + [[Sym("uuid"), item_uuid]] + rest


def _empty_prop(name, p, item_uuid, value="", thickness=None):
    """A hidden field on the fab layer. KiCad writes a font thickness for user fields (LCSC) and none for
    Datasheet and Description; matching it keeps a re-save unchanged."""
    S = Sym
    font = [S("font"), [S("size"), num(1.27), num(1.27)]] + ([[S("thickness"), num(thickness)]] if thickness else [])
    return [S("property"), name, value, [S("at"), 0, 0, num(norm_angle(p.rot))],
            [S("layer"), "B.Fab" if p.back else "F.Fab"], [S("hide"), S("yes")], [S("uuid"), item_uuid],
            [S("effects"), font]
            + ([[S("justify"), S("mirror")]] if p.back else [])]


def _zone_item(c, p: Placed, copper_layers: list[str], item_uuid: str):
    """A footprint-owned zone: only the board's copper layers, polygon in board (KiCad) coordinates."""
    item = [cc for cc in c if not (isinstance(cc, list) and cc and cc[0] == "uuid")]
    out = []
    for cc in item:
        if isinstance(cc, list) and cc and cc[0] in ("layers", "layer"):
            names = [str(s) for s in cc[1:]]
            names = [n for name in names for n in (("F.Cu", "B.Cu") if name == "F&B.Cu" else (name,))]
            if p.back:
                names = [flip_layer(n) for n in names]
            keep = [n for n in names if n in copper_layers or n == "*.Cu"]
            if "*.Cu" in keep:
                keep = list(copper_layers)
            keep = [n for n in copper_layers if n in keep]  # board order
            if not keep:
                return None  # the zone is on none of this board's layers
            out.append([Sym("layers"), *keep] if len(keep) != 1 else [Sym("layer"), keep[0]])
            out.append([Sym("uuid"), item_uuid])
        elif isinstance(cc, list) and cc and cc[0] == "polygon":
            pts = find(cc, "pts")
            moved = []
            for xy in find_all(pts, "xy"):
                X, Y = to_kicad(*_world(p, float(xy[1]), float(xy[2])))
                moved.append([Sym("xy"), num(X), num(Y)])
            out.append([Sym("polygon"), [Sym("pts"), *moved]])
        else:
            out.append(cc)
    return out


_AFTER_POS_FILES = ("exclude_from_bom", "allow_missing_courtyard", "allow_soldermask_bridges", "dnp")


def _hand_fit_attr(attr: list) -> list:
    """`attr` with exclude_from_pos_files, where KiCad saves it: a hand-fit part is never placed by the fab."""
    flag = Sym("exclude_from_pos_files")
    if flag in attr:
        return attr
    at = next((i for i, v in enumerate(attr) if i and str(v) in _AFTER_POS_FILES), len(attr))
    return [*attr[:at], flag, *attr[at:]]


def place(p: Placed, *, copper_layers: list[str]) -> list:
    src = p.footprint.node
    key = p.key
    out = [Sym("footprint"), p.footprint.lib_id]
    out.append([Sym("layer"), "B.Cu" if p.back else "F.Cu"])
    out.append([Sym("uuid"), ids.footprint_uuid(key)])
    X, Y = to_kicad(p.x, p.y)
    at = [Sym("at"), num(X), num(Y)]
    angle = norm_angle(p.rot)
    if angle:
        at.append(num(angle - 360 if angle > 180 else angle))  # KiCad saves a footprint's angle in (-180, 180]
    out.append(at)

    body = [c for c in src[2:] if isinstance(c, list) and c[0] not in _DROP and c[0] != "layer"]
    inserted_path = False
    drawings: list = []
    zones: list = []
    for i, c in enumerate(body):
        kind = c[0]
        if drawings and kind not in _GRAPHICS:
            out += [d for _, d in sorted(drawings, key=lambda t: t[0])]
            drawings = []
        if kind in ("descr", "tags"):
            out.append(c)
            continue
        if kind == "attr" and not inserted_path:
            out.append([Sym("path"), ids.footprint_path(key)])
            out.append([Sym("sheetname"), "/"])
            out.append([Sym("sheetfile"), "board.kicad_sch"])
            inserted_path = True
        if kind == "attr" and p.hand_fit:
            c = _hand_fit_attr(c)
        if kind == "attr" and p.dnp and Sym("dnp") not in c:
            c = [*c, Sym("dnp")]
        item_uuid = ids.uid("footprint", key, str(i), kind)
        if kind == "zone":
            z = _zone_item(c, p, copper_layers, item_uuid)
            if z is not None:
                zones.append(z)
            continue
        if kind in ("model", "embedded_fonts"):
            out.append(c)
            continue
        item = _flip_tree(c, p.back)
        item = [cc for cc in item if not (isinstance(cc, list) and cc and cc[0] == "uuid")]
        if kind == "property":
            if item[1] == "Reference":
                item = [item[0], item[1], p.ref] + item[3:]
            elif item[1] == "Value" and p.value:
                item = [item[0], item[1], p.value] + item[3:]
            elif item[1] in ("Datasheet", "Description"):
                # the symbol's fields win, as KiCad's update from the schematic does
                item = [item[0], item[1], p.datasheet if item[1] == "Datasheet" else p.description] + item[3:]
        if kind in ("property", "fp_text", "pad"):
            for j, cc in enumerate(item):
                if isinstance(cc, list) and cc[0] == "at":
                    item[j] = _abs_angle(cc, p.rot, always=kind != "pad")
                    break
        if kind == "pad":
            number = item[1]
            net = p.pad_nets.get(number) if number else None
            lay = find(item, "layers")
            idx = item.index(lay) + 1
            # KiCad's order: geometry, layers, pad options, (net), (uuid), then the rest.
            while idx < len(item) and isinstance(item[idx], list) and item[idx][0] in _PAD_OPTS:
                idx += 1
            ins = item[:idx]
            if net:
                ins.append([Sym("net"), net])
            ins.append([Sym("uuid"), item_uuid])
            item = ins + item[idx:]
        elif kind in ("property", "fp_text"):
            item = _text_order(item, item_uuid)
            if kind == "fp_text":
                drawings.append((drawing_key(item, X, Y, p.rot) + [item_uuid], item))
                continue
        elif kind in _GRAPHICS:
            item = item + [[Sym("uuid"), item_uuid]]
            drawings.append((drawing_key(item, X, Y, p.rot) + [item_uuid], item))
            continue
        out.append(item)
        if kind == "property" and item[1] == "Value":
            have = {b[1] for b in body if b[0] == "property"}
            for extra in ("Datasheet", "Description"):
                if extra not in have:
                    value = p.datasheet if extra == "Datasheet" else p.description
                    out.append(_empty_prop(extra, p, ids.uid("footprint", key, "prop", extra), value))
            if "LCSC" not in have:
                # the symbol's fields must be on its footprint, or DRC's parity check reports the one missing
                out.append(_empty_prop("LCSC", p, ids.uid("footprint", key, "prop", "LCSC"), p.lcsc, 0.15))
    out += [d for _, d in sorted(drawings, key=lambda t: t[0])]
    # KiCad writes a footprint's zones after its pads and drawings, before embedded_fonts and models
    if zones:
        tail_at = next((i for i, c in enumerate(out) if isinstance(c, list) and c and c[0] in ("embedded_fonts", "model")),
                       len(out))
        out[tail_at:tail_at] = zones
    return out


# --- KiCad's save order for footprint drawings (FOOTPRINT::cmp_drawings) -------------------------
_LAYER_IDS = {"F.Cu": 0, "B.Cu": 2, "F.Mask": 1, "B.Mask": 3, "F.SilkS": 5, "B.SilkS": 7, "F.Adhes": 9,
              "B.Adhes": 11, "F.Paste": 13, "B.Paste": 15, "Dwgs.User": 17, "Cmts.User": 19, "Eco1.User": 21,
              "Eco2.User": 23, "Edge.Cuts": 25, "Margin": 27, "B.CrtYd": 29, "F.CrtYd": 31, "B.Fab": 33,
              "F.Fab": 35}
_TYPE_RANK = {"fp_line": 0, "fp_rect": 0, "fp_arc": 0, "fp_circle": 0, "fp_poly": 0, "fp_curve": 0,
              "fp_text": 1, "fp_text_box": 2}
_SHAPE_RANK = {"fp_line": 0, "fp_rect": 1, "fp_arc": 2, "fp_circle": 3, "fp_poly": 4, "fp_curve": 5}


def _nm(v: float) -> int:
    return round(v * 1_000_000)


def _arc_center(a, m, b):
    ax, ay = a; bx, by = m; cx, cy = b
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    return ux, uy


def drawing_key(item, fx, fy, rot):
    """Sort key for a placed footprint drawing. Coordinates are KiCad world coordinates in nm.
    `item` is already flipped for the back side (local y mirrored)."""
    kind = item[0]
    lay = find(item, "layer")
    key = [_TYPE_RANK.get(kind, 9), _LAYER_IDS.get(lay[1] if lay else "", 99)]

    def w(node):
        x, y = rotate(float(node[1]), float(node[2]), rot)
        return _nm(fx + x), _nm(fy + y)

    if kind in _SHAPE_RANK:
        key.append(_SHAPE_RANK[kind])
        if kind != "fp_poly":
            s = find(item, "start") or find(item, "center")
            e = find(item, "end")
            key += [*w(s), *w(e)]
        if kind == "fp_arc":
            c = _arc_center(*(w(find(item, k)) for k in ("start", "mid", "end")))
            key += [round(c[0]), round(c[1])]
        if kind == "fp_poly":
            pts = find_all(find(item, "pts"), "xy")
            key.append(len(pts))
            for p in pts:
                key += [*w(p)]
        st = find(item, "stroke")
        width = find(st, "width") if st else None
        key.append(_nm(float(width[1])) if width else 0)
    return key


# --- checks -------------------------------------------------------------------------------


def model_findings(placed: list[Placed], lib: FootprintLibrary) -> list[Finding]:
    out = []
    for p in placed:
        if not p.footprint.models:
            out.append(Finding("model3d", "model3d_none", "info", f"{p.ref} ({p.footprint.lib_id}) has no 3D model",
                               refs=(p.ref,)))
            continue
        for m in p.footprint.models:
            if not lib.model_exists(m):
                out.append(Finding("model3d", "model3d_missing", "warning",
                                   f"{p.ref}: 3D model not found: {m}", refs=(p.ref,)))
    return out


def pin_pad_findings(circuit: Circuit, lib: FootprintLibrary) -> list[Finding]:
    out = []
    for part in circuit.parts:
        try:
            fp = lib.load(part.footprint)
        except FootprintNotFound as e:
            out.append(Finding("pads", "footprint_not_found", "error", f"{part.ref}: {e}", refs=(part.ref,)))
            continue
        pads = {p.number for p in fp.pads if p.number}
        pins = {p.number for p in part.pins if p.etype != "no_connect"}
        for n in sorted(pins - pads):
            out.append(Finding("pads", "pin_without_pad", "error",
                               f"{part.ref}: pin {n} has no pad in {part.footprint}", refs=(part.ref,),
                               pins=(f"{part.ref}.{n}",)))
        every_pin = {p.number for p in part.pins}
        for n in sorted(pads - every_pin):
            out.append(Finding("pads", "pad_without_pin", "warning",
                               f"{part.ref}: pad {n} of {part.footprint} has no pin in {part.symbol}",
                               refs=(part.ref,)))
    return out


# --- edge parts --------------------------------------------------------------------------

# world face -> (axis, which way is off the board)
FACE_AXIS = {"top": ("y", 1), "bottom": ("y", -1), "right": ("x", 1), "left": ("x", -1)}


def face_line(courtyards: list, keepouts: list, pad_polys: list, face: str) -> tuple[float, float, bool]:
    """Where an edge part meets the board edge on its face side, in board mm along the face's axis.

    A footprint that carries its own keep-out on the face side (a module's antenna clearance) meets the edge
    where that keep-out begins, so the keep-out lies off the board. Any other part meets it with its
    courtyard's face side. Returns (line, how far the pads reach toward the face, whether a keep-out set it).
    """
    axis, sign = FACE_AXIS[face]
    i = 0 if axis == "x" else 1
    pts = [q for poly in courtyards for q in poly]
    pad_pts = [q for poly in pad_polys for q in poly] or pts
    centre = (min(q[i] for q in pad_pts) + max(q[i] for q in pad_pts)) / 2
    ahead = [k for k in keepouts if k and sign * (sum(q[i] for q in k) / len(k) - centre) > 0]
    reach = max(sign * q[i] for q in pad_pts) * sign
    if ahead:
        inner = [min(sign * q[i] for q in k) * sign for k in ahead]
        return (min(inner) if sign > 0 else max(inner)), reach, True
    side = max(sign * q[i] for q in pts) * sign
    return side, reach, False
