"""The route plan: what the router chain does to one board, read from the board, its rules and board.py.

- Rules: the Default class and the board's minimums from `board.kicad_pro`, raised by the `pino:` rules of
  `board.kicad_dru`. KiCadRoutingTools keeps copper clearance from a via but not a hole clearance larger than
  that, so vias are grown until their hole keeps the board's hole clearance.
- Fanout for four-sided fine-pitch parts (QFN, DFN, QFP), planes, differential pairs, power widths, the other
  signals, and the board.py route hints with their rip lists spelled out.
- Router keep-outs: rule areas pino adds to a step's input only (named `pino-router:`), for NPTH holes and for a
  hint's region; a hint's corridor is a line chain on User.1.

Every position is board mm in the outline frame (y up).
"""

from __future__ import annotations

import fnmatch
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping, Sequence

from .. import ids
from ..circuit import Circuit, PairSpec, RouteHint
from ..coords import from_kicad, to_kicad
from ..findings import Finding
from ..geometry import Point, Polygon, circle_polygon
from ..jsonable import decode, encode
from ..pcb.copper import Copper, board_layers, contact_map, items_of, read_copper
from ..sexpr import Sym, dump, find, find_all, num, parse

FANOUT_MIN_PADS = 16
FANOUT_MIN_PER_SIDE = 3
FANOUT_MAX_PITCH = 0.65
FINE_PITCH = 0.5
SIDE_TOLERANCE = 0.3  # mm: a pad belongs to a side of the pad box when its centre is this close to it
ROUTER_PREFIX = "pino-router:"
CORRIDOR_LAYER = "User.1"
DEFAULT_HOLE_CLEARANCE = 0.25  # KiCad's own default


def _r(v: float) -> float:
    return round(float(v), 6) + 0.0


def _ceil(v: float, step: float = 0.01) -> float:
    return _r(math.ceil(round(v / step, 6)) * step)


@dataclass(frozen=True)
class RouterRules:
    track_width: float
    clearance: float
    via_diameter: float
    via_drill: float
    min_track: float
    min_clearance: float
    hole_clearance: float
    hole_to_hole: float
    edge_clearance: float


@dataclass(frozen=True)
class FanoutStep:
    ref: str
    pitch: float
    width: float
    clearance: float


@dataclass(frozen=True)
class PairStep:
    name: str
    positive: str
    negative: str
    width: float
    gap: float


@dataclass(frozen=True)
class PlaneStep:
    net: str
    layers: list[str]


@dataclass(frozen=True)
class PowerNet:
    net: str
    width: float


@dataclass(frozen=True)
class HintStep:
    net: str
    region: tuple[float, float, float, float] | None
    layers: list[str] | None
    corridor: list[tuple[float, float]] | None
    rip: list[str]
    line: int | None


@dataclass(frozen=True)
class RouterKeepout:
    name: str
    polygon: list[tuple[float, float]]
    layers: list[str]
    forbid_tracks: bool = True  # vias are always forbidden


@dataclass
class RoutePlan:
    layers: list[str]
    rules: RouterRules
    grid_step: float
    fanout: list[FanoutStep]
    pairs: list[PairStep]
    planes: list[PlaneStep]
    power: list[PowerNet]
    signals: list[str]
    hints: list[HintStep]
    keepouts: list[RouterKeepout]
    warnings: list[Finding] = field(default_factory=list)

    def to_dict(self) -> dict:
        data = {f: encode(getattr(self, f)) for f in ("layers", "rules", "grid_step", "fanout", "pairs", "planes",
                                                        "power", "signals", "hints", "keepouts")}
        data["warnings"] = [w.to_json() for w in self.warnings]
        return data

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"

    @staticmethod
    def from_json(text: str) -> "RoutePlan":
        d = json.loads(text)
        return RoutePlan(list(d["layers"]), decode(RouterRules, d["rules"]), float(d["grid_step"]),
                         decode(list[FanoutStep], d["fanout"]), decode(list[PairStep], d["pairs"]),
                         decode(list[PlaneStep], d["planes"]), decode(list[PowerNet], d["power"]),
                         list(d["signals"]), decode(list[HintStep], d["hints"]),
                         decode(list[RouterKeepout], d["keepouts"]),
                         [Finding.from_json(w) for w in d.get("warnings", [])])

    @property
    def nothing_to_route(self) -> bool:
        return not (self.signals or self.pairs or self.planes or self.hints or self.fanout)


