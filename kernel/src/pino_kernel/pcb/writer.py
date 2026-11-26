"""Circuit + placement -> .kicad_pcb, .kicad_pro and .kicad_dru (KiCad 10, file version 20260206).

The board is written in KiCad's own save order (footprints front then back, each by UUID;
board drawings by layer, start, end, UUID), so a KiCad refill-and-save only adds zone fill.
"""

from __future__ import annotations

from dataclasses import dataclass

from .. import ids
from ..circuit import Circuit, Keepout, Placement
from ..coords import to_kicad
from ..fab import PROFILES, FabProfile, for_layers
from ..outline import polygon as outline_polygon
from ..sexpr import Sym, dump, find, num, parse
from .footprint import FootprintLibrary, Placed, place
from .rules import kicad_dru, kicad_pro
from .stackup import stackup

VERSION = 20260206

# KiCad 10 default plot settings, written so a KiCad re-save does not add them.
_PLOT = parse("""(pcbplotparams (layerselection 0x00000000_00000000_55555555_5755f5ff)
 (plot_on_all_layers_selection 0x00000000_00000000_00000000_00000000) (disableapertmacros no)
 (usegerberextensions no) (usegerberattributes yes) (usegerberadvancedattributes yes) (creategerberjobfile yes)
 (dashed_line_dash_ratio 12) (dashed_line_gap_ratio 3) (svgprecision 4) (plotframeref no) (mode 1)
 (useauxorigin no) (pdf_front_fp_property_popups yes) (pdf_back_fp_property_popups yes) (pdf_metadata yes)
 (pdf_single_document no) (dxfpolygonmode yes) (dxfimperialunits yes) (dxfusepcbnewfont yes) (psnegative no)
 (psa4output no) (plot_black_and_white yes) (sketchpadsonfab no) (plotpadnumbers no) (hidednponfab no)
 (sketchdnponfab yes) (crossoutdnponfab yes) (subtractmaskfromsilk no) (outputformat 1) (mirror no)
 (drillshape 1) (scaleselection 1) (outputdirectory ""))""")

_USER_LAYERS = [
    (9, "F.Adhes", "user", "F.Adhesive"), (11, "B.Adhes", "user", "B.Adhesive"),
    (13, "F.Paste", "user", None), (15, "B.Paste", "user", None),
    (5, "F.SilkS", "user", "F.Silkscreen"), (7, "B.SilkS", "user", "B.Silkscreen"),
    (1, "F.Mask", "user", None), (3, "B.Mask", "user", None),
    (17, "Dwgs.User", "user", "User.Drawings"), (19, "Cmts.User", "user", "User.Comments"),
    (21, "Eco1.User", "user", "User.Eco1"), (23, "Eco2.User", "user", "User.Eco2"),
    (25, "Edge.Cuts", "user", None), (27, "Margin", "user", None),
    (31, "F.CrtYd", "user", "F.Courtyard"), (29, "B.CrtYd", "user", "B.Courtyard"),
    (35, "F.Fab", "user", None), (33, "B.Fab", "user", None),
    (39, "User.1", "user", None), (41, "User.2", "user", None),
    (43, "User.3", "user", None), (45, "User.4", "user", None),
]

EDGE_STROKE = 0.05


@dataclass
class BoardFiles:
    kicad_pcb: str
    kicad_pro: str
    kicad_dru: str
    placed: list[Placed]


def copper_layers(n: int) -> list[tuple[int, str]]:
    """KiCad 9+ layer ids: F.Cu 0, B.Cu 2, In<k>.Cu 2 + 2k."""
    inner = [(2 + 2 * k, f"In{k}.Cu") for k in range(1, n - 1)]
    return [(0, "F.Cu")] + inner + [(2, "B.Cu")]


def unconnected_net(ref: str, pin_name: str, number: str) -> str:
    """The net KiCad gives a pin marked no-connect, so the board's pads match the schematic."""
    shown = "" if pin_name in ("", "~") else f"{pin_name}-"
    return f"unconnected-({ref}-{shown}Pad{number})"


def fab_of(circuit: Circuit) -> FabProfile:
    return PROFILES.get(circuit.fab) or for_layers(circuit.layers)


