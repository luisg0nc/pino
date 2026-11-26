"""Small .kicad_pcb texts for the routing tests, built with sexpr. Every coordinate here is board mm (y up)."""

from __future__ import annotations

import itertools
from pathlib import Path

from pino_kernel.coords import to_kicad
from pino_kernel.sexpr import Sym, dump, num

S = Sym
_count = itertools.count(1)


def _uuid() -> str:
    return f"00000000-0000-4000-8000-{next(_count):012d}"


def _xy(p):
    X, Y = to_kicad(*p)
    return num(X), num(Y)


def pad(number: str, at=(0.0, 0.0), size=(0.8, 0.8), *, net: str | None = None, shape: str = "roundrect",
        kind: str = "smd", layers=("F.Cu", "F.Mask", "F.Paste"), drill: float | None = None, angle: float = 0.0):
    """A pad, `at` in the footprint's local KiCad frame (as a board file stores it)."""
    return dict(number=number, at=at, size=size, net=net, shape=shape, kind=kind, layers=tuple(layers),
                drill=drill, angle=angle)


def fp(ref: str, at=(0.0, 0.0, 0.0), pads=(), *, back: bool = False, nets: dict | None = None,
       lib: str = "pino_test:R_0603", value: str = "", silk: str = "", uuid: str | None = None):
    return dict(ref=ref, at=at, pads=list(pads), back=back, nets=nets or {}, lib=lib, value=value, silk=silk,
                uuid=uuid)


def track(net: str, a, b, width: float = 0.2, layer: str = "F.Cu", *, locked: bool = False, uuid: str | None = None):
    return ("segment", dict(net=net, a=a, b=b, width=width, layer=layer, locked=locked, uuid=uuid or _uuid()))


def arc(net: str, start, mid, end, width: float = 0.2, layer: str = "F.Cu", *, locked: bool = False):
    return ("arc", dict(net=net, start=start, mid=mid, end=end, width=width, layer=layer, locked=locked,
                        uuid=_uuid()))


def via(net: str, at, diameter: float = 0.6, drill: float = 0.3, layers=("F.Cu", "B.Cu"), *, locked: bool = False,
        uuid: str | None = None):
    return ("via", dict(net=net, at=at, diameter=diameter, drill=drill, layers=tuple(layers), locked=locked,
                        uuid=uuid or _uuid()))


def zone(net: str, layer: str, polygon, *, fills=(), name: str | None = None, keepout: bool = False):
    return dict(net=net, layer=layer, polygon=list(polygon), fills=[list(f) for f in fills], name=name,
                keepout=keepout)


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


R0603 = [pad("1", (-0.8, 0.0), (0.9, 0.8)), pad("2", (0.8, 0.0), (0.9, 0.8))]


def _flip(name: str) -> str:
    return "B." + name[2:] if name.startswith("F.") else name


def _pad_node(p: dict, net: str | None, fp_angle: float, back: bool):
    lx, ly = p["at"]
    angle = fp_angle + p["angle"]
    at = [S("at"), num(lx), num(ly)] + ([num(angle)] if angle else [])
    layers = [(_flip(n) if back else n) for n in p["layers"]]
    node = [S("pad"), p["number"], S(p["kind"]), S(p["shape"]), at, [S("size"), num(p["size"][0]), num(p["size"][1])]]
    if p["drill"] is not None:
        node.append([S("drill"), num(p["drill"])])
    node.append([S("layers"), *layers])
    if p["shape"] == "roundrect":
        node.append([S("roundrect_rratio"), num(0.25)])
    if net:
        node.append([S("net"), net])
    node.append([S("uuid"), _uuid()])
    return node


def _footprint(f: dict):
    x, y, rot = (list(f["at"]) + [0.0])[:3]
    X, Y = to_kicad(x, y)
    at = [S("at"), num(X), num(Y)] + ([num(rot)] if rot else [])
    node = [S("footprint"), f["lib"], [S("layer"), "B.Cu" if f["back"] else "F.Cu"], [S("uuid"), f["uuid"] or _uuid()],
            at, [S("property"), "Reference", f["ref"], [S("at"), 0, -1.5, 0], [S("layer"), "F.SilkS"],
                 [S("uuid"), _uuid()]]]
    if f["value"]:
        node.append([S("property"), "Value", f["value"], [S("at"), 0, 1.5, 0], [S("layer"), "F.Fab"],
                     [S("uuid"), _uuid()]])
    if f["silk"]:
        node.append([S("fp_text"), S("user"), f["silk"], [S("at"), 0, 2.5, 0], [S("layer"), "F.SilkS"],
                     [S("uuid"), _uuid()]])
    for p in f["pads"]:
        node.append(_pad_node(p, f["nets"].get(p["number"], p["net"]), rot, f["back"]))
    return node


def _copper(kind: str, d: dict):
    if kind == "segment":
        n = [S("segment"), [S("start"), *_xy(d["a"])], [S("end"), *_xy(d["b"])], [S("width"), num(d["width"])]]
    elif kind == "arc":
        n = [S("arc"), [S("start"), *_xy(d["start"])], [S("mid"), *_xy(d["mid"])], [S("end"), *_xy(d["end"])],
             [S("width"), num(d["width"])]]
    else:
        n = [S("via"), [S("at"), *_xy(d["at"])], [S("size"), num(d["diameter"])], [S("drill"), num(d["drill"])],
             [S("layers"), *d["layers"]]]
    if d["locked"]:
        n.append([S("locked"), S("yes")])
    if kind != "via":
        n.append([S("layer"), d["layer"]])
    n += [[S("net"), d["net"]], [S("uuid"), d["uuid"]]]
    return n


