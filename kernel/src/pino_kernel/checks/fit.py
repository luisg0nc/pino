"""Does every part fit: inside the outline, pads clear of the edge, out of keep-outs and off the holes."""

from __future__ import annotations

from ..circuit import Circuit
from ..fab import FabProfile
from ..findings import At, Finding
from ..geometry import bbox, circle_polygon, clip_half_plane, distance_to_edges, inside, point_in_polygon, polygons_overlap
from ..outline import polygon as outline_polygon
from ..pcb.footprint import FACE_AXIS, Placed, courtyard_world, face_line, keepouts_world, pad_world

DIRECTION = {"right": 0, "top": 90, "left": 180, "bottom": 270}
NAMES = {v: k for k, v in DIRECTION.items()}


def world_face(p: Placed) -> str:
    """Which way the part's mating face points on the board (board frame, y up)."""
    a = DIRECTION[p.footprint.edge_face]
    if p.back and p.footprint.edge_face in ("top", "bottom"):
        a = DIRECTION["bottom" if p.footprint.edge_face == "top" else "top"]
    return NAMES[int(round(a + p.rot)) % 360 // 90 * 90]


def _board_side(p: Placed, polys, face):
    """The courtyards with what may cross the edge on the face side taken off: everything past a footprint's own
    face-side keep-out (an antenna clearance), else up to half the courtyard's depth (a connector's overhang)."""
    axis, sign = FACE_AXIS[face]
    i = 0 if axis == "x" else 1
    line, _, by_keepout = face_line(polys, keepouts_world(p), [q.poly for q in pad_world(p)], face)
    if not by_keepout:
        lo, hi = min(q[i] for poly in polys for q in poly), max(q[i] for poly in polys for q in poly)
        line = (lo + hi) / 2
    out = []
    for poly in polys:
        kept = clip_half_plane(poly, axis, line - sign * 0.05, "below" if sign > 0 else "above")
        if len(kept) >= 3:
            out.append(kept)
    return out


def fit_findings(circuit: Circuit, placed: list[Placed], fab: FabProfile) -> list[Finding]:
    outline = outline_polygon(circuit.outline, chord=0.2)
    edge_parts = {i.target for i in circuit.intents if i.edge is not None}
    groups = {g.name: g.refs for g in circuit.groups}
    for i in circuit.intents:
        if i.edge is not None and i.target.startswith("group:"):
            edge_parts.update(groups.get(i.target[6:], []))
    keepouts = [(k, k.polygon) for k in circuit.keepouts]
    holes = [(h, circle_polygon(h.x, h.y, h.courtyard / 2, 24)) for h in circuit.outline.holes]
    out = []
    for p in placed:
        at = At("board", p.x, p.y, "B.Cu" if p.back else "F.Cu")
        polys = [q for v in courtyard_world(p).values() for q in v]
        face = world_face(p) if p.ref in edge_parts else None
        tested = polys if face is None else _board_side(p, polys, face)
        outside = any(not inside(q, outline) for q in tested)
        if outside:
            where = "past the outline" if face is None else f"past the outline on a side other than its {face} face"
            out.append(Finding("fit", "outside_outline", "error", f"{p.ref} is {where}", at, (p.ref,)))
        else:
            near = None
            for pad in pad_world(p):
                for pt in [(pad.x, pad.y), *pad.poly]:
                    if not point_in_polygon(pt, outline):
                        near = (pad, 0.0)
                        break
                    d = distance_to_edges(pt, outline)
                    if d < fab.copper_to_edge - 1e-6 and (near is None or d < near[1]):
                        near = (pad, d)
                if near and near[1] == 0.0:
                    break
            if near:
                pad, d = near
                out.append(Finding("fit", "pad_near_edge", "error",
                                   f"{p.ref} pad {pad.number} copper is {d:.2f} mm from the board edge; "
                                   f"the fab needs {fab.copper_to_edge} mm",
                                   At("board", pad.x, pad.y, pad.layers[0] if pad.layers else None), (p.ref,),
                                   (f"{p.ref}.{pad.number}",)))
        for k, poly in keepouts:
            forbid_fp = "footprints" in k.forbid and any(polygons_overlap(q, poly) for q in polys)
            forbid_pad = "pads" in k.forbid and any(point_in_polygon((pad.x, pad.y), poly) for pad in pad_world(p))
            if forbid_fp or forbid_pad:
                why = f" ({k.why})" if k.why else ""
                out.append(Finding("fit", "in_keepout", "error", f"{p.ref} is in a keep-out{why} from {k.source}",
                                   at, (p.ref,)))
                break
        for h, poly in holes:
            if any(polygons_overlap(q, poly) for q in polys):
                out.append(Finding("fit", "on_hole", "error", f"{p.ref} sits on mounting hole {h.name}", at, (p.ref,)))
                break
    return out