# --- rules ---------------------------------------------------------------------------------------------------

_DRU_RULE = re.compile(r'\(rule\s+"pino: ([a-z_]+)"\s*\(constraint\s+([a-z_]+)\s+\(min\s+([0-9.]+)mm\)\)\s*\)')
_DRU_FIELDS = {"track_width": "min_track", "clearance": "min_clearance", "hole_clearance": "hole_clearance",
               "hole_to_hole": "hole_to_hole", "edge_clearance": "edge_clearance"}


def _classes(pro: dict) -> list[dict]:
    return list((pro.get("net_settings") or {}).get("classes") or [])


def _default_class(pro: dict) -> dict:
    classes = _classes(pro)
    return next((c for c in classes if c.get("name") == "Default"), classes[0] if classes else {})


def _raw_rules(pro_text: str, dru_text: str | None) -> dict:
    pro = json.loads(pro_text)
    d = _default_class(pro)
    rules = ((pro.get("board") or {}).get("design_settings") or {}).get("rules") or {}
    out = {"track_width": float(d.get("track_width", 0.25)), "clearance": float(d.get("clearance", 0.2)),
           "via_diameter": float(d.get("via_diameter", 0.6)), "via_drill": float(d.get("via_drill", 0.3)),
           "min_track": float(rules.get("min_track_width", 0.0)), "min_clearance": float(rules.get("min_clearance", 0.0)),
           "hole_clearance": float(rules.get("min_hole_clearance", DEFAULT_HOLE_CLEARANCE)),
           "hole_to_hole": float(rules.get("min_hole_to_hole", 0.25)),
           "edge_clearance": float(rules.get("min_copper_edge_clearance", 0.0))}
    for name, constraint, value in _DRU_RULE.findall(dru_text or ""):
        key = _DRU_FIELDS.get(constraint)
        if key and name == constraint:
            out[key] = max(out[key], float(value))
    return out


def router_rules(pro_text: str, dru_text: str | None) -> RouterRules:
    raw = _raw_rules(pro_text, dru_text)
    gap = raw["via_drill"] + 2 * (raw["hole_clearance"] - raw["min_clearance"])
    if gap > raw["via_diameter"] + 1e-9:
        raw["via_diameter"] = _ceil(gap)
    return RouterRules(*(_r(raw[k]) for k in ("track_width", "clearance", "via_diameter", "via_drill", "min_track",
                                              "min_clearance", "hole_clearance", "hole_to_hole", "edge_clearance")))


def fab_overrides_text(rules: RouterRules) -> str:
    """KiCadRoutingTools' --fab-overrides file: the board's floors, so it never drops below them."""
    rows = [("track_width", rules.min_track), ("clearance", rules.min_clearance),
            ("via_diameter", rules.via_diameter), ("via_drill", rules.via_drill), ("hole_to_hole", rules.hole_to_hole)]
    return "".join(f"{k} = {num(v)}\n" for k, v in rows)


def _net_class(pro: dict, net: str) -> dict:
    by_name = {c.get("name"): c for c in _classes(pro)}
    for pat in (pro.get("net_settings") or {}).get("netclass_patterns") or []:
        if fnmatch.fnmatchcase(net, str(pat.get("pattern", ""))) and pat.get("netclass") in by_name:
            return by_name[pat["netclass"]]
    return _default_class(pro)


def net_class_widths(pro_text: str, nets: Iterable[str]) -> dict[str, float]:
    pro = json.loads(pro_text)
    return {n: _r(_net_class(pro, n).get("track_width", 0.25)) for n in nets}


# --- the board -----------------------------------------------------------------------------------------------


@dataclass
class _Fp:
    ref: str
    smd: list[tuple[float, float, float, float]]  # local x, y, w, h


def _footprints(root) -> list[_Fp]:
    from ..pcb.copper import footprint_ref

    out = []
    for n in find_all(root, "footprint"):
        smd = []
        for pad in find_all(n, "pad"):
            if str(pad[2]) != "smd":
                continue
            at, size = find(pad, "at"), find(pad, "size")
            smd.append((float(at[1]), float(at[2]), float(size[1]), float(size[2])))
        out.append(_Fp(footprint_ref(n), smd))
    return out


