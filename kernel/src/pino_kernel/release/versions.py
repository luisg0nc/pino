"""Release versions and what changed between them.

The first release of a board is 1.0.0. After that, a change to the circuit (parts, values, footprints, LCSC numbers,
what is fitted, or which pins share a net) is a minor release, and any other change to the fab files is a patch. The
same files make no new release. Net names are not part of the circuit: nets are compared by their pins.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Mapping

from ..circuit import Circuit
from ..symbols import natural

FIRST_VERSION = "1.0.0"
FAB_SCHEMA = "pino.fab/1"
BUMPS = ("patch", "minor", "major")
MAX_CHANGES = 20
_VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
_FIELDS = ("value", "footprint", "LCSC")


def parse(v: str) -> tuple[int, int, int]:
    m = _VERSION.match(v)
    if m is None:
        raise ValueError(f"{v!r} is not a version like 1.2.3")
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def bump(v: str, part: str) -> str:
    major, minor, patch = parse(v)
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError("a version bump is patch, minor or major")


def circuit_summary(c: Circuit) -> dict:
    parts = {p.ref: [p.value, p.footprint, p.lcsc, p.dnp, p.hand_fit] for p in c.parts}
    nets = sorted(sorted(f"{p.ref}.{p.number}" for p in n.pins) for n in c.nets if n.pins)
    return {"parts": parts, "nets": nets}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def circuit_fingerprint(summary: dict) -> str:
    return _sha(json.dumps(summary, sort_keys=True).encode("utf-8"))


def fab_fingerprint(files: Mapping[str, bytes]) -> str:
    """Of the files that make the board: Gerbers, drill files, BOM and CPL, by name and content."""
    return _sha("".join(f"{name}\0{_sha(files[name])}\n" for name in sorted(files)).encode("utf-8"))


def _part_changes(old: dict, new: dict) -> list[str]:
    out = []
    for ref in sorted(set(old) | set(new), key=natural):
        if ref not in old:
            out.append(f"{ref} added")
            continue
        if ref not in new:
            out.append(f"{ref} removed")
            continue
        a, b = old[ref], new[ref]
        for i, what in enumerate(_FIELDS):
            if a[i] != b[i]:
                out.append(f"{ref} {what} {a[i] or 'none'} -> {b[i] or 'none'}")
        if a[3] != b[3]:
            out.append(f"{ref} now {'not fitted' if b[3] else 'fitted'}")
        if a[4] != b[4]:
            out.append(f"{ref} now {'soldered by hand' if b[4] else 'placed by JLC'}")
    return out


def _net_changes(old: dict, new: dict) -> list[str]:
    """Pins that changed company, between pins of parts both versions have."""
    both = set(old["parts"]) & set(new["parts"])
    shared = lambda net: frozenset(p for p in net if p.rsplit(".", 1)[0] in both)
    before = {shared(n) for n in old["nets"]} - {frozenset()}
    after = {shared(n) for n in new["nets"]} - {frozenset()}
    first = lambda pins: min(pins, key=natural)
    out = []
    for net in sorted(after - before, key=lambda n: natural(first(n))):
        was = max(before - after, key=lambda o: (len(o & net), -len(o)), default=frozenset())
        kept = was & net
        if not kept:
            out.append(f"new net: {', '.join(sorted(net, key=natural)[:4])}")
            continue
        out += [f"{pin} joins the net of {first(kept)}" for pin in sorted(net - was, key=natural)]
        out += [f"{pin} leaves the net of {first(kept)}" for pin in sorted(was - net, key=natural)]
    return out


def circuit_changes(old: dict, new: dict) -> list[str]:
    out = list(dict.fromkeys(_part_changes(old["parts"], new["parts"]) + _net_changes(old, new)))
    if len(out) > MAX_CHANGES:
        out = out[:MAX_CHANGES] + [f"and {len(out) - MAX_CHANGES} more"]
    return out


def next_version(last: dict | None, circuit_fp: str, fab_fp: str, override: str | None,
                 *, changes: list[str] | None = None) -> tuple[str | None, str | None, list[str]]:
    """(version, bump, why); a version of None means the files are the last release's."""
    if last is None:
        return FIRST_VERSION, None, ["first release"]
    if last.get("fab_fingerprint") == fab_fp:
        return None, None, [f"the same files as v{last['version']}"]
    changed = last.get("circuit_fingerprint") != circuit_fp
    why = (changes or ["the circuit changed"]) if changed else ["the same circuit, new layout"]
    part = override or ("minor" if changed else "patch")
    return bump(last["version"], part), part, why


def manifests(project: Path) -> list[dict]:
    """Every readable fab/v*/manifest.json of pino's, newest version first."""
    found = []
    for path in Path(project).glob("fab/v*/manifest.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("schema") != FAB_SCHEMA:
                continue
            found.append((parse(data["version"]), data))
        except (OSError, ValueError, KeyError, AttributeError, TypeError):
            continue
    return [m for _, m in sorted(found, key=lambda t: t[0], reverse=True)]
