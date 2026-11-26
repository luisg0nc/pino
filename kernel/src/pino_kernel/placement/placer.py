"""The placer: placement intent from board.py into positions, scored by the ratsnest.

Order: fixed (at) -> edge -> near (in dependency order; a loop is a finding and its parts fall to
the rest) -> groups -> satellites (2-pin parts that serve a pin of a bigger part) -> the rest, in
declaration order. Each part takes the cheapest valid candidate; a part with no valid spot takes
the cheapest invalid one and a placement_no_room finding. Then `rounds` rounds of improvement:
each non-fixed part tries its candidates with the others held, and keeps a move only if the total
ratsnest score drops.

Candidates are ordered by an incremental cost (the length and crossings of the ratsnest edges the
part would add to what is placed), then by distance to the anchor, y, x and rotation, so every run
gives the same placement. All positions are board mm, snapped to 0.05 mm.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

from ..circuit import Circuit, PartPose, Placement
from ..fab import PROFILES, for_layers
from ..findings import At, Finding
from ..geometry import bbox, clip_half_plane, distance_to_edges, inside, point_in_polygon, polygons_overlap
from ..outline import polygon as outline_polygon
from ..pcb.footprint import FACE_AXIS, FootprintLibrary, Placed, courtyard_world, face_line, keepouts_world, pad_world
from .ratsnest import WEIGHTS, EdgeIndex, PadPoint, Score, edge, score

SNAP = 0.05
MAX_CANDIDATES = 400
SIDES = ("top", "bottom", "left", "right")
DIRECTION = {"right": 0, "top": 90, "left": 180, "bottom": 270}  # board frame, counter-clockwise from +x


def snap(v: float) -> float:
    return round(round(v / SNAP) * SNAP, 6) + 0.0


@dataclass
class PlaceResult:
    placement: Placement
    score: Score
    findings: list[Finding]
    placed: list[Placed]
    seconds: float


@dataclass
class _Shape:
    """A part's courtyards, pads and keep-outs at the origin for one rotation and side, board mm."""
    sides: dict[str, list]  # "F"/"B" -> polygons
    box: tuple  # courtyard bounding box
    pads: list  # (number, x, y, side, net, poly)
    keepouts: list


@dataclass
class _Cand:
    x: float
    y: float
    rot: float
    back: bool
    anchor_dist: float = 0.0


@dataclass
class _State:
    pose: dict = field(default_factory=dict)  # ref -> PartPose


