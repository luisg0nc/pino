"""How an LCSC number becomes a KiCad part, from KiCad's own libraries only.

data/jlc/kicad_map.csv holds the table. A row's `match` is one LCSC number (checked by hand against the KiCad
symbol's pins), or a rule `prefix=<R|C|LED>;package=<regex>` on what jlcsearch says about the part: the prefix
comes from its category and the regex matches its package. A rule only covers plain two-pin passives, whose pad 1
is on the left and, on a LED, is the cathode, as in KiCad's Device library.

A part with no row and no rule has no mapping: board.py passes symbol= and footprint= for it.
This module only reads the parts cache; it never asks anyone anything.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from .cache import PartsCache
from .model import PartInfo, normalize_lcsc

MAP = Path(__file__).resolve().parent.parent / "data" / "jlc" / "kicad_map.csv"
ASK_FOR_PARTS = "pass symbol='Library:Name' and footprint='Library:Name' (check the pins against its datasheet)"


@dataclass(frozen=True)
class Row:
    match: str
    symbol: str
    footprint: str
    checked: str


@dataclass(frozen=True)
class Resolved:
    lcsc: str
    how: str  # kicad-map | kicad-rule
    symbol: str
    footprint: str
    value: str
    notes: list[str] = field(default_factory=list)


class PartNotCached(Exception):
    """Nothing about this number in the cache yet."""

    def __init__(self, lcsc: str):
        self.lcsc = lcsc
        super().__init__(f"{lcsc} is not in pino's parts cache yet")


class NoMapping(Exception):
    """pino knows the part, or knows JLC has none, and has no KiCad part for it."""

    def __init__(self, lcsc: str, reason: str):
        self.lcsc, self.reason = lcsc, reason
        super().__init__(reason)


def load_map(path: Path = MAP) -> list[Row]:
    with open(path, newline="", encoding="utf-8") as f:
        return [Row(r["match"], r["symbol"], r["footprint"], r["checked"]) for r in csv.DictReader(f)]


def category(description: str) -> str | None:
    """"R", "C" or "LED" for the plain two-pin passives pino maps by rule, from JLC's category words."""
    if "Resistor Networks" in description or "Arrays" in description:
        return None
    if "Chip Resistor" in description:
        return "R"
    if "Multilayer Ceramic Capacitors" in description:
        return "C"
    if "LED Indication" in description and not re.search(r"RGB|Bi-?color|Dual", description, re.IGNORECASE):
        return "LED"
    return None


def value_of(kind: str, info: PartInfo) -> str:
    """The value as board.py writes it: 10k, 100nF, red."""
    if kind == "R":
        m = re.search(r"(\d+(?:\.\d+)?)\s*([mkMG]?)Ω", info.description)
        return m.group(1) + m.group(2) if m else info.mfr
    if kind == "C":
        m = re.search(r"(\d+(?:\.\d+)?)\s*([pnuµμm])F\b", info.description)
        return m.group(1) + m.group(2).replace("µ", "u").replace("μ", "u") + "F" if m else info.mfr
    m = re.search(r"\b(Red|Green|Blue|Yellow|White|Orange|Amber)\b", info.description)
    return m.group(1).lower() if m else info.mfr


def _rule_matches(row: Row, kind: str, package: str) -> bool:
    fields = dict(part.split("=", 1) for part in row.match.split(";") if "=" in part)
    return fields.get("prefix") == kind and "package" in fields and re.search(fields["package"], package) is not None


def resolve(lcsc: str, cache: PartsCache, rows: Sequence[Row] | None = None) -> Resolved:
    lcsc = normalize_lcsc(lcsc)
    rows = load_map() if rows is None else rows
    entry = cache.stock(lcsc)  # any age: a part's package does not change
    info = entry[0] if entry else None
    kind = category(info.description) if info else None
    for row in rows:
        if row.match == lcsc:
            return Resolved(lcsc, "kicad-map", row.symbol, row.footprint, value_of(kind, info) if kind else "")
    if info is None:
        if cache.unknown(lcsc):
            raise NoMapping(lcsc, f"JLC has no part {lcsc}")
        raise PartNotCached(lcsc)
    if kind:
        for row in rows:
            if ";" in row.match and _rule_matches(row, kind, info.package):
                return Resolved(lcsc, "kicad-rule", row.symbol, row.footprint, value_of(kind, info))
    raise NoMapping(lcsc, f"pino has no KiCad part for {lcsc} ({info.package or 'no package named'})")


def needs(lcsc: str, cache: PartsCache, rows: Sequence[Row] | None = None) -> str | None:
    """"lookup" when resolve() would not know this number without asking jlcsearch."""
    try:
        resolve(lcsc, cache, rows)
    except PartNotCached:
        return "lookup"
    except NoMapping:
        return None
    return None


def prefetch_numbers(source: str) -> list[str]:
    """Every lcsc="C123" literal in board.py's text, normalized, in order, once each."""
    found = []
    for _quote, text in re.findall(r"""\blcsc\s*=\s*(["'])\s*([^"'\n]*?)\s*\1""", source):
        try:
            found.append(normalize_lcsc(text))
        except ValueError:
            continue
    return list(dict.fromkeys(found))
