"""`pino-kernel parts` and serve's parts op: jlcsearch's answers as one pino.parts/1 result."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from ..findings import Finding
from ..result import MAX_HEADLINE, cut
from .cache import PartsCache, parts_root
from .jlcsearch import Jlcsearch, JlcSearchError, PartLookup
from .model import PartInfo, normalize_lcsc
from .resolve import NoMapping, PartNotCached, resolve
from .transport import transport_from_env

PARTS_SCHEMA = "pino.parts/1"
ACTIONS = ("search", "get", "fetch", "refresh")
LOOKUP_BUDGET = 30.0  # seconds for a command that only looks parts up


@dataclass
class PartsResult:
    kind: str
    query: dict
    parts: list[PartInfo] = field(default_factory=list)
    resolved: list[dict] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)
    source: dict = field(default_factory=dict)
    headline: str = ""
    schema: str = PARTS_SCHEMA

    def to_dict(self) -> dict:
        return {"schema": self.schema, "kind": self.kind, "query": self.query,
                "parts": [p.to_json() for p in self.parts], "resolved": self.resolved,
                "findings": [f.to_json() for f in self.findings], "source": self.source,
                "headline": cut(self.headline, MAX_HEADLINE)}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def client_from_env(timeout: float = 8.0) -> Jlcsearch:
    return Jlcsearch(transport_from_env(), PartsCache(parts_root()), timeout=timeout)


def _day(info: PartInfo) -> str:
    return (info.checked_at or info.fetched_at)[:10]


def _stock_words(info: PartInfo) -> str:
    words = "stock not known" if info.stock is None else f"stock {info.stock:,}"
    return f"{words} (checked {_day(info)})"


def _project_numbers(project: Path) -> list[str]:
    from ..circuit import Circuit
    from ..routing.job import latest_build

    build = latest_build(project)
    if build is None:
        raise ValueError("no build yet: save board.py first")
    circuit = Circuit.from_json((project / ".pino" / "build" / build / "circuit.json").read_text(encoding="utf-8"))
    found = []
    for part in circuit.parts:
        try:
            found.append(normalize_lcsc(part.lcsc))
        except ValueError:
            continue  # no number, or not a JLC one: the build's checks say so
    return list(dict.fromkeys(found))


def _resolved(cache: PartsCache, lcsc: str) -> dict:
    """What board.py gets when it names only this number."""
    try:
        found = resolve(lcsc, cache)
    except (NoMapping, PartNotCached):
        return {"lcsc": lcsc, "how": None, "symbol": None, "footprint": None,
                "notes": ["no KiCad mapping: pass symbol= and footprint= in board.py"]}
    return {"lcsc": lcsc, "how": found.how, "symbol": found.symbol, "footprint": found.footprint,
            "notes": found.notes}


def _looked_up(result: PartsResult, lookups: dict[str, PartLookup]) -> int:
    """Fills parts, findings, source and the headline from lookups by number; gives the exit code."""
    missing: list[str] = []
    unanswered: list[str] = []
    errors: list[str] = []
    for lcsc, lookup in lookups.items():
        if lookup.error:
            errors.append(lookup.error)
        if lookup.info is not None:
            result.parts.append(lookup.info)
        elif lookup.error is None:
            missing.append(lcsc)
            result.findings.append(Finding("parts", "part_unknown", "error", f"JLC has no part {lcsc}"))
        else:
            unanswered.append(lcsc)
    if errors:
        result.findings.append(Finding("parts", "parts_unavailable", "warning", errors[0]))
    fetched = [p.fetched_at for p in result.parts]
    result.source["fresh"] = not errors
    result.source["fetched_at"] = min(fetched) if fetched else None
    if unanswered and not result.parts and not missing:
        result.headline = f"Parts: {errors[0]}"
        return 2
    if errors:
        since = f"stock from {min(p.fetched_at for p in result.parts)[:10]}" if result.parts else "no stock cached"
        result.headline = f"Parts: jlcsearch could not be reached; {since}"
    elif result.kind == "get" and missing:
        result.headline = f"Parts: JLC has no part {missing[0]}"
    elif result.kind == "get":
        p = result.parts[0]
        result.headline = f"Parts: {p.lcsc} is {p.klass}, {p.package}, {_stock_words(p)}"
    else:
        tail = f", {len(missing)} unknown to JLC" if missing else ""
        result.headline = f"Parts: {len(result.parts)} looked up{tail}, stock from jlcsearch now"
    return 0


def run_parts(action: str, *, q: str | None = None, lcsc: Sequence[str] | None = None, package: str | None = None,
              basic: bool = False, preferred: bool = False, limit: int = 8,
              project: Path | None = None) -> tuple[PartsResult, int]:
    """(the result, the exit code): 2 when the request is wrong, or jlcsearch could not answer and nothing was
    cached."""
    client = client_from_env()
    result = PartsResult(action, {}, source={"url": client.base, "fresh": False, "fetched_at": None})
    try:
        if action == "search":
            result.query = {"q": q, "package": package, "basic": basic, "preferred": preferred, "limit": limit}
            result.parts = client.search(q, package=package, basic=basic, preferred=preferred, limit=limit)
            only = [w for w, on in (("basic only", basic), ("preferred only", preferred),
                                    (f"package {package}", package)) if on]
            filters = f" ({', '.join(only)})" if only else ""
            result.source.update(fresh=True, fetched_at=client.cache.now().isoformat(timespec="seconds"))
            result.headline = f"Parts: {len(result.parts)} found for {q}{filters}, stock from jlcsearch now"
            return result, 0
        if action == "refresh":
            result.query = {"project": Path(project).name}
            numbers = _project_numbers(Path(project))
            lookups = {}
            if numbers:
                # a refresh asks again: forget how young the cache is
                client.cache.fresh = lambda _lcsc: None
                lookups = client.parts(numbers, budget=LOOKUP_BUDGET)
        else:
            numbers = [normalize_lcsc(n) for n in lcsc or []]
            result.query = {"lcsc": numbers}
            lookups = client.parts(numbers, budget=LOOKUP_BUDGET)
    except JlcSearchError as e:
        result.findings.append(Finding("parts", "parts_unavailable", "error", str(e)))
        result.headline = f"Parts: {e}"
        return result, 2
    except (ValueError, OSError) as e:
        result.findings.append(Finding("parts", "parts_request", "error", str(e)))
        result.headline = f"Parts: {e}"
        return result, 2
    code = _looked_up(result, lookups)
    if action in ("get", "fetch"):
        result.resolved = [_resolved(client.cache, p.lcsc) for p in result.parts]
    return result, code


def parts_argv(req: dict) -> list[str]:
    """serve's {"op": "parts", ...} as `pino-kernel parts` arguments; a missing or wrong field says what to send."""
    action = req.get("action")
    if action not in ACTIONS:
        raise ValueError("parts needs an action: search, get, fetch or refresh")
    argv = ["parts", action]
    if action == "search":
        q = req.get("q")
        if not isinstance(q, str) or not q.strip():
            raise ValueError("parts search needs q, the words to search for")
        if q.startswith("-"):
            raise ValueError("a parts search cannot start with -")
        if req.get("package"):
            argv.append(f"--package={req['package']}")
        argv += [flag for flag, key in (("--basic", "basic"), ("--preferred", "preferred")) if req.get(key)]
        if req.get("limit") is not None:
            argv.append(f"--limit={int(req['limit'])}")
        return argv + [q]
    if action == "refresh":
        project = req.get("project")
        if not isinstance(project, str) or not Path(project).is_dir():
            raise ValueError("parts refresh needs a project folder")
        return argv + [project]
    value = req.get("lcsc")
    numbers = [value] if isinstance(value, str) else value
    if not numbers or not isinstance(numbers, list):
        raise ValueError(f"parts {action} needs lcsc, such as C25804")
    if action == "get" and len(numbers) != 1:
        raise ValueError("parts get takes one lcsc; use fetch for several")
    return argv + [normalize_lcsc(n) for n in numbers]


def serve_ops(server) -> dict:
    def parts(req: dict) -> None:
        server.start_job(req, parts_argv(req))
        return None

    return {"parts": parts}
