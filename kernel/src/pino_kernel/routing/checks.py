# Ported from pcb-kit (https://github.com/somebox/pcb-kit, commit 32867ca). MIT License, Copyright (c) 2026 Jeremy Seitz. See NOTICE.
"""Checks on a routed board: DRC that the router caused, the nets left, the router's share, and what DRC does
not flag in the copper (floating pieces, stubs, loops, pours reaching one pad, tracks thinner than their class,
differential pairs off their gap or not coupled).

`UF` and `groups` are ported from pcb-kit's checks/route_check.py; the contacts between pieces of copper are
rebuilt on pino's own contact rule (`pcb.copper.touch`, shapes grown by 0.02 mm), without pcbnew.
"""

from __future__ import annotations

import collections
import math
import re
from dataclasses import dataclass
from typing import Mapping

from ..checks.reports import drc_findings
from ..coords import from_kicad
from ..findings import At, Finding
from ..geometry import distance_to_edges, point_in_polygon, point_segment_distance
from ..pcb.copper import TOUCH, Copper, Item, holds, items_of, touch
from .plan import RoutePlan

NECK_LENGTH = 2.5  # mm: KiCadRoutingTools necks a track down this close to a small pad
PAIR_TOLERANCE = 0.02  # mm
PAIR_MIN_COUPLED = 0.5  # of the positive net's length
PARALLEL_DEGREES = 1.0
LOOP_KEY = 0.005  # mm
_BRACKET = re.compile(r"\[([^\]]*)\]")
_PAD = re.compile(r"Pad (\S+) \[[^\]]*\] of (\S+)")


class UF:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, i):
        while self.p[i] != i:
            self.p[i] = self.p[self.p[i]]
            i = self.p[i]
        return i

    def union(self, a, b):
        self.p[self.find(a)] = self.find(b)


def groups(items, contacts, keep=lambda k: True):
    uf = UF(len(items))
    for a, c in contacts:
        if keep(a) and keep(c):
            uf.union(a, c)
    out = collections.defaultdict(list)
    for k in range(len(items)):
        if keep(k):
            out[uf.find(k)].append(k)
    return list(out.values())


# --- DRC -----------------------------------------------------------------------------------------------------


def _pad_at(copper: Copper, X: float, Y: float):
    """The pad under a point in KiCad's frame (DRC report positions), else None."""
    x, y = from_kicad(X, Y)
    best = None
    for p in copper.pads:
        if p.net and point_in_polygon((x, y), p.polygon):
            d = math.dist(p.centre, (x, y))
            if best is None or d < best[0]:
                best = (d, p)
    return best[1] if best else None


def _item_net(it: dict, copper: Copper | None) -> str | None:
    m = _BRACKET.search(it.get("description", "") or "")
    if m:
        return m.group(1)
    if copper is not None and "pos" in it:
        p = _pad_at(copper, it["pos"]["x"], it["pos"]["y"])
        if p is not None:
            return p.net
        x, y = from_kicad(it["pos"]["x"], it["pos"]["y"])
        for t in copper.tracks:
            if point_segment_distance((x, y), t.a, t.b) <= t.width / 2 + TOUCH:
                return t.net
        for v in copper.vias:
            if math.dist(v.at, (x, y)) <= v.diameter / 2 + TOUCH:
                return v.net
    return None


def _entries(report: dict) -> list[dict]:
    u = report.get("unconnected_items", [])
    return u if isinstance(u, list) else []


def unrouted_nets(report: dict, copper: Copper | None = None) -> dict[str, int]:
    """net -> how many unconnected items DRC lists for it (the net of each item's first pad or track)."""
    out: dict[str, int] = collections.defaultdict(int)
    for e in _entries(report):
        for it in e.get("items", []):
            net = _item_net(it, copper)
            if net:
                out[net] += 1
                break
    return dict(out)


def complete_nets(report: dict, copper: Copper) -> tuple[int, int]:
    """(nets with two or more pads, how many of them have no unconnected item)."""
    counts: dict[str, int] = collections.defaultdict(int)
    for p in copper.pads:
        if p.net:
            counts[p.net] += 1
    nets = {n for n, c in counts.items() if c >= 2}
    left = set(unrouted_nets(report, copper))
    return len(nets), len(nets - left)


def _violation_key(v: dict) -> tuple:
    return (v.get("type"), tuple(sorted(it.get("uuid", "") for it in v.get("items", []))))


