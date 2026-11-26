"""JLC's two assembly files, from the written board and the circuit.

BOM columns: Comment, Designator, Footprint, JLCPCB Part #, Quantity ("LCSC" as a header makes JLC ignore the
numbers). CPL columns: Designator, Val, Package, Mid X, Mid Y, Rotation, Layer. Positions are millimetres from the
board's drill and place origin, which pino puts at the outline's centre, y up: the frame of the Gerbers too.
"""

from __future__ import annotations

import csv
import io
import math
from dataclasses import dataclass
from typing import Sequence

from ..checks.parts import assembled, lcsc_of
from ..circuit import Circuit
from ..coords import from_kicad
from ..pcb.footprint import norm_angle, rotate
from ..sexpr import find, find_all, parse
from ..symbols import natural
from .rotations import Rule, cpl_angle, cpl_offset, rule_for

__all__ = ["BOM_HEADER", "CPL_HEADER", "DESIGNATOR_MAX", "BoardPart", "BomRow", "CplRow", "assembled", "board_parts",
           "bom_rows", "cpl_rows", "write_bom", "write_cpl"]

BOM_HEADER = ["Comment", "Designator", "Footprint", "JLCPCB Part #", "Quantity"]
CPL_HEADER = ["Designator", "Val", "Package", "Mid X", "Mid Y", "Rotation", "Layer"]
DESIGNATOR_MAX = 2000  # characters of one BOM row's designator list


@dataclass(frozen=True)
class BoardPart:
    ref: str
    lib_id: str
    value: str
    x: float  # board mm
    y: float
    angle: float
    back: bool
    pad_box: tuple[float, float, float, float]  # board mm, round every plated or surface pad
    attrs: tuple[str, ...]


@dataclass(frozen=True)
class CplRow:
    ref: str
    value: str
    package: str
    x: float
    y: float
    rotation: float
    layer: str  # top | bottom
    rule: str | None  # the rotation rule's pattern
    checked: str | None  # when that rule was seen right in JLC's preview
    needs_check: bool
    override: bool  # the rotation came from board.py's rotation=


@dataclass(frozen=True)
class BomRow:
    comment: str
    designators: list[str]
    footprint: str
    lcsc: str
    quantity: int


def _corners(pad, X: float, Y: float, angle: float):
    at, size = find(pad, "at"), find(pad, "size")
    px, py = float(at[1]), float(at[2])
    turn = float(at[3]) if len(at) > 3 else 0.0  # a board file stores a pad's angle on the board, not in the part
    cx, cy = rotate(px, py, angle)
    hw, hh = float(size[1]) / 2, float(size[2]) / 2
    for dx, dy in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)):
        rx, ry = rotate(dx, dy, turn)
        yield from_kicad(X + cx + rx, Y + cy + ry)


def board_parts(board_text: str) -> list[BoardPart]:
    """Every footprint with a pad, in the board frame."""
    out = []
    for node in find_all(parse(board_text), "footprint"):
        props = {str(p[1]): str(p[2]) for p in find_all(node, "property")}
        at = find(node, "at")
        X, Y = float(at[1]), float(at[2])
        angle = norm_angle(float(at[3])) if len(at) > 3 else 0.0
        points = [pt for pad in find_all(node, "pad") if str(pad[2]) != "np_thru_hole"
                  for pt in _corners(pad, X, Y, angle)]
        if not points:
            continue
        xs, ys = [p[0] for p in points], [p[1] for p in points]
        attr = find(node, "attr")
        x, y = from_kicad(X, Y)
        out.append(BoardPart(props.get("Reference", ""), str(node[1]), props.get("Value", ""), x, y, angle,
                             str(find(node, "layer")[1]) == "B.Cu", (min(xs), min(ys), max(xs), max(ys)),
                             tuple(str(a) for a in attr[1:]) if attr else ()))
    return out


def cpl_rows(parts: Sequence[BoardPart], circuit: Circuit, rules: Sequence[Rule]) -> list[CplRow]:
    """One row per assembled part with an LCSC number, at the centre of its pads, in reference order."""
    specs = {p.ref: p for p in circuit.parts}
    rows = []
    for part in parts:
        spec = specs.get(part.ref)
        if spec is None or not assembled(spec) or lcsc_of(spec) is None or "exclude_from_pos_files" in part.attrs:
            continue
        name = part.lib_id.split(":", 1)[-1]
        rule = rule_for(name, rules)
        dx, dy = cpl_offset(rule, part.angle, part.back)
        x0, y0, x1, y1 = part.pad_box
        override = spec.rotation is not None
        rows.append(CplRow(part.ref, spec.value, name, (x0 + x1) / 2 + dx, (y0 + y1) / 2 + dy,
                           cpl_angle(part.angle, part.back, rule, spec.rotation), "bottom" if part.back else "top",
                           rule.pattern if rule else None, rule.checked if rule else None,
                           override or rule is None or rule.needs_check, override))
    return sorted(rows, key=lambda r: natural(r.ref))


def bom_rows(rows: Sequence[CplRow], circuit: Circuit) -> list[BomRow]:
    """One row per LCSC number, split so that a designator list stays under DESIGNATOR_MAX characters."""
    groups: dict[str, list[CplRow]] = {}
    for row in rows:
        groups.setdefault(lcsc_of(circuit.part(row.ref)), []).append(row)
    out = []
    for lcsc, members in groups.items():
        chunk: list[CplRow] = []
        chunks = [chunk]
        length = 0
        for row in members:
            if chunk and length + 1 + len(row.ref) >= DESIGNATOR_MAX:
                chunk, length = [], 0
                chunks.append(chunk)
            length += len(row.ref) + (1 if chunk else 0)
            chunk.append(row)
        for chunk in chunks:
            out.append(BomRow(" / ".join(dict.fromkeys(r.value for r in chunk)), [r.ref for r in chunk],
                              " / ".join(dict.fromkeys(r.package for r in chunk)), lcsc, len(chunk)))
    return out


def _csv(header: list[str], lines) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(lines)
    return out.getvalue()


def _mm(v: float) -> str:
    return f"{round(v, 4) + 0.0:.4f}"


def write_bom(rows: Sequence[BomRow]) -> str:
    return _csv(BOM_HEADER, ([r.comment, ",".join(r.designators), r.footprint, r.lcsc, r.quantity] for r in rows))


def write_cpl(rows: Sequence[CplRow]) -> str:
    return _csv(CPL_HEADER, ([r.ref, r.value, r.package, _mm(r.x), _mm(r.y), f"{math.fmod(round(r.rotation, 4), 360):g}",
                              r.layer] for r in rows))
