"""What a release (schema pino.release/1) tells the app and the agent."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from ..findings import SEVERITIES, Finding
from ..result import MAX_FINDINGS, MAX_HEADLINE, MAX_MESSAGE, Timing, cut

RELEASE_SCHEMA = "pino.release/1"
STATES = ("released", "unchanged", "refused", "failed", "cancelled", "busy")
COUNT_KEYS = ("assembled", "bom_lines", "hand_fit", "dnp", "basic", "preferred", "extended", "easyeda", "gerbers",
              "drills")


def empty_counts() -> dict[str, int]:
    return {k: 0 for k in COUNT_KEYS}


def order_and_cap(findings: list[Finding]) -> tuple[list[Finding], int]:
    """Errors first, then warnings and infos, each in the order they were found: the first error is the headline's."""
    ranked = sorted(findings, key=lambda f: SEVERITIES.index(f.severity) if f.severity in SEVERITIES else 9)
    kept = [Finding(f.source, f.code, f.severity, cut(f.message, MAX_MESSAGE), f.at, f.refs, f.pins, f.nets)
            for f in ranked[:MAX_FINDINGS]]
    return kept, max(0, len(ranked) - MAX_FINDINGS)


@dataclass
class ReleaseResult:
    schema: str
    kernel_version: str
    state: str
    version: str | None = None
    previous: str | None = None
    bump: str | None = None
    why: list[str] = field(default_factory=list)
    build: dict | None = None
    route: dict | None = None
    folder: str | None = None
    files: list[dict] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=empty_counts)
    findings: list[Finding] = field(default_factory=list)
    truncated: int = 0
    headline: str = ""
    timings: list[Timing] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"schema": self.schema, "kernel_version": self.kernel_version, "state": self.state,
                "version": self.version, "previous": self.previous, "bump": self.bump, "why": list(self.why),
                "build": self.build, "route": self.route, "folder": self.folder, "files": list(self.files),
                "counts": dict(self.counts), "findings": [f.to_json() for f in self.findings],
                "truncated": self.truncated, "headline": cut(self.headline, MAX_HEADLINE),
                "timings": [t.to_json() for t in self.timings]}

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"

    @staticmethod
    def from_json(text: str) -> "ReleaseResult":
        d = json.loads(text)
        if d.get("schema") != RELEASE_SCHEMA:
            raise ValueError(f"release result schema {d.get('schema')!r} is not {RELEASE_SCHEMA}")
        return ReleaseResult(
            d["schema"], d["kernel_version"], d["state"], d["version"], d["previous"], d["bump"], d["why"], d["build"],
            d["route"], d["folder"], d["files"], d["counts"], [Finding.from_json(f) for f in d["findings"]],
            d["truncated"], d["headline"], [Timing(t["step"], t["seconds"], t.get("cached", False))
                                            for t in d["timings"]])