def router_drc(report: dict, baseline: dict, footprint_refs: Mapping[str, str]) -> list[Finding]:
    """DRC violations the routing added: those of `report` not in `baseline`, without parity (the fast build owns
    it) and without unconnected items (counted apart)."""
    old = {_violation_key(v) for v in baseline.get("violations", []) or []}
    new = [v for v in report.get("violations", []) or [] if _violation_key(v) not in old]
    found, _ = drc_findings({"violations": new, "coordinate_units": report.get("coordinate_units", "mm")},
                            footprint_refs)
    return found


@dataclass
class Share:
    nets: int
    before: int
    after_router: int
    after_finish: int
    router_seconds: float
    finish_seconds: float

    def router_share(self) -> float | None:
        if self.nets == self.before:
            return None
        return (self.after_router - self.before) / (self.nets - self.before)

    def to_json(self) -> dict:
        share = self.router_share()
        return {"nets": self.nets, "done_before": self.before,
                "router": {"routed": self.after_router - self.before, "of": self.nets - self.before,
                           "share": None if share is None else round(share, 3),
                           "seconds": round(self.router_seconds, 3)},
                "finish": {"routed": self.after_finish - self.after_router, "seconds": round(self.finish_seconds, 3)}}


def _pin(it: dict, copper: Copper | None) -> str:
    m = _PAD.search(it.get("description", "") or "")
    if m:
        return f"{m.group(2)}.{m.group(1)}"
    if copper is not None and "pos" in it:
        p = _pad_at(copper, it["pos"]["x"], it["pos"]["y"])
        if p is not None:
            return f"{p.ref}.{p.number}"
        x, y = from_kicad(it["pos"]["x"], it["pos"]["y"])
        return f"({x:.2f}, {y:.2f})"
    return "?"


def unrouted_findings(report: dict, copper: Copper) -> list[Finding]:
    by_net: dict[str, list[dict]] = collections.defaultdict(list)
    for e in _entries(report):
        items = e.get("items", [])
        net = next((n for n in (_item_net(it, copper) for it in items) if n), None)
        if net:
            by_net[net].append(e)
    out = []
    for net in sorted(by_net):
        entries = by_net[net]
        pairs = [" to ".join(_pin(it, copper) for it in e.get("items", [])[:2]) for e in entries]
        shown = ", ".join(pairs[:3]) + (", …" if len(pairs) > 3 else "")
        n = len(entries)
        first = entries[0].get("items", [{}])[0]
        at = None
        if "pos" in first:
            x, y = from_kicad(first["pos"]["x"], first["pos"]["y"])
            at = At("board", round(x, 6) + 0.0, round(y, 6) + 0.0)
        out.append(Finding("route", "net_unrouted", "error",
                           f"net {net}: {n} connection{'s' if n != 1 else ''} left ({shown})", at, nets=(net,)))
    return out


# --- copper checks -------------------------------------------------------------------------------------------


def _pt(p) -> str:
    return f"({p[0]:.2f}, {p[1]:.2f})"


def _len(t) -> float:
    return math.dist(t.a, t.b)


def _near_small_pad(t, pads, width: float) -> bool:
    """The track lies wholly within NECK_LENGTH of a pad of its net whose smaller side is under `width`."""
    for p in pads:
        if min(p.size) >= width - 1e-9:
            continue
        if all(point_in_polygon(e, p.polygon) or distance_to_edges(e, p.polygon) <= NECK_LENGTH for e in (t.a, t.b)):
            return True
    return False


def copper_findings(copper: Copper, plan: RoutePlan, widths: Mapping[str, float]) -> list[Finding]:
    items = [it for it in items_of(copper) if it.kind != "zone"]
    by_net: dict[str, list[int]] = collections.defaultdict(list)
    for k, it in enumerate(items):
        if it.net:
            by_net[it.net].append(k)
    pads_by_net: dict[str, list] = collections.defaultdict(list)
    for p in copper.pads:
        if p.net:
            pads_by_net[p.net].append(p)
    out: list[Finding] = []
    for net in sorted(by_net):
        idx = by_net[net]
        local = [items[k] for k in idx]
        contacts = []
        for a in range(len(local)):
            for c in range(a + 1, len(local)):
                if touch(local[a], local[c]):
                    contacts.append((a, c))
        out += _group_findings(net, local, contacts, len(pads_by_net[net]))
        out += _stub_findings(net, local, contacts)
        out += _loop_findings(net, local)
    out += _thin_findings(copper, widths, pads_by_net)
    out += _pair_findings(copper, plan, pads_by_net)
    return out


