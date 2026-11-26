"""Canvas -> .kicad_sch, with deterministic UUIDs and ordering, plus the project's library tables.

Nodes are built in the spike's convention (bare atoms as plain str, quoted strings as Q) and
converted to pino's (`Sym` bare, `str` quoted) just before printing. Library symbols are
already in pino's convention and go in after the conversion.
"""

from __future__ import annotations

from dataclasses import dataclass

from .. import ids
from ..circuit import Circuit
from ..sexpr import Sym as S
from ..sexpr import dump
from ..symbols import GRID, SymbolLibrary
from .canvas import Canvas, Text
from .layout import Model, layout_sheet

KICAD_SCH_VERSION = "20260306"
PROJECT = "board"


class DrawingError(Exception):
    pass


class Q(str):
    """A quoted string atom (spike convention, converted before printing)."""


def _convert(node):
    if isinstance(node, list):
        return [_convert(c) for c in node]
    if isinstance(node, Q):
        return str(node)
    if isinstance(node, S):
        return node
    return S(str(node))


def uid(*key) -> Q:
    return Q(ids.uid("sch", *map(str, key)))


def mm(u) -> str:
    text = f"{u * GRID:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def at(x, y, angle=None):
    return ["at", mm(x), mm(y)] + ([] if angle is None else [str(angle)])


@dataclass
class SchematicFiles:
    kicad_sch: str
    sym_lib_table: str
    fp_lib_table: str
    canvas: Canvas
    paper: str


# --- connectivity -------------------------------------------------------------


def on_segment(p, a, b):
    if a[0] == b[0] == p[0]:
        return min(a[1], b[1]) <= p[1] <= max(a[1], b[1])
    if a[1] == b[1] == p[1]:
        return min(a[0], b[0]) <= p[0] <= max(a[0], b[0])
    return False


def connect(cv: Canvas):
    """Split wires where things meet, place junctions, and refuse drawings that would short nets."""
    points: dict = {}
    for p in cv.pins:
        if p.net:
            points.setdefault((p.x, p.y), set()).add(p.net)
    for lab in cv.labels:
        points.setdefault((lab.x, lab.y), set()).add(lab.net)
    for w in cv.wires:
        for end in (w.a, w.b):
            points.setdefault(end, set()).add(w.net)
    problems = [f"nets {sorted(n)} meet at {p}" for p, n in points.items() if len(n) > 1]
    for x, y, key in cv.ncs:
        if (x, y) in points:
            problems.append(f"no-connect {key} is touched by {sorted(points[(x, y)])}")

    segments: dict = {}
    for w in cv.wires:
        cuts = []
        for p, nets in points.items():
            if on_segment(p, w.a, w.b):
                if w.net not in nets:
                    problems.append(f"wire of {w.net} {w.a}-{w.b} runs through {sorted(nets)} at {p}")
                cuts.append(p)
        cuts.sort()
        for a, b in zip(cuts, cuts[1:]):
            segments[(a, b)] = w.net  # overlapping collinear pieces collapse here
    if problems:
        raise DrawingError("\n".join(sorted(set(problems))))

    degree: dict = {}
    for a, b in segments:
        degree[a] = degree.get(a, 0) + 1
        degree[b] = degree.get(b, 0) + 1
    pin_points = {(p.x, p.y) for p in cv.pins if p.net}
    junctions = sorted(p for p, d in degree.items() if d + (p in pin_points) >= 3)
    return sorted((a, b, net) for (a, b), net in segments.items()), junctions


# --- s-expression pieces ------------------------------------------------------


def font(size="1.27", justify=None, bold=False):
    f = ["font", ["size", size, size]] + ([["bold", "yes"]] if bold else [])
    return ["effects", f] + ([["justify", *justify]] if justify else [])


def prop(name, value, text: Text, symbol_rot=0, mirror=None, hidden=None):
    """A symbol field. KiCad turns field text with its symbol, so undo that to keep it level."""
    angle = 90 if symbol_rot in (90, 270) else 0
    justify = text.justify
    # measured by the spike's probe: KiCad swaps left and right at 90 and 180, and mirror y swaps again
    if (symbol_rot in (90, 180)) != (mirror == "y") and justify != "center":
        justify = "left" if justify == "right" else "right"
    node = ["property", Q(name), Q(value), at(text.x, text.y, angle)]
    if text.hidden if hidden is None else hidden:
        node.append(["hide", "yes"])
    node += [["show_name", "no"], ["do_not_autoplace", "no"]]
    node.append(font(justify=None if justify == "center" else [justify]))
    return node