def _min_pitch(fp: _Fp) -> float:
    """The smallest centre distance between two SMD pads of a footprint."""
    pads = sorted(fp.smd)
    best = math.inf
    for i, a in enumerate(pads):
        for b in pads[i + 1:]:
            if b[0] - a[0] >= best:
                break
            best = min(best, math.hypot(b[0] - a[0], b[1] - a[1]))
    return best


def _fanout(fp: _Fp, rules: RouterRules) -> FanoutStep | None:
    if len(fp.smd) < FANOUT_MIN_PADS:
        return None
    xs, ys = [p[0] for p in fp.smd], [p[1] for p in fp.smd]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    sides = {
        "left": [p for p in fp.smd if p[0] - x0 <= SIDE_TOLERANCE],
        "right": [p for p in fp.smd if x1 - p[0] <= SIDE_TOLERANCE],
        "top": [p for p in fp.smd if p[1] - y0 <= SIDE_TOLERANCE],
        "bottom": [p for p in fp.smd if y1 - p[1] <= SIDE_TOLERANCE],
    }
    if any(len(v) < FANOUT_MIN_PER_SIDE for v in sides.values()):
        return None
    pitch = math.inf
    for name, pads in sides.items():
        axis = 1 if name in ("left", "right") else 0
        along = sorted(p[axis] for p in pads)
        pitch = min([pitch] + [b - a for a, b in zip(along, along[1:]) if b - a > 1e-6])
    if pitch > FANOUT_MAX_PITCH + 1e-9:
        return None
    narrow = min(min(p[2], p[3]) for v in sides.values() for p in v)
    width = max(rules.min_track, min(rules.track_width, narrow))
    return FanoutStep(fp.ref, _r(pitch), _r(width), rules.min_clearance)


def _fill_zones(root, layers: Sequence[str]) -> dict[str, list[str]]:
    from ..pcb.copper import expand_layers

    out: dict[str, list[str]] = defaultdict(list)
    for z in find_all(root, "zone"):
        if find(z, "keepout") is not None:
            continue
        net = find(z, "net")
        if net is None or not str(net[-1]):
            continue
        lay = find(z, "layers") or find(z, "layer")
        for name in expand_layers([str(v) for v in lay[1:]], layers) if lay else ():
            if name not in out[str(net[-1])]:
                out[str(net[-1])].append(name)
    return {k: sorted(v, key=list(layers).index) for k, v in out.items()}


def _done_nets(copper: Copper) -> set[str]:
    """Nets whose pads are all joined already by kept (locked) copper."""
    keep = Copper([t for t in copper.tracks if t.locked], [a for a in copper.arcs if a.locked],
                  [v for v in copper.vias if v.locked], copper.pads, [], copper.layers)
    if not (keep.tracks or keep.arcs or keep.vias):
        return set()
    items = items_of(keep)
    near = contact_map(items)
    comp = [-1] * len(items)
    for start in range(len(items)):
        if comp[start] >= 0:
            continue
        comp[start], stack = start, [start]
        while stack:
            k = stack.pop()
            for j in near[k]:
                if comp[j] < 0:
                    comp[j] = start
                    stack.append(j)
    pads_by_net: dict[str, set[int]] = defaultdict(set)
    for k, it in enumerate(items):
        if it.kind == "pad" and it.net:
            pads_by_net[it.net].add(comp[k])
    counts = _pad_counts(copper)
    return {n for n, comps in pads_by_net.items() if len(comps) == 1 and counts.get(n, 0) >= 2}


def _pad_counts(copper: Copper) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for p in copper.pads:
        if p.net:
            counts[p.net] += 1
    return counts


def board_box(board_text: str) -> tuple[float, float, float, float]:
    """The bounding box of the board's Edge.Cuts drawings, board mm."""
    root = parse(board_text)
    pts: list[Point] = []
    for n in root[1:]:
        if isinstance(n, list) and n and str(n[0]).startswith("gr_"):
            lay = find(n, "layer")
            if lay is None or str(lay[1]) != "Edge.Cuts":
                continue
            for k in ("start", "end", "mid", "center"):
                c = find(n, k)
                if c is not None:
                    pts.append(from_kicad(float(c[1]), float(c[2])))
            ps = find(n, "pts")
            if ps is not None:
                pts += [from_kicad(float(p[1]), float(p[2])) for p in ps[1:] if p[0] == "xy"]
    if not pts:
        copper = read_copper(board_text)
        pts = [q for p in copper.pads for q in p.polygon] or [(0.0, 0.0)]
    return (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))