def _group_findings(net: str, local: list[Item], contacts, n_pads: int) -> list[Finding]:
    out = []
    for g in groups(local, contacts):
        kinds = collections.Counter(local[k].kind for k in g)
        pads = [local[k] for k in g if local[k].kind == "pad"]
        fills = [local[k] for k in g if local[k].kind == "fill"]
        if not pads:
            what = []
            tracks = [local[k].obj for k in g if local[k].kind in ("track", "arc")]
            if tracks:
                mm = sum(_len(t) for t in tracks if hasattr(t, "a"))
                what.append(f"{len(tracks)} track{'s' if len(tracks) != 1 else ''} {mm:.1f} mm")
            if kinds["via"]:
                what.append(f"{kinds['via']} via{'s' if kinds['via'] != 1 else ''}")
            if fills:
                area = sum(_area(f.obj.polygon) for f in fills)
                what.append(f"{len(fills)} pour island{'s' if len(fills) != 1 else ''} {area:.1f} mm²")
            first = local[g[0]]
            at = _item_point(first)
            layer = sorted(first.layers)[0] if len(first.layers) == 1 else None
            out.append(Finding("copper", "copper_floating", "warning",
                               f"net {net}: floating copper, {', '.join(what)} at {_pt(at)} joined to no pad",
                               At("board", round(at[0], 6), round(at[1], 6), layer), nets=(net,)))
        elif fills and len(pads) == 1 and n_pads > 1:
            p = pads[0].obj
            zones = sorted({f.obj.zone for f in fills})
            area = sum(_area(f.obj.polygon) for f in fills)
            at = fills[0].obj.polygon[0]
            out.append(Finding("copper", "pour_one_pad", "warning",
                               f"net {net}: pour {', '.join(zones)} ({area:.1f} mm²) reaches only {p.ref}.{p.number} "
                               f"of the net's {n_pads} pads; stitch it to the others",
                               At("board", round(at[0], 6), round(at[1], 6), fills[0].obj.layer), nets=(net,)))
    return out


def _area(poly) -> float:
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1]))) / 2


def _item_point(it: Item):
    o = it.obj
    if it.kind == "track":
        return o.a
    if it.kind == "arc":
        return o.start
    if it.kind == "via":
        return o.at
    return o.polygon[0]


def _stub_findings(net: str, local: list[Item], contacts) -> list[Finding]:
    tracks = [k for k, it in enumerate(local) if it.kind == "track"]
    if not tracks:
        return []
    adj, stops = collections.defaultdict(set), set()
    for a, c in contacts:
        ka, kc = local[a].kind, local[c].kind
        if ka == "track" and kc == "track":
            adj[a].add(c)
            adj[c].add(a)
        elif ka == "track" or kc == "track":
            stops.add(a if ka == "track" else c)
    near = collections.defaultdict(list)
    for a, c in contacts:
        near[a].append(c)
        near[c].append(a)
    out = []
    for i in tracks:
        t = local[i].obj
        free = [e for e in (t.a, t.b) if not any(holds(local[j], e) for j in near[i])]
        if not free or len(free) == 2 and not near[i]:
            continue  # a lone track is floating copper, reported above
        run, cur = [i], i
        while cur not in stops:
            nxt = adj[cur] - set(run)
            if len(nxt) != 1:
                break
            n = nxt.pop()
            if len(adj[n] - {cur}) >= 2:
                break
            run.append(n)
            cur = n
        length = sum(_len(local[k].obj) for k in run)
        out.append(Finding("copper", "copper_stub", "warning",
                           f"net {net}: dead end at {_pt(free[0])} on {t.layer}, {len(run)} segment"
                           f"{'s' if len(run) != 1 else ''} {length:.1f} mm",
                           At("board", round(free[0][0], 6), round(free[0][1], 6), t.layer), nets=(net,)))
    return out


def _loop_findings(net: str, local: list[Item]) -> list[Finding]:
    if any(it.kind == "fill" for it in local):
        return []
    tracks = [it.obj for it in local if it.kind == "track"]
    if len(tracks) < 2:
        return []

    def key(p, layer):
        return (round(p[0] / LOOP_KEY), round(p[1] / LOOP_KEY), layer)

    edges = {tuple(sorted((key(t.a, t.layer), key(t.b, t.layer)))) for t in tracks if key(t.a, t.layer) != key(t.b, t.layer)}
    nodes = sorted({n for e in edges for n in e})
    ix = {n: k for k, n in enumerate(nodes)}
    uf = UF(len(nodes))
    for a, c in edges:
        uf.union(ix[a], ix[c])
    cycles = len(edges) - len(nodes) + len({uf.find(k) for k in range(len(nodes))})
    if cycles <= 0:
        return []
    t = tracks[0]
    return [Finding("copper", "copper_loop", "info",
                    f"net {net}: {cycles} loop{'s' if cycles != 1 else ''} on one layer ({len(tracks)} segments): "
                    "the net is routed twice between the same points",
                    At("board", round(t.a[0], 6), round(t.a[1], 6), t.layer), nets=(net,))]