def placed_parts(circuit: Circuit, placement: Placement, footprints: FootprintLibrary) -> list[Placed]:
    out = []
    for part in circuit.parts:
        pose = placement[part.ref]
        nets = {}
        open_pins = {p.number for p in circuit.no_connects if p.ref == part.ref}
        for pin in part.pins:
            net = circuit.net_of(part.ref, pin.number)
            if net is not None:
                nets[pin.number] = net.name
            elif pin.number in open_pins:
                nets[pin.number] = unconnected_net(part.ref, pin.name, pin.number)
        out.append(Placed(part.ref, part.key, footprints.load(part.footprint), float(pose.x), float(pose.y),
                          float(pose.rot), bool(pose.back), part.value, nets, part.dnp, part.lcsc,
                          part.datasheet, part.description))
    return out


def _effects():
    S = Sym
    return [S("effects"), [S("font"), [S("size"), num(1), num(1)], [S("thickness"), num(0.15)]]]


def _hole(h) -> list:
    S = Sym
    key = f"hole:{h.name}"
    X, Y = to_kicad(h.x, h.y)
    r = h.courtyard / 2

    def prop(name, value, y, layer, uid_part):
        return [S("property"), name, value, [S("at"), num(0), num(y), num(0)], [S("layer"), layer],
                [S("hide"), S("yes")], [S("uuid"), ids.uid(key, "prop", uid_part)], _effects()]

    def ring(layer):
        return [S("fp_circle"), [S("center"), num(X), num(Y)], [S("end"), num(X + r), num(Y)],
                [S("stroke"), [S("width"), num(0.05)], [S("type"), S("solid")]], [S("fill"), S("no")],
                [S("layer"), layer], [S("uuid"), ids.uid(key, "courtyard", layer)]]

    # no library nickname: KiCad's library check skips it, as it does for footprints made on the board
    return [S("footprint"), "MountingHole", [S("layer"), "F.Cu"], [S("uuid"), ids.uid(key)],
            [S("at"), num(X), num(Y)],
            prop("Reference", h.name, -r - 1, "F.SilkS", "ref"),
            prop("Value", f"MountingHole_{num(h.drill)}mm", r + 1, "F.Fab", "value"),
            prop("Datasheet", "", 0, "F.Fab", "datasheet"), prop("Description", "", 0, "F.Fab", "description"),
            [S("attr"), S("board_only"), S("exclude_from_pos_files"), S("exclude_from_bom")],
            [S("duplicate_pad_numbers_are_jumpers"), S("no")],
            ring("B.CrtYd"), ring("F.CrtYd"),
            [S("pad"), "", S("np_thru_hole"), S("circle"), [S("at"), num(0), num(0)],
             [S("size"), num(h.drill), num(h.drill)], [S("drill"), num(h.drill)], [S("layers"), "*.Cu", "*.Mask"],
             [S("uuid"), ids.uid(key, "pad")]],
            [S("embedded_fonts"), S("no")]]


def _drawing_key(item):
    """Board drawings: KiCad saves them by layer, then start point, then end point, then uuid."""
    st, en = find(item, "start"), find(item, "end")
    return (find(item, "layer")[1], float(st[1]), float(st[2]), float(en[1]), float(en[2]), find(item, "uuid")[1])


def _outline(circuit: Circuit) -> list:
    S = Sym
    stroke = [S("stroke"), [S("width"), num(EDGE_STROKE)], [S("type"), S("default")]]
    items = []

    def pt(name, p):
        X, Y = to_kicad(*p)
        return [S(name), num(X), num(Y)]

    for i, seg in enumerate(circuit.outline.segments):
        if seg[0] == "line":
            items.append([S("gr_line"), pt("start", seg[1]), pt("end", seg[2]), stroke, [S("layer"), "Edge.Cuts"],
                          [S("uuid"), ids.uid("edge", "line", str(i))]])
        else:
            start, mid, end = (to_kicad(*q) for q in seg[1:4])
            # KiCad keeps arcs turning one way in its frame (y down) and swaps the ends of any other
            cross = (mid[0] - start[0]) * (end[1] - mid[1]) - (mid[1] - start[1]) * (end[0] - mid[0])
            if cross < 0:
                start, end = end, start
            items.append([S("gr_arc"), [S("start"), num(start[0]), num(start[1])], [S("mid"), num(mid[0]), num(mid[1])],
                          [S("end"), num(end[0]), num(end[1])], stroke,
                          [S("layer"), "Edge.Cuts"], [S("uuid"), ids.uid("edge", "arc", str(i))]])
    return sorted(items, key=_drawing_key)


