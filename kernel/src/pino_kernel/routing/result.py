"""What a route job (schema pino.route/1) and a finishing trial (pino.trial/1) tell the app and the agent."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from ..findings import Finding
from ..result import MAX_HEADLINE, Timing, cut, plural
from .chain import StepRun

SCHEMA = "pino.route/1"
TRIAL_SCHEMA = "pino.trial/1"
STATES = ("done", "failed", "cancelled", "timed_out", "busy")
COUNT_KEYS = ("nets", "unrouted", "tracks", "vias", "track_mm", "drc_errors", "drc_warnings", "copper_errors",
              "copper_warnings")


def empty_counts() -> dict[str, int]:
    return {k: 0 for k in COUNT_KEYS}


@dataclass
class RouteResult:
    schema: str
    kernel_version: str
    router: dict
    key: str | None
    build: str | None
    number: int
    state: str
    verdict: str
    headline: str
    complete: bool
    counts: dict[str, int]
    share: dict | None
    findings: list[Finding]
    truncated: int
    steps: list[StepRun]
    timings: list[Timing]
    artifacts: dict
    cached: bool = False

    def to_dict(self) -> dict:
        return {"schema": self.schema, "kernel_version": self.kernel_version, "router": dict(self.router),
                "key": self.key, "build": self.build, "number": self.number, "state": self.state,
                "verdict": self.verdict, "headline": self.headline, "complete": self.complete,
                "counts": dict(self.counts), "share": self.share, "findings": [f.to_json() for f in self.findings],
                "truncated": self.truncated, "steps": [s.to_json() for s in self.steps],
                "timings": [t.to_json() for t in self.timings], "artifacts": dict(self.artifacts),
                "cached": self.cached}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"

    @staticmethod
    def from_json(text: str) -> "RouteResult":
        d = json.loads(text)
        if d.get("schema") != SCHEMA:
            raise ValueError(f"route result schema {d.get('schema')!r} is not {SCHEMA}")
        return RouteResult(d["schema"], d["kernel_version"], d["router"], d["key"], d["build"], d["number"],
                           d["state"], d["verdict"], d["headline"], d["complete"], d["counts"], d["share"],
                           [Finding.from_json(f) for f in d["findings"]], d["truncated"],
                           [StepRun.from_json(s) for s in d["steps"]],
                           [Timing(t["step"], t["seconds"], t.get("cached", False)) for t in d["timings"]],
                           d["artifacts"], d.get("cached", False))


def route_headline(number: int, build_number: int | None, state: str, counts: dict, share: dict | None,
                   problem: str | None) -> str:
    prefix = f"Route r{number}" + (f" (h{build_number})" if build_number else "")
    if problem:
        return cut(f"{prefix}: {problem}", MAX_HEADLINE)
    router = (share or {}).get("router") or {}
    if state == "done" and share is not None and router.get("share") is None and not counts.get("unrouted"):
        return cut(f"{prefix}: nothing to route", MAX_HEADLINE)
    bits = []
    if router:
        bits.append(f"router {router.get('routed', 0)}/{router.get('of', 0)} nets in {router.get('seconds', 0):.0f} s")
    finish = ((share or {}).get("finish") or {}).get("routed", 0)
    if finish:
        bits.append(f"finish {finish}")
    bits.append(f"{counts.get('unrouted', 0)} left")
    drc = counts.get("drc_errors", 0)
    bits.append("DRC clean" if not drc else plural(drc, "DRC error"))
    if counts.get("copper_errors"):
        bits.append(plural(counts["copper_errors"], "copper error"))
    return cut(f"{prefix}: " + ", ".join(bits), MAX_HEADLINE)


@dataclass
class TrialResult:
    schema: str
    kind: str  # route_net | nudge | keep
    base: dict
    number: int
    ok: bool
    headline: str
    before: dict
    after: dict
    findings: list[Finding]
    truncated: int
    snippet: str
    replaces_line: int | None
    artifacts: dict
    seconds: float

    def to_dict(self) -> dict:
        return {"schema": self.schema, "kind": self.kind, "base": dict(self.base), "number": self.number,
                "ok": self.ok, "headline": self.headline, "before": dict(self.before), "after": dict(self.after),
                "findings": [f.to_json() for f in self.findings], "truncated": self.truncated,
                "snippet": self.snippet, "replaces_line": self.replaces_line, "artifacts": dict(self.artifacts),
                "seconds": round(self.seconds, 3)}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"

    @staticmethod
    def from_json(text: str) -> "TrialResult":
        d = json.loads(text)
        if d.get("schema") != TRIAL_SCHEMA:
            raise ValueError(f"trial result schema {d.get('schema')!r} is not {TRIAL_SCHEMA}")
        return TrialResult(d["schema"], d["kind"], d["base"], d["number"], d["ok"], d["headline"], d["before"],
                           d["after"], [Finding.from_json(f) for f in d["findings"]], d["truncated"], d["snippet"],
                           d["replaces_line"], d["artifacts"], d["seconds"])