def hole_keepouts(copper: Copper, rules: RouterRules) -> list[RouterKeepout]:
    """A router keep-out round every hole without copper of a net (NPTH), so tracks keep the hole clearance."""
    out = []
    seen: dict[str, int] = defaultdict(int)
    for p in sorted(copper.pads, key=lambda p: (p.ref, p.number)):
        if p.net is not None or not p.through or not p.drill:
            continue
        seen[p.ref] += 1
        name = f"{ROUTER_PREFIX}hole:{p.ref}" + (f"#{seen[p.ref]}" if seen[p.ref] > 1 else "")
        r = p.drill / 2 + rules.hole_clearance + rules.track_width / 2
        poly = [(_r(x), _r(y)) for x, y in circle_polygon(p.centre[0], p.centre[1], r, 16)]
        out.append(RouterKeepout(name, poly, list(copper.layers)))
    return out


def graphic_keepouts(board_text: str, rules: RouterRules) -> list[RouterKeepout]:
    """Router keep-outs over copper drawn in a footprint with no net (an antenna, a shield outline): the router does
    not see it, and a via there would short it. Vias are kept out always; tracks too, unless the drawing touches one of
    the footprint's own pads (a feed must reach it). Each drawing's box is grown by the clearance and half a via."""
    from ..geometry import polygons_overlap
    from ..pcb.copper import footprint_ref, read_copper
    from ..pcb.footprint import rotate

    root = parse(board_text)
    layers = board_layers(root)
    pads = read_copper(board_text).pads
    grow = rules.clearance + rules.via_diameter / 2
    out = []
    for fp in find_all(root, "footprint"):
        ref = footprint_ref(fp)
        at = find(fp, "at")
        X, Y = float(at[1]), float(at[2])
        A = float(at[3]) if len(at) > 3 else 0.0
        k = 0
        for g in fp[1:]:
            if not (isinstance(g, list) and g and str(g[0]) in ("fp_poly", "fp_rect")):
                continue
            lay = find(g, "layer")
            if lay is None or str(lay[1]) not in layers or find(g, "net") is not None:
                continue
            fill = find(g, "fill")
            if fill is None or str(fill[1]) not in ("yes", "solid"):
                continue
            if str(g[0]) == "fp_rect":
                (sx, sy), (ex, ey) = (float(v) for v in find(g, "start")[1:3]), (float(v) for v in find(g, "end")[1:3])
                local = [(sx, sy), (ex, sy), (ex, ey), (sx, ey)]
            else:
                local = [(float(p[1]), float(p[2])) for p in find(g, "pts")[1:] if p[0] == "xy"]
            world = [from_kicad(X + dx, Y + dy) for dx, dy in (rotate(px, py, A) for px, py in local)]
            if len(world) < 3:
                continue
            k += 1
            own = [p.polygon for p in pads if p.ref == ref and p.polygon]
            touches = any(polygons_overlap(world, q) for q in own)
            x0, x1 = min(p[0] for p in world) - grow, max(p[0] for p in world) + grow
            y0, y1 = min(p[1] for p in world) - grow, max(p[1] for p in world) + grow
            poly = [(_r(x0), _r(y0)), (_r(x1), _r(y0)), (_r(x1), _r(y1)), (_r(x0), _r(y1))]
            out.append(RouterKeepout(f"{ROUTER_PREFIX}graphic:{ref}#{k}", poly, [str(lay[1])], not touches))
    return out


