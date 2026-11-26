"""The route key: a hash of what the copper depends on, so a route is reused only for the board it was made for.

Each part is the sha256 of a canonical text (UUIDs, fills, silkscreen, values and formatting left out):
nets by pad, placement, footprint pads, the outline, zones and rule areas, kept (locked) copper, the rules,
the routing instructions (the plan without its rules and warnings), and the router and kernel versions. The
reference labels are a part too, though the copper does not depend on them: the routed board is the build's board
with the copper on it, and its DRC checks the labels, so a label moved by board.py needs that board made again.
The key is the first 12 hex of the sha256 over the parts.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from .. import __version__
from ..coords import from_kicad
from ..pcb.copper import COPPER_KINDS, _locked, _signature, footprint_ref
from ..sexpr import dump, find, find_all, num, parse
from .krt import ROUTER_ID
from .plan import RoutePlan

PARTS = ("nets", "placement", "footprints", "outline", "zones", "kept", "rules", "plan", "router", "labels")
REASONS = {"nets": "connections changed", "placement": "parts moved", "footprints": "footprints changed",
           "outline": "outline changed", "zones": "zones or keep-outs changed", "kept": "kept copper changed",
           "rules": "rules changed", "plan": "routing instructions changed",
           "router": "router or kernel version changed", "labels": "labels moved"}


@dataclass(frozen=True)
class RouteKey:
    key: str
    parts: dict[str, str]

    def to_json(self) -> str:
        return json.dumps({"key": self.key, "parts": self.parts}, indent=1, sort_keys=True) + "\n"

    @staticmethod
    def from_json(text: str) -> "RouteKey":
        d = json.loads(text)
        return RouteKey(str(d["key"]), {str(k): str(v) for k, v in d["parts"].items()})


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _strip(node, drop=("uuid", "tstamp", "filled_polygon")):
    if not isinstance(node, list):
        return node
    return [_strip(c, drop) for c in node if not (isinstance(c, list) and c and str(c[0]) in drop)]


def _canon(node) -> str:
    return dump(_strip(node)).replace("\n", " ")


def _parts(board_text: str, pro_text: str, dru_text: str | None, plan: RoutePlan, router_id: str,
           kernel_version: str) -> dict[str, str]:
    root = parse(board_text)
    nets, placement, footprints, outline, zones, kept, labels = [], [], [], [], [], [], []
    for n in root[1:]:
        if not isinstance(n, list) or not n:
            continue
        kind = str(n[0])
        if kind == "footprint":
            ref = footprint_ref(n)
            at = find(n, "at")
            A = float(at[3]) if len(at) > 3 else 0.0
            x, y = from_kicad(float(at[1]), float(at[2]))
            side = "back" if str(find(n, "layer")[1]) == "B.Cu" else "front"
            placement.append(f"{ref} at {num(x)} {num(y)} {num(A % 360)} {side}")
            pads = []
            for pad in find_all(n, "pad"):
                net = find(pad, "net")
                if net is not None and str(net[-1]):
                    nets.append(f"{ref}.{pad[1]}={net[-1]}")
                p = _strip([c for c in pad if not (isinstance(c, list) and c and str(c[0]) in ("net", "at"))])
                pat = find(pad, "at")
                local = (float(pat[3]) if len(pat) > 3 else 0.0) - A
                pads.append(f"{dump(p).replace(chr(10), ' ')} at {pat[1]} {pat[2]} {num(local % 360)}")
            footprints.append(f"{ref} {n[1]} " + "; ".join(sorted(pads)))
            labels += [f"{ref} {_canon(p)}" for p in find_all(n, "property") if len(p) > 1 and p[1] == "Reference"]
        elif kind.startswith("gr_") and find(n, "layer") is not None and str(find(n, "layer")[1]) == "Edge.Cuts":
            outline.append(_canon(n))
        elif kind == "zone":
            zones.append(_canon(n))
        elif kind in COPPER_KINDS and _locked(n):
            kept.append(repr(_signature(n)))
    pro = json.loads(pro_text)
    rules = json.dumps({"design_settings": (pro.get("board") or {}).get("design_settings"),
                        "net_settings": pro.get("net_settings")}, sort_keys=True) + "\n" + (dru_text or "")
    plan_d = plan.to_dict()
    plan_d.pop("rules", None)
    plan_d.pop("warnings", None)
    texts = {
        "nets": "\n".join(sorted(nets)), "placement": "\n".join(sorted(placement)),
        "footprints": "\n".join(sorted(footprints)), "outline": "\n".join(sorted(outline)),
        "zones": "\n".join(sorted(zones)), "kept": "\n".join(sorted(kept)), "rules": rules,
        "plan": json.dumps(plan_d, sort_keys=True), "router": f"{router_id}\n{kernel_version}",
        "labels": "\n".join(sorted(labels)),
    }
    return {k: _sha(texts[k]) for k in PARTS}


def route_key(board_text: str, pro_text: str, dru_text: str | None, plan: RoutePlan, *, router_id: str = ROUTER_ID,
              kernel_version: str = __version__) -> RouteKey:
    parts = _parts(board_text, pro_text, dru_text, plan, router_id, kernel_version)
    key = _sha("".join(f"{k}={parts[k]}\n" for k in PARTS))[:12]
    return RouteKey(key, parts)


def stale_reasons(old: RouteKey, new: RouteKey) -> list[str]:
    """Why the copper is stale. Labels moved is said only when nothing else changed: a part that moves takes its
    neighbours' labels with it."""
    changed = [k for k in PARTS if old.parts.get(k) != new.parts.get(k)]
    if len(changed) > 1 and "labels" in changed:
        changed.remove("labels")
    return [REASONS[k] for k in changed]
