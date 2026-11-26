"""A part as jlcsearch describes it: JLC's number, stock, price and whether it is basic, preferred or extended."""

from __future__ import annotations

import re
from dataclasses import dataclass

PART_SCHEMA = "pino.part/1"
CLASSES = ("basic", "preferred", "extended")
_LCSC = re.compile(r"^C?([1-9][0-9]{0,9})$")


def normalize_lcsc(s: str) -> str:
    """"25804" and " c25804 " give "C25804"."""
    m = _LCSC.match(str(s).strip().upper())
    if m is None:
        raise ValueError(f"{str(s).strip() or 'that'} is not an LCSC number, such as C25804")
    return "C" + m.group(1)


def klass_of(row: dict) -> str:
    if row.get("is_basic"):
        return "basic"
    return "preferred" if row.get("is_preferred") else "extended"


@dataclass(frozen=True)
class PartInfo:
    lcsc: str
    mfr: str
    package: str
    description: str
    stock: int | None
    price: float | None
    klass: str  # basic | preferred | extended
    checked_at: str | None  # when jlcsearch last saw the stock at JLC
    fetched_at: str  # when pino asked

    def to_json(self) -> dict:
        return {"lcsc": self.lcsc, "mfr": self.mfr, "package": self.package, "description": self.description,
                "stock": self.stock, "price": self.price, "class": self.klass, "checked_at": self.checked_at,
                "fetched_at": self.fetched_at}

    @classmethod
    def from_json(cls, d: dict) -> "PartInfo":
        return cls(d["lcsc"], d["mfr"], d["package"], d["description"], d["stock"], d["price"], d["class"],
                   d["checked_at"], d["fetched_at"])