def _pts(poly) -> list:
    S = Sym
    return [S("pts"), *[[S("xy"), num(X), num(Y)] for X, Y in (to_kicad(*p) for p in poly)]]


def _zone_layers(names: list[str]) -> list:
    S = Sym
    return [S("layers"), *names] if len(names) > 1 else [S("layer"), names[0]]


def _fill_zone(k: int, net: str, layer: str, poly) -> list:
    S = Sym
    return [S("zone"), [S("net"), net], [S("layer"), layer], [S("uuid"), ids.uid("zone", str(k))],
            [S("name"), f"{net}_{layer}"],
            [S("hatch"), S("edge"), num(0.5)], [S("connect_pads"), [S("clearance"), num(0.3)]],
            [S("min_thickness"), num(0.25)],
            [S("fill"), [S("thermal_gap"), num(0.5)], [S("thermal_bridge_width"), num(0.5)],
             [S("island_removal_mode"), 0]],
            [S("polygon"), _pts(poly)]]


FORBID_ORDER = ("tracks", "vias", "pads", "copperpour", "footprints")


def _keepout_zone(k: int, ko: Keepout, layers: list[str]) -> list:
    S = Sym
    names = layers if ko.layers == ["*.Cu"] else [n for n in layers if n in ko.layers]
    name = f"keepout:{ko.why or k + 1}"
    return [S("zone"), _zone_layers(names), [S("uuid"), ids.uid("keepout", ko.source, str(k))], [S("name"), name],
            [S("hatch"), S("full"), num(0.5)], [S("connect_pads"), [S("clearance"), num(0)]],
            [S("min_thickness"), num(0.25)],
            [S("keepout"), *[[S(f), S("not_allowed" if f in ko.forbid else "allowed")] for f in FORBID_ORDER]],
            [S("placement"), [S("enabled"), S("no")], [S("sheetname"), ""]],
            [S("fill"), [S("thermal_gap"), num(0.5)], [S("thermal_bridge_width"), num(0.5)],
             [S("island_removal_mode"), 0]],
            [S("polygon"), _pts(ko.polygon)]]


def _setup(circuit: Circuit, fab: FabProfile) -> list:
    S = Sym
    y, n = S("yes"), S("no")
    return [S("setup"), stackup(circuit.layers, fab), [S("pad_to_mask_clearance"), 0],
            [S("allow_soldermask_bridges_in_footprints"), n],
            [S("tenting"), [S("front"), y], [S("back"), y]],
            [S("covering"), [S("front"), n], [S("back"), n]],
            [S("plugging"), [S("front"), n], [S("back"), n]],
            [S("capping"), n], [S("filling"), n], _PLOT]


def write_board(circuit: Circuit, placement: Placement, footprints: FootprintLibrary) -> BoardFiles:
    S = Sym
    fab = fab_of(circuit)
    cu = copper_layers(circuit.layers)
    cu_names = [name for _, name in cu]
    placed = placed_parts(circuit, placement, footprints)

    fps = [(p.back, ids.footprint_uuid(p.key), place(p, copper_layers=cu_names)) for p in placed]
    fps += [(False, ids.uid(f"hole:{h.name}"), _hole(h)) for h in circuit.outline.holes]
    fps.sort(key=lambda t: (t[0], t[1]))

    root = [S("kicad_pcb"), [S("version"), VERSION], [S("generator"), "pino"], [S("generator_version"), "10.0"],
            [S("general"), [S("thickness"), num(fab.board_thickness)], [S("legacy_teardrops"), S("no")]],
            [S("paper"), "A4"], [S("title_block"), [S("title"), circuit.name]]]
    lay = [S("layers")]
    for i, name in cu:
        lay.append([i, name, S("signal")])
    for i, name, kind, user in _USER_LAYERS:
        lay.append([i, name, S(kind)] + ([user] if user else []))
    root.append(lay)
    root.append(_setup(circuit, fab))
    root += [fp for _, _, fp in fps]
    root += _outline(circuit)
    board_poly = outline_polygon(circuit.outline)
    for k, z in enumerate(circuit.zones):
        root.append(_fill_zone(k, z.net, z.layer, z.polygon or board_poly))
    for k, ko in enumerate(circuit.keepouts):
        root.append(_keepout_zone(k, ko, cu_names))
    root.append([S("embedded_fonts"), S("no")])
    return BoardFiles(dump(root) + "\n", kicad_pro(circuit, fab), kicad_dru(fab), placed)