def _pts(poly):
    return [S("pts"), *[[S("xy"), *_xy(p)] for p in poly]]


def _zone(k: int, z: dict):
    name = z["name"] or (f"keepout:{k}" if z["keepout"] else f"{z['net']}_{z['layer']}")
    node = [S("zone")]
    if not z["keepout"]:
        node.append([S("net"), z["net"]])
    node += [[S("layer"), z["layer"]], [S("uuid"), _uuid()], [S("name"), name]]
    if z["keepout"]:
        node.append([S("keepout"), [S("tracks"), S("not_allowed")], [S("vias"), S("not_allowed")],
                     [S("pads"), S("allowed")], [S("copperpour"), S("allowed")], [S("footprints"), S("allowed")]])
    node.append([S("polygon"), _pts(z["polygon"])])
    for f in z["fills"]:
        node.append([S("filled_polygon"), [S("layer"), z["layer"]], _pts(f)])
    return node


def board(footprints=(), tracks=(), vias=(), zones=(), *, layers: int = 2, outline=(-20.0, -15.0, 20.0, 15.0)) -> str:
    cu = ["F.Cu", *[f"In{k}.Cu" for k in range(1, layers - 1)], "B.Cu"]
    ids = [0, *[2 + 2 * k for k in range(1, layers - 1)], 2]
    root = [S("kicad_pcb"), [S("version"), 20260206], [S("generator"), "pino-test"],
            [S("general"), [S("thickness"), num(1.6)]],
            [S("layers"), *[[i, n, S("signal")] for i, n in zip(ids, cu)], [25, "Edge.Cuts", S("user")],
             [39, "User.1", S("user")]]]
    root += [_footprint(f) for f in footprints]
    x0, y0, x1, y1 = outline
    root.append([S("gr_rect"), [S("start"), *_xy((x0, y1))], [S("end"), *_xy((x1, y0))],
                 [S("stroke"), [S("width"), num(0.05)], [S("type"), S("default")]], [S("fill"), S("no")],
                 [S("layer"), "Edge.Cuts"], [S("uuid"), _uuid()]])
    root += [_copper(k, d) for k, d in list(tracks) + list(vias)]
    root += [_zone(k, z) for k, z in enumerate(zones)]
    root.append([S("embedded_fonts"), S("no")])
    return dump(root) + "\n"


def two_net_board(folder: Path) -> Path:
    """Two resistors joined by nets A and B, written to folder/board.kicad_pcb."""
    text = board(footprints=[fp("R1", (-5, 0, 0), R0603, nets={"1": "A", "2": "B"}),
                             fp("R2", (5, 0, 0), R0603, nets={"1": "A", "2": "B"})])
    path = Path(folder) / "board.kicad_pcb"
    path.write_text(text, encoding="utf-8")
    return path


def _qfn(n_side: int, pitch: float, pad_w: float = 0.25, pad_l: float = 0.8, body: float = 5.0):
    """A QFN: n_side pads per side at `pitch`, numbered counter-clockwise from the top of the left side, plus an EP."""
    pads, k = [], 1
    span = (n_side - 1) * pitch
    e = body / 2 - pad_l / 2 + 0.1
    for side in ("left", "bottom", "right", "top"):
        for i in range(n_side):
            o = -span / 2 + i * pitch
            if side == "left":
                pads.append(pad(str(k), (-e, o), (pad_l, pad_w)))
            elif side == "bottom":
                pads.append(pad(str(k), (o, e), (pad_w, pad_l)))
            elif side == "right":
                pads.append(pad(str(k), (e, -o), (pad_l, pad_w)))
            else:
                pads.append(pad(str(k), (-o, -e), (pad_w, pad_l)))
            k += 1
    pads.append(pad(str(k), (0, 0), (3.0, 3.0), shape="rect"))
    return pads


QFN32_05 = _qfn(8, 0.5)
QFN56_04 = _qfn(14, 0.4, pad_w=0.2, body=7.0)
USB_C16 = [pad(f"A{i}" if i <= 8 else f"B{i - 8}", (-3.75 + 0.5 * (i - 1), -3.0), (0.3, 1.0)) for i in range(1, 17)] + [
    pad("S1", (-4.3, -2.5), (1.0, 1.6), shape="oval", kind="thru_hole", layers=("*.Cu", "*.Mask"), drill=0.6),
    pad("S2", (4.3, -2.5), (1.0, 1.6), shape="oval", kind="thru_hole", layers=("*.Cu", "*.Mask"), drill=0.6)]
SOT23_3 = [pad("1", (-0.95, 1.1), (0.6, 0.9)), pad("2", (0.95, 1.1), (0.6, 0.9)), pad("3", (0, -1.1), (0.6, 0.9))]
ESP32_MODULE = ([pad(str(i + 1), (-8.75, -5.26 + 1.27 * i), (1.5, 0.9)) for i in range(14)]
                + [pad(str(15 + i), (-5.7 + 1.27 * i, 9.0), (0.9, 1.5)) for i in range(10)]
                + [pad(str(25 + i), (8.75, 11.25 - 1.27 * i), (1.5, 0.9)) for i in range(14)])
MOUNTING_HOLE = [pad("", (0, 0), (3.2, 3.2), shape="circle", kind="np_thru_hole", layers=("*.Cu", "*.Mask"),
                     drill=3.2)]


def mounting_holes(x: float = 24.5, y: float = 18.5):
    return [fp(f"H{i + 1}", (sx * x, sy * y, 0), MOUNTING_HOLE, lib="MountingHole")
            for i, (sx, sy) in enumerate(((-1, 1), (1, 1), (-1, -1), (1, -1)))]