def symbol_node(symbols: SymbolLibrary, item):
    part = item.part
    value = part.value if part else item.value_text.value
    node = ["symbol", ["lib_id", Q(item.lib_id)], at(item.x, item.y, item.rot)]
    if item.mirror:
        node.append(["mirror", item.mirror])
    symbol_uuid = ids.symbol_uuid(part.key) if part else ids.uid("sch", "symbol", item.key)
    node += [
        ["unit", "1"], ["body_style", "1"], ["exclude_from_sim", "no"],
        ["in_bom", "yes"], ["on_board", "yes"], ["in_pos_files", "yes"],
        ["dnp", "yes" if part and part.dnp else "no"],
        ["uuid", Q(symbol_uuid)],
    ]
    pose = dict(symbol_rot=item.rot, mirror=item.mirror)
    node.append(prop("Reference", item.ref, item.ref_text, **pose))
    node.append(prop("Value", value, item.value_text, **pose))
    here = Text("", item.x, item.y)
    sym = symbols.load(item.lib_id)
    node.append(prop("Footprint", part.footprint if part else "", here, hidden=True, **pose))
    node.append(prop("Datasheet", sym.properties.get("Datasheet", ""), here, hidden=True, **pose))
    node.append(prop("Description", sym.properties.get("Description", ""), here, hidden=True, **pose))
    if part:
        node.append(prop("LCSC", part.lcsc, here, hidden=True, **pose))
    for number in sorted(p.number for p in sym.pins):
        pin_uuid = ids.uid("pin", part.key, number) if part else ids.uid("sch", "pin", item.key, number)
        node.append(["pin", Q(number), ["uuid", Q(pin_uuid)]])
    node.append([
        "instances",
        ["project", Q(PROJECT), ["path", Q("/" + ids.sheet_uuid()), ["reference", Q(item.ref)], ["unit", "1"]]],
    ])
    return node


LABEL_POSE = {"R": (0, "left"), "L": (180, "right"), "U": (90, "left"), "D": (270, "right")}


def label_node(lab):
    angle, justify = LABEL_POSE[lab.out]
    kind = "global_label" if lab.is_global else "label"
    node = [kind, Q(lab.net)]
    if lab.is_global:
        node.append(["shape", "passive"])
    node.append(at(lab.x, lab.y, angle))
    node.append(font(justify=[justify] if lab.is_global else [justify, "bottom"]))
    node.append(["uuid", uid("label", lab.net, lab.key)])
    return node