def _thin_findings(copper: Copper, widths: Mapping[str, float], pads_by_net) -> list[Finding]:
    out = []
    for t in copper.tracks:
        want = widths.get(t.net)
        if want is None or t.locked or t.width >= want - 0.001:
            continue
        if _near_small_pad(t, pads_by_net.get(t.net, []), want):
            continue
        out.append(Finding("copper", "track_too_thin", "error",
                           f"net {t.net}: a track {t.width:g} mm wide at {_pt(t.a)} on {t.layer}, below its class "
                           f"width {want:g} mm",
                           At("board", round(t.a[0], 6), round(t.a[1], 6), t.layer), nets=(t.net,)))
    return out


def _parallel(t, u) -> tuple[float, float] | None:
    """(centre distance, overlap length) of two parallel segments whose projections overlap, else None."""
    ax, ay = t.b[0] - t.a[0], t.b[1] - t.a[1]
    bx, by = u.b[0] - u.a[0], u.b[1] - u.a[1]
    la, lb = math.hypot(ax, ay), math.hypot(bx, by)
    if la < 1e-6 or lb < 1e-6:
        return None
    cos = abs(ax * bx + ay * by) / (la * lb)
    if cos < math.cos(math.radians(PARALLEL_DEGREES)):
        return None
    ux, uy = ax / la, ay / la
    s0 = (u.a[0] - t.a[0]) * ux + (u.a[1] - t.a[1]) * uy
    s1 = (u.b[0] - t.a[0]) * ux + (u.b[1] - t.a[1]) * uy
    lo, hi = max(0.0, min(s0, s1)), min(la, max(s0, s1))
    if hi - lo <= 1e-6:
        return None
    mid = ((u.a[0] + u.b[0]) / 2, (u.a[1] + u.b[1]) / 2)
    dist = abs((mid[0] - t.a[0]) * uy - (mid[1] - t.a[1]) * ux)
    return dist, hi - lo


def _pair_findings(copper: Copper, plan: RoutePlan, pads_by_net) -> list[Finding]:
    out = []
    for p in plan.pairs:
        pos = [t for t in copper.tracks if t.net == p.positive]
        neg = [t for t in copper.tracks if t.net == p.negative]
        if not pos or not neg:
            continue
        pair_pads = pads_by_net.get(p.positive, []) + pads_by_net.get(p.negative, [])
        coupled, off = 0.0, []
        for t in pos:
            for u in neg:
                if t.layer != u.layer:
                    continue
                par = _parallel(t, u)
                if par is None:
                    continue
                dist, overlap = par
                width = (t.width + u.width) / 2
                if dist >= width + p.gap + 0.5:
                    continue
                coupled += overlap
                gap = dist - width
                if abs(gap - p.gap) > PAIR_TOLERANCE + 1e-9 and not (
                        _near_small_pad(t, pair_pads, math.inf) and _near_small_pad(u, pair_pads, math.inf)):
                    off.append((gap, t))
        if off:
            gaps = sorted(g for g, _ in off)
            span = f"{gaps[0]:.2f} mm" if len(gaps) == 1 or abs(gaps[-1] - gaps[0]) < 0.005 else \
                f"{gaps[0]:.2f} to {gaps[-1]:.2f} mm"
            t = off[0][1]
            out.append(Finding("copper", "pair_gap", "error",
                               f"pair {p.name}: {len(off)} coupled run{'s' if len(off) != 1 else ''} on {t.layer} "
                               f"with a gap of {span}; the pair's gap is {p.gap:g} mm (within {PAIR_TOLERANCE:g} mm)",
                               At("board", round(t.a[0], 6), round(t.a[1], 6), t.layer), nets=(p.positive, p.negative)))
        length = sum(_len(t) for t in pos)
        if length > 0 and coupled < PAIR_MIN_COUPLED * length:
            t = pos[0]
            out.append(Finding("copper", "pair_uncoupled", "warning",
                               f"pair {p.name}: {coupled:.1f} mm of {length:.1f} mm runs coupled; route the two nets "
                               "side by side", At("board", round(t.a[0], 6), round(t.a[1], 6), t.layer),
                               nets=(p.positive, p.negative)))
    return out