def region_keepouts(region: tuple[float, float, float, float], board_box: tuple[float, float, float, float],
                    layers: list[str]) -> list[RouterKeepout]:
    """Keep-outs over the whole board but `region`: up to four rectangles round it."""
    bx0, by0, bx1, by1 = board_box[0] - 1, board_box[1] - 1, board_box[2] + 1, board_box[3] + 1
    rx0, ry0 = max(region[0], bx0), max(region[1], by0)
    rx1, ry1 = min(region[2], bx1), min(region[3], by1)
    rects = [(bx0, by0, rx0, by1), (rx1, by0, bx1, by1), (rx0, by0, rx1, ry0), (rx0, ry1, rx1, by1)]
    out = []
    for x0, y0, x1, y1 in rects:
        if x1 - x0 > 1e-6 and y1 - y0 > 1e-6:
            poly = [(_r(x0), _r(y0)), (_r(x1), _r(y0)), (_r(x1), _r(y1)), (_r(x0), _r(y1))]
            out.append(RouterKeepout(f"{ROUTER_PREFIX}region:{len(out) + 1}", poly, list(layers)))
    return out


def _rule_area(k: RouterKeepout) -> list:
    S = Sym
    lay = [S("layers"), *k.layers] if len(k.layers) > 1 else [S("layer"), k.layers[0]]
    pts = [S("pts"), *[[S("xy"), num(X), num(Y)] for X, Y in (to_kicad(*p) for p in k.polygon)]]
    return [S("zone"), lay, [S("uuid"), ids.uid("router", k.name)], [S("name"), k.name],
            [S("hatch"), S("full"), num(0.5)], [S("connect_pads"), [S("clearance"), num(0)]],
            [S("min_thickness"), num(0.25)],
            [S("keepout"), [S("tracks"), S("not_allowed" if k.forbid_tracks else "allowed")],
             [S("vias"), S("not_allowed")], [S("pads"), S("allowed")],
             [S("copperpour"), S("allowed")], [S("footprints"), S("allowed")]],
            [S("placement"), [S("enabled"), S("no")], [S("sheetname"), ""]],
            [S("fill"), [S("thermal_gap"), num(0.5)], [S("thermal_bridge_width"), num(0.5)]],
            [S("polygon"), pts]]


def _corridor_uuids(n: int) -> set[str]:
    return {ids.uid("router", "corridor", str(k)) for k in range(n)}


def add_router_items(board_text: str, keepouts: Sequence[RouterKeepout], corridor: Sequence[Point] | None = None) -> str:
    S = Sym
    root = parse(board_text)
    body = list(root[1:])
    lines = []
    for k, (a, b) in enumerate(zip(corridor or [], list(corridor or [])[1:])):
        (X0, Y0), (X1, Y1) = to_kicad(*a), to_kicad(*b)
        lines.append([S("gr_line"), [S("start"), num(X0), num(Y0)], [S("end"), num(X1), num(Y1)],
                      [S("stroke"), [S("width"), num(0.1)], [S("type"), S("default")]], [S("layer"), CORRIDOR_LAYER],
                      [S("uuid"), ids.uid("router", "corridor", str(k))]])
    at = next((i for i, n in enumerate(body) if isinstance(n, list) and n and str(n[0]) in
               ("segment", "arc", "via", "zone", "group", "embedded_fonts")), len(body))
    body[at:at] = lines
    tail = next((i for i, n in enumerate(body) if isinstance(n, list) and n and str(n[0]) in
                 ("group", "generated", "embedded_fonts", "embedded_files")), len(body))
    body[tail:tail] = [_rule_area(k) for k in keepouts]
    return dump([root[0], *body]) + "\n"


def strip_router_items(board_text: str, prefix: str = ROUTER_PREFIX) -> str:
    root = parse(board_text)
    n_lines = sum(1 for n in root[1:] if isinstance(n, list) and n and str(n[0]) == "gr_line")
    corridor = _corridor_uuids(n_lines)
    out = [root[0]]
    for n in root[1:]:
        if isinstance(n, list) and n:
            if str(n[0]) == "zone":
                name = find(n, "name")
                if name is not None and str(name[1]).startswith(prefix):
                    continue
            if str(n[0]) == "gr_line":
                u = find(n, "uuid")
                if u is not None and str(u[1]) in corridor:
                    continue
        out.append(n)
    return dump(out) + "\n"


# --- the plan ------------------------------------------------------------------------------------------------


