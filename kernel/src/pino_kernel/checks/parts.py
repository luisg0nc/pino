"""Parts findings (source "parts"): LCSC numbers, JLC's stock, and basic, preferred or extended.

Only assembled parts are checked: a DNP or hand-fit part is not on JLC's order. Stock changes by the day, so these
findings are made again on every build and never stored with it.
"""

from __future__ import annotations

from typing import Mapping

from ..circuit import Circuit, PartSpec
from ..findings import At, Finding
from ..parts.jlcsearch import PartLookup
from ..parts.model import normalize_lcsc

ORDER_BOARDS = 5  # JLC's smallest order: stock below this many boards' worth gets a warning


def assembled(part: PartSpec) -> bool:
    """On JLC's assembly order: not left unfitted, not soldered by hand."""
    return not part.dnp and not part.hand_fit


def lcsc_of(part: PartSpec) -> str | None:
    try:
        return normalize_lcsc(part.lcsc)
    except ValueError:
        return None


def parts_findings(circuit: Circuit, poses: Mapping[str, tuple], lookups: Mapping[str, PartLookup], *,
                   strict: bool = False) -> list[Finding]:
    """`strict` is release's view: a part without a number, or an extended part without a reason, is an error."""
    out: list[Finding] = []
    by_number: dict[str, list[PartSpec]] = {}

    def finding(code: str, severity: str, message: str, parts: list[PartSpec]) -> None:
        first = parts[0]
        pose = poses.get(first.ref)
        at = At("board", pose.x, pose.y, "B.Cu" if pose.back else "F.Cu") if pose is not None else None
        if first.line:
            message = f"{message} (board.py:{first.line})"
        out.append(Finding("parts", code, severity, message, at, tuple(p.ref for p in parts)))

    for part in circuit.parts:
        if not assembled(part):
            continue
        lcsc = lcsc_of(part)
        if lcsc is None:
            finding("part_no_lcsc", "error" if strict else "info",
                    f"{part.ref} has no LCSC number, so JLC cannot place it: add lcsc=, or hand_fit=True", [part])
        else:
            by_number.setdefault(lcsc, []).append(part)

    for lcsc, parts in by_number.items():
        refs = ", ".join(p.ref for p in parts)
        lookup = lookups.get(lcsc)
        info = lookup.info if lookup else None
        if lookup is not None and info is None and lookup.error is None:
            finding("part_unknown", "error", f"JLC has no part {lcsc} ({refs}): check the number", parts)
            continue
        if info is None:
            finding("part_stock_unknown", "info",
                    f"{lcsc} not looked up yet: pino checks stock when it is online ({refs})", parts)
            continue
        if lookup.error or info.stock is None:
            finding("part_stock_unknown", "warning",
                    f"stock of {lcsc} not known: last checked {(info.checked_at or info.fetched_at)[:10]} ({refs})",
                    parts)
        elif info.stock == 0:
            finding("part_no_stock", "error", f"{lcsc} is out of stock at JLC ({refs})", parts)
        elif info.stock < len(parts):
            finding("part_short", "error",
                    f"JLC has {info.stock} of {lcsc}; this board needs {len(parts)} ({refs})", parts)
        elif info.stock < ORDER_BOARDS * len(parts):
            finding("part_low_stock", "warning",
                    f"JLC has {info.stock} of {lcsc}; {ORDER_BOARDS} boards need {ORDER_BOARDS * len(parts)} ({refs})",
                    parts)
        for part in parts:
            if info.klass == "extended" and part.why:
                finding("part_extended", "info", f"{part.ref} extended: {part.why}", [part])
            elif info.klass == "extended":
                finding("part_extended", "error" if strict else "warning",
                        f"{part.ref} {lcsc} is an extended part (JLC charges a setup fee per part type): say why "
                        "with why= in board.py, or pick a basic part", [part])
            elif info.klass == "preferred":
                finding("part_preferred", "info",
                        f"{part.ref} {lcsc} is a preferred part: no setup fee in economic assembly", [part])
    return out
