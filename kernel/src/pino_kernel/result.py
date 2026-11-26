"""The build result: what the engine tells the app and the agent about one build (schema pino.build/1)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from .findings import SEVERITIES, Finding

SCHEMA = "pino.build/1"
MAX_FINDINGS = 200
MAX_MESSAGE = 300
MAX_CHANGES = 50
MAX_HEADLINE = 160
VERDICTS = ("ok", "errors", "failed")
COUNT_KEYS = ("errors", "warnings", "infos", "parts", "nets", "unrouted", "crossings")


@dataclass
class Timing:
    step: str
    seconds: float
    cached: bool = False

    def to_json(self) -> dict:
        out = {"step": self.step, "seconds": round(self.seconds, 3)}
        if self.cached:
            out["cached"] = True
        return out


@dataclass
class BuildResult:
    schema: str
    kernel_version: str
    kicad_cli: str | None
    number: int
    hash: str | None
    verdict: str
    headline: str
    counts: dict[str, int]
    findings: list[Finding]
    truncated: int
    artifacts: dict
    timings: list[Timing]
    changes: dict[str, list[str]]
    placement: dict | None
    waiting: list[str] = field(default_factory=list)
    cached: bool = False
    routing: dict | None = None

    def to_dict(self) -> dict:
        return {
            "schema": self.schema, "kernel_version": self.kernel_version, "kicad_cli": self.kicad_cli,
            "number": self.number, "hash": self.hash, "verdict": self.verdict, "headline": self.headline,
            "counts": dict(self.counts), "findings": [f.to_json() for f in self.findings],
            "truncated": self.truncated, "artifacts": self.artifacts,
            "timings": [t.to_json() for t in self.timings], "changes": self.changes,
            "placement": self.placement, "waiting": list(self.waiting), "cached": self.cached,
            "routing": self.routing,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=1, sort_keys=True, ensure_ascii=False) + "\n"

    @staticmethod
    def from_json(text: str) -> "BuildResult":
        d = json.loads(text)
        if d.get("schema") != SCHEMA:
            raise ValueError(f"build result schema {d.get('schema')!r} is not {SCHEMA}")
        return BuildResult(
            d["schema"], d["kernel_version"], d["kicad_cli"], d["number"], d["hash"], d["verdict"], d["headline"],
            d["counts"], [Finding.from_json(f) for f in d["findings"]], d["truncated"], d["artifacts"],
            [Timing(t["step"], t["seconds"], t.get("cached", False)) for t in d["timings"]], d["changes"],
            d["placement"], d.get("waiting", []), d.get("cached", False), d.get("routing"))


def cut(text: str, most: int) -> str:
    return text if len(text) <= most else text[: most - 1] + "…"


def plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def headline(number: int, verdict: str, counts: dict[str, int], problem: str | None) -> str:
    if verdict == "failed":
        text = f"On h{number}: {problem or 'the build failed'}"
    else:
        bits = [plural(counts.get("errors", 0), "error"), plural(counts.get("warnings", 0), "warning")]
        if counts.get("unrouted"):
            bits.append(f"{counts['unrouted']} unrouted")
        text = f"On h{number}: " + ", ".join(bits)
    return cut(text, MAX_HEADLINE)


def sort_and_cap(findings: list[Finding]) -> tuple[list[Finding], int]:
    order = {s: i for i, s in enumerate(SEVERITIES)}
    ranked = sorted(findings, key=lambda f: (order.get(f.severity, 9), f.source, f.code, f.message))
    kept = []
    for f in ranked[:MAX_FINDINGS]:
        if len(f.message) > MAX_MESSAGE:
            f = Finding(f.source, f.code, f.severity, cut(f.message, MAX_MESSAGE), f.at, f.refs, f.pins, f.nets)
        kept.append(f)
    return kept, max(0, len(ranked) - MAX_FINDINGS)


def cap_changes(changes: dict[str, list[str]]) -> dict[str, list[str]]:
    out = {}
    for k, lines in changes.items():
        lines = [cut(line, MAX_MESSAGE) for line in lines]
        if len(lines) > MAX_CHANGES:
            lines = lines[: MAX_CHANGES - 1] + [f"and {len(lines) - MAX_CHANGES + 1} more"]
        out[k] = lines
    return out