def plan_route(board_text: str, pro_text: str, dru_text: str | None, *, pairs: Sequence[PairSpec] = (),
               hints: Sequence[RouteHint] = (), planes: Mapping[str, Sequence[str]] | None = None) -> RoutePlan:
    root = parse(board_text)
    copper = read_copper(board_text)
    layers = board_layers(root)
    rules = router_rules(pro_text, dru_text)
    raw = _raw_rules(pro_text, dru_text)
    pro = json.loads(pro_text)
    warnings: list[Finding] = []
    if rules.via_diameter > raw["via_diameter"] + 1e-9:
        warnings.append(Finding(
            "router", "via_grown", "info",
            f"routed vias are {num(rules.via_diameter)} mm across, not {num(raw['via_diameter'])} mm, so each hole "
            f"keeps the board's {num(rules.hole_clearance)} mm hole clearance (the router keeps copper clearance only)"))

    footprints = sorted(_footprints(root), key=lambda f: f.ref)
    fanout = [s for s in (_fanout(fp, rules) for fp in footprints) if s]
    # pads 0.5 mm apart sit between the points of a 0.1 mm grid: the router needs 0.05 mm to reach them
    grid = 0.05 if any(_min_pitch(fp) <= FINE_PITCH + 1e-9 for fp in footprints) else 0.1

    counts = _pad_counts(copper)
    routable = {n for n, c in counts.items() if c >= 2}
    if planes is None:
        plane_map = _fill_zones(root, layers) if len(layers) >= 4 else {}
    else:
        plane_map = {n: list(v) for n, v in planes.items()}
    plane_steps = [PlaneStep(n, list(plane_map[n])) for n in sorted(plane_map) if n in counts]

    pair_steps = []
    for p in pairs:
        if p.positive not in counts or p.negative not in counts:
            warnings.append(Finding("router", "diff_pair_unknown", "warning",
                                    f"diff_pair {p.name} (board.py line {p.line}): {p.positive} or {p.negative} has no "
                                    "pads on the board; the pair was left out"))
            continue
        cls = _net_class(pro, p.positive)
        pair_steps.append(PairStep(p.name, p.positive, p.negative,
                                   _r(p.width if p.width is not None else cls.get("track_width", rules.track_width)),
                                   _r(p.gap if p.gap is not None else cls.get("clearance", rules.clearance))))
    pair_nets = {n for s in pair_steps for n in (s.positive, s.negative)}
    done = _done_nets(copper)
    planes_set = {s.net for s in plane_steps}
    signals = sorted(n for n in routable if n not in planes_set and n not in pair_nets and n not in done)
    widths = net_class_widths(pro_text, signals)
    power = [PowerNet(n, widths[n]) for n in signals if widths[n] > rules.track_width + 1e-9]

    locked_nets = {t.net for t in copper.tracks if t.locked} | {a.net for a in copper.arcs if a.locked} | \
                  {v.net for v in copper.vias if v.locked}
    rippable = sorted((set(signals) | pair_nets) - locked_nets)
    hint_steps = []
    for h in hints:
        if h.net not in counts:
            warnings.append(Finding("router", "route_hint_unknown", "warning",
                                    f"route_hint {h.net} (board.py line {h.line}): no net {h.net} has pads on the "
                                    "board; the hint was left out"))
            continue
        rip = sorted({n for pat in h.rip for n in rippable if n != h.net and fnmatch.fnmatchcase(n, pat)})
        hint_steps.append(HintStep(h.net, None if h.region is None else tuple(_r(v) for v in h.region),
                                   None if h.layers is None else list(h.layers),
                                   None if h.corridor is None else [(_r(x), _r(y)) for x, y in h.corridor],
                                   rip, h.line))
    return RoutePlan(layers, rules, grid, fanout, pair_steps, plane_steps, power, signals, hint_steps,
                     hole_keepouts(copper, rules) + graphic_keepouts(board_text, rules), warnings)


def plan_for_build(build_dir: Path) -> RoutePlan:
    build_dir = Path(build_dir)
    circuit = Circuit.from_json((build_dir / "circuit.json").read_text(encoding="utf-8"))
    dru = build_dir / "board.kicad_dru"
    return plan_route((build_dir / "board.kicad_pcb").read_text(encoding="utf-8"),
                      (build_dir / "board.kicad_pro").read_text(encoding="utf-8"),
                      dru.read_text(encoding="utf-8") if dru.exists() else None,
                      pairs=circuit.pairs, hints=circuit.route_hints)
