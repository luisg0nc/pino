"""KiCad's ERC and DRC reports as findings with positions in pino's frames."""

from __future__ import annotations

import re
from typing import Mapping

from ..coords import from_kicad
from ..findings import At, Finding

KEEP = {"error": "error", "warning": "warning"}  # exclusion and ignore are dropped
UNITS = {"mm": 1.0, "in": 25.4, "mils": 0.0254}
_REF = re.compile(r"\b(?:of|Symbol|Footprint)\s+([A-Z][A-Z_]*[0-9]+)\b")
_LAYER = re.compile(r"\bon ([A-Za-z0-9]+\.[A-Za-z]+)\b")


def _refs(items, by_uuid: Mapping[str, str]) -> tuple[str, ...]:
    refs = []
    for it in items:
        ref = by_uuid.get(it.get("uuid", ""))
        if ref is None:
            m = _REF.search(it.get("description", ""))
            ref = m.group(1) if m else None
        if ref and ref not in refs:
            refs.append(ref)
    return tuple(refs)


def _message(v) -> str:
    parts = [v.get("description", "")] + [it.get("description", "") for it in v.get("items", [])]
    return ": ".join([parts[0], "; ".join(p for p in parts[1:] if p)]) if len(parts) > 1 else parts[0]


def erc_findings(report: dict, symbol_refs: Mapping[str, str]) -> list[Finding]:
    scale = UNITS.get(report.get("coordinate_units", "mm"), 1.0)
    out = []
    for sheet in report.get("sheets", []):
        for v in sheet.get("violations", []):
            severity = KEEP.get(v.get("severity"))
            if severity is None:
                continue
            items = v.get("items", [])
            at = None
            if items and "pos" in items[0]:
                at = At("sheet", round(items[0]["pos"]["x"] * scale, 4), round(items[0]["pos"]["y"] * scale, 4))
            out.append(Finding("erc", v.get("type", "erc"), severity, _message(v), at, _refs(items, symbol_refs)))
    return out


def _board_at(items, scale) -> At | None:
    if not items or "pos" not in items[0]:
        return None
    x, y = from_kicad(items[0]["pos"]["x"] * scale, items[0]["pos"]["y"] * scale)
    m = _LAYER.search(items[0].get("description", ""))
    return At("board", round(x, 4) + 0.0, round(y, 4) + 0.0, m.group(1) if m else None)


def drc_findings(report: dict, footprint_refs: Mapping[str, str]) -> tuple[list[Finding], int]:
    """(findings, unrouted). Unconnected items are counted, not listed; courtyard overlaps are pino's own
    check (courtyards.py); every schematic parity item is an error."""
    scale = UNITS.get(report.get("coordinate_units", "mm"), 1.0)
    out = []
    for v in report.get("violations", []):
        severity = KEEP.get(v.get("severity"))
        if severity is None or v.get("type") == "courtyards_overlap":
            continue
        items = v.get("items", [])
        out.append(Finding("drc", v.get("type", "drc"), severity, _message(v), _board_at(items, scale),
                           _refs(items, footprint_refs)))
    for v in report.get("schematic_parity", []) or []:
        if v.get("severity") in ("exclusion", "ignore"):
            continue
        items = v.get("items", [])
        out.append(Finding("drc", f"parity_{v.get('type', 'issue')}", "error", _message(v), _board_at(items, scale),
                           _refs(items, footprint_refs)))
    unrouted = report.get("unconnected_items", [])
    return out, len(unrouted) if isinstance(unrouted, list) else int(unrouted or 0)
