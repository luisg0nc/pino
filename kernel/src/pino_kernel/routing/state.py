"""Where routing stands for a build: current copper, a route running, stale copper (and why), or none.

Copper is only ever current for the route key it was made for; a build whose key differs sees the latest route as
stale, with the reasons, and never reuses it.
"""

from __future__ import annotations

import fcntl
from pathlib import Path

from ..result import MAX_HEADLINE, cut, plural
from .history import RouteHistory
from .key import RouteKey, stale_reasons
from .plan import plan_for_build
from .result import RouteResult


def _empty(state: str, key: str) -> dict:
    return {"state": state, "key": key, "route": None, "route_key": None, "number": None, "stale_because": [],
            "complete": None, "unrouted": None, "router_share": None, "router_seconds": None, "drc_errors": None,
            "copper_errors": None, "verdict": None}


def route_running(project: Path) -> bool:
    path = Path(project) / ".pino" / "routes" / "job.lock"
    if not path.exists():
        return False
    with open(path, "a+") as fh:
        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
    return False


def _nets_left(share: dict | None) -> int | None:
    if not share:
        return None
    return share["nets"] - share["done_before"] - share["router"]["routed"] - share["finish"]["routed"]


def routing_state(project: Path, key: RouteKey) -> dict:
    project = Path(project)
    history = RouteHistory(project)
    current = history.latest_done(key.key)
    if current is not None:
        folder = project / ".pino" / "routes" / key.key
        try:
            r = RouteResult.from_json((folder / "route.json").read_text(encoding="utf-8"))
        except (OSError, ValueError, KeyError):
            r = None
        if r is not None:
            share = r.share or {}
            out = _empty("current", key.key)
            out.update({"route": f".pino/routes/{key.key}", "route_key": key.key, "number": current.get("number"),
                        "complete": r.complete, "unrouted": r.counts.get("unrouted", 0),
                        "router_share": (share.get("router") or {}).get("share"),
                        "router_seconds": (share.get("router") or {}).get("seconds"),
                        "drc_errors": r.counts.get("drc_errors", 0), "copper_errors": r.counts.get("copper_errors", 0),
                        "verdict": r.verdict})
            return out
    latest = history.latest_done()
    if route_running(project):
        out = _empty("running", key.key)
        if latest is not None:
            out.update({"route": f".pino/routes/{latest['key']}", "route_key": latest["key"],
                        "number": latest.get("number")})
        return out
    if latest is not None:
        out = _empty("stale", key.key)
        try:
            old = RouteKey.from_json((project / ".pino" / "routes" / latest["key"] / "key.json").read_text(
                encoding="utf-8"))
            reasons = stale_reasons(old, key)
        except (OSError, ValueError, KeyError):
            reasons = []
        out.update({"route": f".pino/routes/{latest['key']}", "route_key": latest["key"],
                    "number": latest.get("number"), "stale_because": reasons or ["the board changed"]})
        return out
    return _empty("none", key.key)


def nets_left(project: Path, routing: dict) -> int | None:
    """How many nets the current route left, from its route.json."""
    if routing.get("state") != "current":
        return None
    try:
        r = RouteResult.from_json((Path(project) / routing["route"] / "route.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError):
        return None
    return _nets_left(r.share)


def build_routing(project: Path, build_dir: Path) -> dict | None:
    """routing_state for the board in a build folder, or None when the folder has no board."""
    from .key import route_key

    build_dir = Path(build_dir)
    if not (build_dir / "board.kicad_pcb").is_file() or not (build_dir / "board.kicad_pro").is_file():
        return None
    plan = plan_for_build(build_dir)
    dru = build_dir / "board.kicad_dru"
    key = route_key((build_dir / "board.kicad_pcb").read_text(encoding="utf-8"),
                    (build_dir / "board.kicad_pro").read_text(encoding="utf-8"),
                    dru.read_text(encoding="utf-8") if dru.is_file() else None, plan)
    return routing_state(project, key)


def clause(routing: dict) -> str:
    state = routing["state"]
    if state == "current":
        drc = routing.get("drc_errors") or 0
        return f"; routed r{routing['number']}, {routing.get('unrouted') or 0} left, " + \
            ("DRC clean" if not drc else plural(drc, "DRC error"))
    if state == "running":
        return "; routing"
    if state == "stale":
        return f"; copper stale ({', '.join(routing['stale_because'])})"
    return ""


def waiting(routing: dict, left: int | None = None) -> list[str]:
    state = routing["state"]
    if state == "none":
        return ["routing: not started"]
    if state == "running":
        return ["routing: running"]
    if state == "stale":
        return [f"routing: stale ({', '.join(routing['stale_because'])})"]
    if left is None:
        left = 0 if routing.get("complete") else 1
    if not routing.get("complete") or left:
        left = max(left, 1)
        return [f"routing: {plural(left, 'net')} left"]
    return []


def with_headline(base: str, routing: dict) -> str:
    return cut(base + clause(routing), MAX_HEADLINE)