class Placer:
    def __init__(self, circuit: Circuit, footprints: FootprintLibrary):
        self.c = circuit
        self.fab = PROFILES.get(circuit.fab) or for_layers(circuit.layers)
        self.lib = footprints
        self.parts = {p.ref: p for p in circuit.parts}
        self.order = [p.ref for p in circuit.parts]
        self.fp = {p.ref: footprints.load(p.footprint) for p in circuit.parts}
        self.pad_nets = {}
        for p in circuit.parts:
            nets = {}
            for pin in p.pins:
                n = circuit.net_of(p.ref, pin.number)
                if n is not None:
                    nets[pin.number] = n.name
            self.pad_nets[p.ref] = nets
        self.planes = {n.name for n in circuit.nets if n.kind == "gnd"} | {z.net for z in circuit.zones}
        self.outline = outline_polygon(circuit.outline, chord=0.5)
        self.obox = bbox(self.outline)
        self.board_keepouts = [k.polygon for k in circuit.keepouts if "footprints" in k.forbid]
        self.hole_keepouts = [self._circle(h.x, h.y, h.courtyard / 2) for h in circuit.outline.holes]
        self._shapes: dict = {}
        self.intent = {i.target: i for i in circuit.intents}
        self.groups = {g.name: g for g in circuit.groups}
        self.group_of = {r: g.name for g in circuit.groups for r in g.refs}
        self.findings: list[Finding] = []
        self.pose: dict[str, PartPose] = {}
        self.kind: dict[str, str] = {}  # ref -> fixed | edge | near | group | satellite | rest
        self.anchor: dict[str, tuple] = {}  # ref -> what it was placed against
        self.net_points: dict[str, list] = {}  # net -> [(x, y, side, ref, number)] of placed pads
        self.index = None

    @staticmethod
    def _circle(x, y, r, n=16):
        return [(x + r * math.cos(2 * math.pi * k / n), y + r * math.sin(2 * math.pi * k / n)) for k in range(n)]

    # -- shapes ---------------------------------------------------------------------------------------

    def shape(self, ref: str, rot: float, back: bool) -> _Shape:
        key = (ref, rot, back)
        s = self._shapes.get(key)
        if s is None:
            p = Placed(ref, ref, self.fp[ref], 0.0, 0.0, rot, back, "", self.pad_nets[ref])
            sides = courtyard_world(p)
            polys = [q for v in sides.values() for q in v]
            pads = []
            for q in pad_world(p):
                side = "X" if q.through else ("B" if back else "F")
                pads.append((q.number, q.x, q.y, side, q.net, q.poly))
            if not polys:  # no courtyard: the pads' box stands in
                pts = [pt for q in pads for pt in q[5]] or [(0.0, 0.0)]
                x0, y0, x1, y1 = bbox(pts)
                polys = [[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]
                sides = {"B" if back else "F": polys}
            s = _Shape(sides, bbox([pt for q in polys for pt in q]), pads, keepouts_world(p))
            self._shapes[key] = s
        return s

    @staticmethod
    def _moved(poly, dx, dy):
        return [(x + dx, y + dy) for x, y in poly]

    # -- validity -------------------------------------------------------------------------------------

    def valid(self, ref: str, c: _Cand, face: str | None = None) -> bool:
        s = self.shape(ref, c.rot, c.back)
        x0, y0, x1, y1 = s.box[0] + c.x, s.box[1] + c.y, s.box[2] + c.x, s.box[3] + c.y
        ox0, oy0, ox1, oy1 = self.obox
        eps = 1e-6
        if face is None and (x0 < ox0 - eps or y0 < oy0 - eps or x1 > ox1 + eps or y1 > oy1 + eps):
            return False
        polys = [self._moved(q, c.x, c.y) for v in s.sides.values() for q in v]
        if face is not None:
            line, _, by_keepout = self.face_of(ref, c.rot, c.back, face)
            axis, sign = FACE_AXIS[face]
            off = (c.x if axis == "x" else c.y)
            cut = line + off - sign * (0.05 if by_keepout else 0.05 + self._pull_depth(s, axis))
        for poly in polys:
            if face is None:
                test = poly
            else:
                test = clip_half_plane(poly, axis, cut, "below" if sign > 0 else "above")
                if len(test) < 3:
                    continue
            if not inside(test, self.outline):
                return False
        for _, px, py, _, _, ppoly in s.pads:
            for pt in [(px + c.x, py + c.y)] + [(a + c.x, b + c.y) for a, b in ppoly]:
                if not point_in_polygon(pt, self.outline) or distance_to_edges(pt, self.outline) < self.fab.copper_to_edge - eps:
                    return False
        box = (x0, y0, x1, y1)
        for ko in self.board_keepouts + self.hole_keepouts:
            if _box_meet(box, bbox(ko)) and any(polygons_overlap(poly, ko) for poly in polys):
                return False
        own = [self._moved(k, c.x, c.y) for k in s.keepouts]
        for other, pose in self.pose.items():
            if other == ref:
                continue
            os_ = self.shape(other, pose.rot, pose.back)
            obox = (os_.box[0] + pose.x, os_.box[1] + pose.y, os_.box[2] + pose.x, os_.box[3] + pose.y)
            if _box_meet(box, obox):
                for side, mine in s.sides.items():
                    for theirs in os_.sides.get(side, []):
                        moved = self._moved(theirs, pose.x, pose.y)
                        if any(polygons_overlap(self._moved(q, c.x, c.y), moved) for q in mine):
                            return False
            for k in os_.keepouts:
                kk = self._moved(k, pose.x, pose.y)
                if _box_meet(box, bbox(kk)) and any(polygons_overlap(poly, kk) for poly in polys):
                    return False
            if own:
                theirs = [self._moved(q, pose.x, pose.y) for v in os_.sides.values() for q in v]
                if any(polygons_overlap(k, t) for k in own for t in theirs):
                    return False
        return True

    @staticmethod
    def _pull_depth(s: _Shape, axis: str) -> float:
        """How far an edge part's courtyard may cross on its face side: half its depth, at most 2 mm."""
        lo, hi = (s.box[0], s.box[2]) if axis == "x" else (s.box[1], s.box[3])
        return max(0.0, min(2.0, (hi - lo) / 2 - 0.05))

    def face_of(self, ref: str, rot: float, back: bool, face: str):
        s = self.shape(ref, rot, back)
        return face_line([q for v in s.sides.values() for q in v], s.keepouts, [q[5] for q in s.pads], face)

    # -- cost -----------------------------------------------------------------------------------------

    def cost(self, ref: str, c: _Cand) -> float:
        s = self.shape(ref, c.rot, c.back)
        new_edges, total = [], 0.0
        for number, px, py, side, net, _ in s.pads:
            if not net or net in self.planes:
                continue
            here = (px + c.x, py + c.y, side, ref, number)
            others = [q for q in self.net_points.get(net, ()) if q[3] != ref]
            if not others:
                continue
            best = min(others, key=lambda q: (math.hypot(q[0] - here[0], q[1] - here[1]), q[3], q[4]))
            total += math.hypot(best[0] - here[0], best[1] - here[1])
            new_edges.append(edge(net, here, best))
        crossings = self.index.count(new_edges) if self.index is not None and new_edges else 0
        return WEIGHTS["cross"] * crossings + WEIGHTS["length"] * total

    def _commit(self, ref: str, c: _Cand) -> None:
        self.pose[ref] = PartPose(c.x, c.y, float(c.rot), bool(c.back))
        self._rebuild()

    def _rebuild(self) -> None:
        self.net_points = {}
        for ref in self.order:
            pose = self.pose.get(ref)
            if pose is None:
                continue
            s = self.shape(ref, pose.rot, pose.back)
            for number, px, py, side, net, _ in s.pads:
                if net and net not in self.planes:
                    self.net_points.setdefault(net, []).append((px + pose.x, py + pose.y, side, ref, number))
        from .ratsnest import ratsnest
        nets = {n: [PadPoint(*q) for q in pts] for n, pts in self.net_points.items()}
        self.index = EdgeIndex(ratsnest(nets))

    def total(self) -> Score:
        nets: dict[str, list] = {}
        for ref in self.order:
            pose = self.pose.get(ref)
            if pose is None:
                continue
            for number, px, py, side, net, _ in self.shape(ref, pose.rot, pose.back).pads:
                if net:
                    nets.setdefault(net, []).append(PadPoint(px + pose.x, py + pose.y, side, ref, number))
        return score(nets, self.planes)

    # -- candidates -----------------------------------------------------------------------------------

    def _rots(self, rot, default=(0, 90, 180, 270)):
        return [float(rot)] if rot is not None else [float(r) for r in default]

    def edge_rot(self, ref: str, edge: str, back: bool) -> float:
        face = self.fp[ref].edge_face
        a = DIRECTION[face]
        if back and face in ("top", "bottom"):
            a = DIRECTION["bottom" if face == "top" else "top"]
        return float((DIRECTION[edge] - a) % 360)

    def edge_cands(self, ref: str, edge: str, along: float | None, rot, back: bool) -> list[_Cand]:
        r = float(rot) if rot is not None else self.edge_rot(ref, edge, back)
        s = self.shape(ref, r, back)
        ox0, oy0, ox1, oy1 = self.obox
        x0, y0, x1, y1 = s.box
        # the face line meets the edge; pads keep the fab's copper-to-edge distance
        line, reach, _ = self.face_of(ref, r, back, edge)
        axis, sign = FACE_AXIS[edge]
        shift = max(0.0, self.fab.copper_to_edge + 0.05 - sign * (line - reach))
        line += sign * shift  # the edge sits that much past the face line, so the part moves in
        out = []
        if edge in ("bottom", "top"):
            y = (oy0 if edge == "bottom" else oy1) - line
            if along is not None:
                xs = [along]
            else:
                lo, hi = ox0 - x0, ox1 - x1
                xs = _spread(lo, hi, 0.5, MAX_CANDIDATES)
            out = [_Cand(snap(x), snap(y), r, back, abs(x)) for x in xs]
        else:
            x = (ox0 if edge == "left" else ox1) - line
            if along is not None:
                ys = [along]
            else:
                lo, hi = oy0 - y0, oy1 - y1
                ys = _spread(lo, hi, 0.5, MAX_CANDIDATES)
            out = [_Cand(snap(x), snap(y), r, back, abs(y)) for y in ys]
        return out

    def near_cands(self, ref: str, anchor_box, side: str | None, rot, back: bool) -> list[_Cand]:
        ax0, ay0, ax1, ay1 = anchor_box
        acx, acy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
        out = []
        sides = [side] if side else list(SIDES)
        rots = self._rots(rot)
        gaps = [0.5 * k for k in range(1, 21)]
        per = max(1, MAX_CANDIDATES // (len(sides) * len(rots) * len(gaps)))
        for g in gaps:
            for sd in sides:
                for r in rots:
                    s = self.shape(ref, r, back)
                    x0, y0, x1, y1 = s.box
                    for k in _offsets(per):
                        off = 0.5 * k
                        if sd == "top":
                            x, y = acx - (x0 + x1) / 2 + off, ay1 + g - y0
                        elif sd == "bottom":
                            x, y = acx - (x0 + x1) / 2 + off, ay0 - g - y1
                        elif sd == "right":
                            x, y = ax1 + g - x0, acy - (y0 + y1) / 2 + off
                        else:
                            x, y = ax0 - g - x1, acy - (y0 + y1) / 2 + off
                        out.append(_Cand(snap(x), snap(y), r, back, math.hypot(x - acx, y - acy)))
        return out[:MAX_CANDIDATES]

    def point_cands(self, ref: str, point, radius: float, rots, back: bool, pad_number: str | None = None,
                    step: float = 0.5) -> list[_Cand]:
        """Positions within `radius` of a point (the part's pad on that point when pad_number is given)."""
        px, py = point
        offsets = []
        n = int(radius / step)
        for i in range(-n, n + 1):
            for j in range(-n, n + 1):
                d = math.hypot(i * step, j * step)
                if d <= radius:
                    offsets.append((d, j * step, i * step))
        offsets.sort()
        out = []
        per_rot = max(1, MAX_CANDIDATES // len(rots))
        for r in rots:
            s = self.shape(ref, r, back)
            if pad_number is not None:
                pad = next((q for q in s.pads if q[0] == pad_number), None)
                bx, by = (pad[1], pad[2]) if pad else (0.0, 0.0)
            else:
                bx, by = (s.box[0] + s.box[2]) / 2, (s.box[1] + s.box[3]) / 2
            for d, dx, dy in offsets[:per_rot]:
                x, y = px + dx - bx, py + dy - by
                out.append(_Cand(snap(x), snap(y), r, back, d))
        return out

    def rest_cands(self, ref: str, rot=None, back=False) -> list[_Cand]:
        pts = [q for n in self._nets_of(ref) for q in self.net_points.get(n, ()) if q[3] != ref]
        if pts:
            target = (sum(q[0] for q in pts) / len(pts), sum(q[1] for q in pts) / len(pts))
        else:
            target = ((self.obox[0] + self.obox[2]) / 2, (self.obox[1] + self.obox[3]) / 2)
        rots = self._rots(rot, (0, 90))
        ox0, oy0, ox1, oy1 = self.obox
        grid = []
        x = math.floor(ox0)
        while x <= ox1:
            y = math.floor(oy0)
            while y <= oy1:
                grid.append((math.hypot(x - target[0], y - target[1]), y, x))
                y += 1.0
            x += 1.0
        grid.sort()
        per_rot = max(1, MAX_CANDIDATES // len(rots))
        out = []
        for r in rots:
            s = self.shape(ref, r, back)
            cx, cy = (s.box[0] + s.box[2]) / 2, (s.box[1] + s.box[3]) / 2
            for d, y, x in grid[:per_rot]:
                out.append(_Cand(snap(x - cx), snap(y - cy), r, back, d))
        return out

    def _nets_of(self, ref):
        return sorted({n for n in self.pad_nets[ref].values() if n not in self.planes})

    # -- choosing -------------------------------------------------------------------------------------

    def choose(self, ref: str, cands: list[_Cand], face: str | None = None, *, report: bool = True,
               fallback: bool = False) -> _Cand:
        ranked = sorted(cands, key=lambda c: (round(self.cost(ref, c), 6), round(c.anchor_dist, 6), c.y, c.x, c.rot))
        for c in ranked:
            if self.valid(ref, c, face):
                return c
        if fallback:  # a preference (a satellite by its pin, a group member by the others), not an intent
            return self.choose(ref, self.rest_cands(ref), report=report)
        best = ranked[0]
        if report:
            self.findings.append(Finding(
                "placement", "placement_no_room", "warning",
                f"{ref}: no room for it as asked; it sits at its best spot, overlapping or past the outline",
                At("board", best.x, best.y), refs=(ref,)))
        return best

    def box_of(self, ref: str) -> tuple:
        """The part's courtyard box; for an edge part whose own keep-out lies past the edge (a module's antenna
        clearance), only the part on the board side of its face line, so neighbours gather round its body."""
        pose = self.pose[ref]
        s = self.shape(ref, pose.rot, pose.back)
        box = (s.box[0] + pose.x, s.box[1] + pose.y, s.box[2] + pose.x, s.box[3] + pose.y)
        a = self.anchor.get(ref)
        if self.kind.get(ref) == "edge" and a:
            face = a[1].edge
            line, _, by_keepout = self.face_of(ref, pose.rot, pose.back, face)
            if by_keepout:
                axis, sign = FACE_AXIS[face]
                off = pose.x if axis == "x" else pose.y
                polys = [clip_half_plane(self._moved(q, pose.x, pose.y), axis, line + off, "below" if sign > 0 else "above")
                         for v in s.sides.values() for q in v]
                pts = [pt for q in polys if len(q) >= 3 for pt in q]
                if pts:
                    box = bbox(pts)
        return box

    def pad_point(self, ref: str, number: str):
        pose = self.pose[ref]
        q = next(q for q in self.shape(ref, pose.rot, pose.back).pads if q[0] == number)
        return (q[1] + pose.x, q[2] + pose.y)

    # -- phases ---------------------------------------------------------------------------------------

    def run(self, rounds: int) -> None:
        intents = [self.intent[t] for t in self.intent]
        # fixed
        for i in intents:
            if i.at is not None and not i.target.startswith("group:"):
                c = _Cand(snap(i.at[0]), snap(i.at[1]), float(i.rot or 0.0), i.back)
                self._commit(i.target, c)
                self.kind[i.target] = "fixed"
                if not self.valid(i.target, c):
                    self.findings.append(Finding("placement", "placement_no_room", "warning",
                                                 f"{i.target}: its fixed position overlaps or leaves the outline",
                                                 At("board", c.x, c.y), refs=(i.target,)))
        # edge
        for i in intents:
            if i.edge is not None and not i.target.startswith("group:"):
                self._place_edge(i.target, i)
        # near, in dependency order
        pending = [i for i in intents if i.near is not None and not i.target.startswith("group:")]
        self._place_near(pending)
        # groups
        for name, g in self.groups.items():
            self._place_group(g)
        # satellites
        for ref in self.order:
            if ref not in self.pose:
                anchor = self._satellite_anchor(ref)
                if anchor:
                    self._place_satellite(ref, anchor)
        # rest
        for ref in self.order:
            if ref not in self.pose:
                self._commit(ref, self.choose(ref, self.rest_cands(ref)))
                self.kind[ref] = "rest"
        for _ in range(rounds):
            if not self._improve():
                break

    def _place_edge(self, ref, i, *, report=True):
        cands = self.edge_cands(ref, i.edge, i.along, i.rot, i.back)
        self._commit(ref, self.choose(ref, cands, face=i.edge, report=report))
        self.kind[ref] = "edge"
        self.anchor[ref] = ("edge", i)

    def _anchor_ready(self, near: str) -> bool:
        if near.startswith("group:"):
            g = self.groups.get(near[6:])
            return bool(g) and all(r in self.pose for r in g.refs)
        return near.split(".")[0] in self.pose

    def _anchor_box(self, near: str):
        if near.startswith("group:"):
            boxes = [self.box_of(r) for r in self.groups[near[6:]].refs]
            return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
        if "." in near:
            ref, number = near.split(".", 1)
            x, y = self.pad_point(ref, number)
            return (x, y, x, y)
        return self.box_of(near)

    def _place_near(self, pending):
        waiting = list(pending)
        while waiting:
            ready = [i for i in waiting if self._anchor_ready(i.near)]
            if not ready:
                # anchors that have no intent of their own go first, as the rest would; what is left is a loop
                free = [i for i in waiting if not i.near.startswith("group:") and i.near.split(".")[0] not in
                        {w.target for w in waiting} and i.near.split(".")[0] not in self.group_of]
                if free:
                    anchor = free[0].near.split(".")[0]
                    self._commit(anchor, self.choose(anchor, self.rest_cands(anchor)))
                    self.kind[anchor] = "rest"
                    continue
                refs = sorted({i.target for i in waiting} | {i.near.split(".")[0] for i in waiting
                                                              if not i.near.startswith("group:")})
                self.findings.append(Finding("placement", "placement_loop", "error",
                                             f"placement intent goes round in a loop: {', '.join(refs)}; "
                                             "those parts were placed without it",
                                             refs=tuple(refs)))
                return
            for i in ready:
                waiting.remove(i)
                self._place_near_one(i.target, i)

    def _place_near_one(self, ref, i, *, report=True):
        box = self._anchor_box(i.near)
        cands = self.near_cands(ref, box, i.side, i.rot, i.back)
        self._commit(ref, self.choose(ref, cands, report=report))
        self.kind[ref] = "near"
        self.anchor[ref] = ("near", i)

    def _place_group(self, g):
        todo = [r for r in g.refs if r not in self.pose]
        if not todo:
            return
        i = self.intent.get(f"group:{g.name}")
        first = todo[0]
        if i is not None and i.at is not None:
            self._commit(first, _Cand(snap(i.at[0]), snap(i.at[1]), float(i.rot or 0.0), i.back))
            self.kind[first] = "fixed"
        elif i is not None and i.edge is not None:
            self._place_edge(first, i)
        elif i is not None and i.near is not None and self._anchor_ready(i.near):
            self._place_near_one(first, i)
        else:
            centre = ((self.obox[0] + self.obox[2]) / 2, (self.obox[1] + self.obox[3]) / 2)
            self._commit(first, self.choose(first, self.point_cands(first, centre, 10.0, [0.0, 90.0], False)))
            self.kind[first] = "group"
        for ref in todo[1:]:
            box = self.box_of(first)
            cands = self.near_cands(ref, box, None, None, False)
            self._commit(ref, self.choose(ref, cands, fallback=True))
            self.kind[ref] = "group"
            self.anchor[ref] = ("group", first)
            first = ref

    def _satellite_anchor(self, ref):
        part = self.parts[ref]
        if len(self.fp[ref].pads) != 2 and len(part.pins) != 2:
            return None
        gnd = {n.name for n in self.c.nets if n.kind == "gnd"}
        hubs = [p for p in self.c.parts if p.ref != ref and len(self.fp[p.ref].pads) >= 3]
        # a part in the same block first, then declaration order; the first such pad in pin-number order
        hubs.sort(key=lambda p: (p.block != part.block, self.order.index(p.ref)))
        mine = [(num, net) for num, net in sorted(self.pad_nets[ref].items(), key=lambda t: _natural(t[0]))
                if net not in gnd]
        for hub in hubs:
            for hnum, hnet in sorted(self.pad_nets[hub.ref].items(), key=lambda t: _natural(t[0])):
                for num, net in mine:
                    if net == hnet:
                        return (hub.ref, hnum, num)
        return None

    def _place_satellite(self, ref, anchor):
        hub, hnum, num = anchor
        if hub not in self.pose:
            self._commit(hub, self.choose(hub, self.rest_cands(hub)))
            self.kind[hub] = "rest"
        point = self.pad_point(hub, hnum)
        cands = self.point_cands(ref, point, 6.0, [0.0, 90.0], False, pad_number=num)
        self._commit(ref, self.choose(ref, cands, fallback=True))
        self.kind[ref] = "satellite"
        self.anchor[ref] = ("satellite", anchor)

    def _cands_for(self, ref):
        kind = self.kind.get(ref)
        a = self.anchor.get(ref)
        if kind == "edge":
            i = a[1]
            return self.edge_cands(ref, i.edge, i.along, i.rot, i.back), i.edge
        if kind == "near":
            i = a[1]
            return self.near_cands(ref, self._anchor_box(i.near), i.side, i.rot, i.back), None
        if kind == "group" and a:
            return self.near_cands(ref, self.box_of(a[1]), None, None, False), None
        if kind == "satellite":
            hub, hnum, num = a[1]
            return self.point_cands(ref, self.pad_point(hub, hnum), 6.0, [0.0, 90.0], False, pad_number=num), None
        if kind == "rest":
            return self.rest_cands(ref), None
        return [], None

    def _improve(self) -> bool:
        moved = False
        current = self.total().total
        for ref in self.order:
            if self.kind.get(ref) == "fixed":
                continue
            cands, face = self._cands_for(ref)
            if not cands:
                continue
            old = self.pose[ref]
            del self.pose[ref]
            self._rebuild()
            best = self._best_valid(ref, cands, face)
            if best is None or (best.x, best.y, best.rot, best.back) == (old.x, old.y, old.rot, old.back):
                self._commit(ref, _Cand(old.x, old.y, old.rot, old.back))
                continue
            self._commit(ref, best)
            new = self.total().total
            if new < current - 1e-9:
                current, moved = new, True
            else:
                self._commit(ref, _Cand(old.x, old.y, old.rot, old.back))
        return moved

    def _best_valid(self, ref, cands, face):
        ranked = sorted(cands, key=lambda c: (round(self.cost(ref, c), 6), round(c.anchor_dist, 6), c.y, c.x, c.rot))
        for c in ranked:
            if self.valid(ref, c, face):
                return c
        return None


def _box_meet(a, b) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _spread(lo: float, hi: float, step: float, limit: int) -> list[float]:
    """Points from lo to hi `step` apart, centre first, at most `limit` of them."""
    if hi < lo:
        return [(lo + hi) / 2]
    n = int((hi - lo) / step)
    pts = [lo + k * step for k in range(n + 1)]
    mid = (lo + hi) / 2
    pts.sort(key=lambda v: (abs(v - mid), v))
    return pts[:limit]


def _offsets(n: int) -> list[int]:
    out = [0]
    k = 1
    while len(out) < n:
        out += [k, -k]
        k += 1
    return out[:n]


def _natural(s: str):
    import re
    return [(0, int(t), "") if t.isdigit() else (1, 0, t) for t in re.findall(r"\d+|\D+", s)]


def place(circuit: Circuit, footprints: FootprintLibrary, *, rounds: int = 2) -> PlaceResult:
    start = time.perf_counter()
    p = Placer(circuit, footprints)
    p.run(rounds)
    placement = {ref: p.pose[ref] for ref in p.order}
    placed = []
    for part in circuit.parts:
        pose = placement[part.ref]
        placed.append(Placed(part.ref, part.key, p.fp[part.ref], pose.x, pose.y, pose.rot, pose.back, part.value,
                             p.pad_nets[part.ref], part.dnp, part.lcsc))
    return PlaceResult(placement, p.total(), p.findings, placed, time.perf_counter() - start)
