# Ported from pcb-kit (https://github.com/somebox/pcb-kit, commit 32867ca). MIT License, Copyright (c) 2026 Jeremy Seitz. See NOTICE.
"""Tidy the track work a router leaves, on unlocked segments only (kept copper is locked and never touched):

- zero-length segments are removed;
- exact duplicates (same layer, net, width and end points) are reduced to one;
- a segment lying wholly within a collinear segment of the same net and layer, of the same or larger width,
  is removed;
- two collinear segments of one net, layer and width that meet end to end are merged into one;
- dangling leaves go: a segment with an end that touches nothing of its net on its layer (pad, via, other
  track, fill island), whose other neighbours all meet at its other end, so removing it never splits a net.
  Leaves are peeled one at a time, so a dead-end chain goes whole. A segment touching a zone with no fill stays.

`EPS`, `key`, `collinear`, `within` and `plan` are ported from pcb-kit's checks/cleanup_tracks.py (millimetres
here, not nanometres). The dangling peel is rebuilt on pino's own contact rule (`copper.touch`, `copper.holds`)
instead of pcbnew. Fill islands are the board text's own: the caller refills first.
"""

from __future__ import annotations

import collections
from dataclasses import dataclass, field, replace

from ..coords import to_kicad
from ..geometry import Point
from ..sexpr import dump, find, num, parse
from .copper import Copper, Item, holds, items_of, touch

EPS = 0.001  # mm: endpoint coincidence


class Seg:
    def __init__(self, uuid: str, layer: str, net: str, width: float, a: Point, b: Point):
        self.uuid, self.layer, self.net, self.width = uuid, layer, net, width
        self.a, self.b = a, b
        self.changed = False


def key(p):
    return (round(p[0] / EPS), round(p[1] / EPS))


def collinear(a, b, c):
    cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    length = max(abs(b[0] - a[0]) + abs(b[1] - a[1]), 1e-6)
    return abs(cross) / length < EPS


def within(p, a, b):
    return (min(a[0], b[0]) - EPS <= p[0] <= max(a[0], b[0]) + EPS
            and min(a[1], b[1]) - EPS <= p[1] <= max(a[1], b[1]) + EPS)


def plan(segs):
    """Returns (gone: uuid -> reason, merged: [Seg with new ends])."""
    gone = {}
    seen = set()
    for s in segs:
        a, b = key(s.a), key(s.b)
        if a == b:
            gone[s.uuid] = "zero-length"
            continue
        k = (s.layer, s.net, s.width, min(a, b), max(a, b))
        if k in seen:
            gone[s.uuid] = "duplicate"
        else:
            seen.add(k)
    changed = True
    while changed:
        changed = False
        groups = collections.defaultdict(list)
        for s in segs:
            if s.uuid not in gone:
                groups[(s.layer, s.net)].append(s)
        for group in groups.values():
            for s in group:
                if s.uuid in gone:
                    continue
                for o in group:
                    if o is s or o.uuid in gone or o.width < s.width:
                        continue
                    if (collinear(o.a, o.b, s.a) and collinear(o.a, o.b, s.b)
                            and within(s.a, o.a, o.b) and within(s.b, o.a, o.b)):
                        gone[s.uuid] = "covered"
                        changed = True
                        break
            ends = collections.defaultdict(list)
            for s in group:
                if s.uuid not in gone:
                    ends[key(s.a)].append(s)
                    ends[key(s.b)].append(s)
            for pt, pair in ends.items():
                if len(pair) != 2 or pair[0] is pair[1] or any(x.uuid in gone for x in pair):
                    continue
                s, o = pair
                if s.width != o.width:
                    continue
                far_s = s.b if key(s.a) == pt else s.a
                far_o = o.b if key(o.a) == pt else o.a
                mid = s.a if key(s.a) == pt else s.b
                if not collinear(far_s, far_o, mid) or not within(mid, far_s, far_o):
                    continue
                s.a, s.b, s.changed = far_s, far_o, True
                gone[o.uuid] = "merged"
                changed = True
    return gone, [s for s in segs if s.changed and s.uuid not in gone]


@dataclass
class CleanupReport:
    removed: dict[str, str] = field(default_factory=dict)  # uuid -> zero-length | duplicate | covered | merged | dangling
    merged: int = 0


def dangling(items: list[Item], candidates: dict[str, Seg]) -> dict[str, str]:
    """uuid -> "dangling" for the candidate segments that are leaves (see the module doc)."""
    by: dict[tuple[str, str], list[int]] = collections.defaultdict(list)
    for k, it in enumerate(items):
        for L in it.layers:
            by[(it.net, L)].append(k)
    index = {it.uuid: k for k, it in enumerate(items) if it.kind == "track"}
    contacts: dict[str, list[int]] = {}
    gone: dict[str, str] = {}

    def touching(u: str) -> list[int]:
        if u not in contacts:
            me = items[index[u]]
            (L,) = me.layers
            contacts[u] = [k for k in by[(me.net, L)] if k != index[u] and touch(me, items[k])]
        return [k for k in contacts[u] if items[k].uuid not in gone]

    todo = sorted(candidates)
    while todo:  # a removal can only make its neighbours leaves: re-check those
        u = todo.pop()
        if u in gone or u not in index:
            continue
        s = candidates[u]
        near = touching(u)
        if any(items[k].kind == "zone" for k in near):
            continue
        ends = (s.a, s.b)
        for i in (0, 1):
            if not any(holds(items[k], ends[i]) for k in near) and all(holds(items[k], ends[1 - i]) for k in near):
                gone[u] = "dangling"
                todo += sorted(items[k].uuid for k in near if items[k].uuid in candidates)
                break
    return gone


def cleanup(text: str, copper: Copper) -> tuple[str, CleanupReport]:
    segs = [Seg(t.uuid, t.layer, t.net, t.width, t.a, t.b) for t in copper.tracks if not t.locked and t.uuid]
    gone, merged = plan(segs)
    by_uuid = {s.uuid: s for s in segs}
    # the dangling pass sees the copper as the plan left it
    left = []
    for t in copper.tracks:
        if t.uuid in gone:
            continue
        s = by_uuid.get(t.uuid)
        left.append(replace(t, a=s.a, b=s.b) if s is not None and s.changed else t)
    rest = Copper(left, copper.arcs, copper.vias, copper.pads, copper.fills, copper.layers, copper.unfilled)
    candidates = {s.uuid: s for s in segs if s.uuid not in gone}
    loose = dangling(items_of(rest), candidates)
    gone.update(loose)
    report = CleanupReport(dict(sorted(gone.items())), len([s for s in merged if s.uuid not in gone]))
    if not gone and not merged:
        return text, report
    edits = {s.uuid: s for s in merged if s.uuid not in gone}
    root = parse(text)
    out = [root[0]]
    for n in root[1:]:
        if isinstance(n, list) and n and str(n[0]) == "segment":
            u = find(n, "uuid")
            uid = str(u[1]) if u else ""
            if uid in gone:
                continue
            if uid in edits:
                s = edits[uid]
                (X0, Y0), (X1, Y1) = to_kicad(*s.a), to_kicad(*s.b)
                st, en = find(n, "start"), find(n, "end")
                st[1], st[2], en[1], en[2] = num(X0), num(Y0), num(X1), num(Y1)
        out.append(n)
    return dump(out) + "\n", report