def schematic(model: Model, symbols: SymbolLibrary, cv: Canvas, paper: str) -> str:
    # Power references are numbered by identity, so adding a part does not renumber the rest at random.
    for prefix in ("#PWR", "#FLG"):
        for i, item in enumerate(sorted((s for s in cv.syms if s.ref.startswith(prefix) and s.part is None),
                                        key=lambda s: s.key), 1):
            item.ref = f"{prefix}{i:02d}"
    wires, junctions = connect(cv)

    root = [
        "kicad_sch", ["version", KICAD_SCH_VERSION], ["generator", Q("pino")],
        ["generator_version", Q("10.0")], ["uuid", Q(ids.sheet_uuid())], ["paper", Q(paper)],
        ["title_block", ["title", Q(model.name)]],
    ]
    for x, y in junctions:
        root.append(["junction", at(x, y), ["diameter", "0"], ["color", "0", "0", "0", "0"],
                     ["uuid", uid("junction", x, y)]])
    for x, y, key in sorted(cv.ncs, key=lambda n: n[2]):
        root.append(["no_connect", at(x, y), ["uuid", uid("nc", key)]])
    for a, b, net in wires:
        root.append(["wire", ["pts", ["xy", mm(a[0]), mm(a[1])], ["xy", mm(b[0]), mm(b[1])]],
                     ["stroke", ["width", "0"], ["type", "default"]],
                     ["uuid", uid("wire", net, *a, *b)]])
    for frame in cv.frames:
        x0, y0, x1, y1 = frame.box
        root.append(["rectangle", ["start", mm(x0), mm(y0)], ["end", mm(x1), mm(y1)],
                     ["stroke", ["width", "0"], ["type", "dash"]], ["fill", ["type", "none"]],
                     ["uuid", uid("frame", frame.key)]])
        root.append(["text", Q(frame.title), ["exclude_from_sim", "no"], at(x0 + 1.5, y0 + 2, 0),
                     font("2", ["left"], bold=True), ["uuid", uid("title", frame.key)]])
    for lab in sorted(cv.labels, key=lambda l: (l.net, l.key)):
        root.append(label_node(lab))
    for item in sorted(cv.syms, key=lambda s: s.ref):
        root.append(symbol_node(symbols, item))
    root.append(["sheet_instances", ["path", Q("/"), ["page", Q("1")]]])
    root.append(["embedded_fonts", "no"])

    out = _convert(root)
    lib_symbols = [S("lib_symbols"), *[symbols.load(i).node for i in sorted({s.lib_id for s in cv.syms})]]
    out.insert(7, lib_symbols)

    seen: dict = {}
    for node in _walk(out[:7] + out[8:]):
        if node[0] == "uuid":
            seen[node[1]] = seen.get(node[1], 0) + 1
    repeated = sorted(u for u, n in seen.items() if n > 1)
    if repeated:
        raise DrawingError(f"UUID used twice: {repeated}")
    return dump(out) + "\n"


def _walk(node):
    yield node
    for c in node:
        if isinstance(c, list) and c:
            yield from _walk(c)


def lib_tables(circuit: Circuit, cv: Canvas) -> tuple[str, str]:
    """The sym-lib-table and fp-lib-table that let kicad-cli resolve the libraries."""
    libs = sorted({s.lib_id.split(":")[0] for s in cv.syms} | {p.symbol.split(":")[0] for p in circuit.parts})
    table = ["sym_lib_table", ["version", "7"]]
    for lib in libs:
        table.append(["lib", ["name", Q(lib)], ["type", Q("KiCad")],
                      ["uri", Q("${KICAD10_SYMBOL_DIR}/" + lib + ".kicad_sym")],
                      ["options", Q("")], ["descr", Q("")]])
    footprint_libs = sorted({p.footprint.split(":")[0] for p in circuit.parts if p.footprint})
    footprints = ["fp_lib_table", ["version", "7"]]
    for lib in footprint_libs:
        footprints.append(["lib", ["name", Q(lib)], ["type", Q("KiCad")],
                           ["uri", Q("${KICAD10_FOOTPRINT_DIR}/" + lib + ".pretty")],
                           ["options", Q("")], ["descr", Q("")]])
    return dump(_convert(table)) + "\n", dump(_convert(footprints)) + "\n"


def write_schematic(circuit: Circuit, symbols: SymbolLibrary) -> SchematicFiles:
    cv, paper = layout_sheet(circuit, symbols)
    model = Model(circuit, symbols)
    # the canvas's parts belong to the layout's own model; the writer only reads their fields
    text = schematic(model, symbols, cv, paper)
    sym_table, fp_table = lib_tables(circuit, cv)
    return SchematicFiles(text, sym_table, fp_table, cv, paper)


def symbol_boxes(canvas: Canvas) -> list[dict]:
    """Each part's body box and pin points in sheet mm, for the views' hit-test layer."""
    out = []
    for s in sorted((s for s in canvas.syms if s.part is not None), key=lambda s: s.ref):
        x0, y0, x1, y1 = s.body
        pins = sorted((p for p in canvas.pins if p.ref == s.ref), key=lambda p: p.number)
        out.append({"ref": s.ref, "x0": round(x0 * GRID, 4), "y0": round(y0 * GRID, 4),
                    "x1": round(x1 * GRID, 4), "y1": round(y1 * GRID, 4),
                    "pins": [{"number": p.number, "x": round(p.x * GRID, 4), "y": round(p.y * GRID, 4)} for p in pins]})
    return out
