"""The user's parts cache, under <cache>/parts/: what jlcsearch said about each part, with its date.

    stock/<LCSC>.json     a pino.part/1 entry; fresh for 24 h (jlcsearch syncs stock nightly)
    unknown/<LCSC>.json   jlcsearch had no such part; remembered for 6 h

Every write is a temp file and a rename, so a killed run never leaves half an entry.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Mapping

from ..routing.krt import cache_root
from .model import PART_SCHEMA, PartInfo

STOCK_MAX_AGE = timedelta(hours=24)
UNKNOWN_MAX_AGE = timedelta(hours=6)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parts_root(env: Mapping[str, str] = os.environ) -> Path:
    return cache_root(env) / "parts"


class PartsCache:
    def __init__(self, root: Path, now: Callable[[], datetime] = utc_now):
        self.root = Path(root)
        self.now = now

    def _read(self, kind: str, lcsc: str) -> dict | None:
        try:
            data = json.loads((self.root / kind / f"{lcsc}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def _write(self, kind: str, lcsc: str, data: dict) -> None:
        folder = self.root / kind
        folder.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=f".{lcsc}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=1, sort_keys=True, ensure_ascii=False)
                f.write("\n")
            os.replace(tmp, folder / f"{lcsc}.json")
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def stock(self, lcsc: str) -> tuple[PartInfo, datetime] | None:
        """The entry and when it was fetched, however old."""
        data = self._read("stock", lcsc)
        if data is None or data.get("schema") != PART_SCHEMA:
            return None
        try:
            info = PartInfo.from_json(data)
            return info, datetime.fromisoformat(info.fetched_at)
        except (KeyError, TypeError, ValueError):
            return None

    def fresh(self, lcsc: str) -> PartInfo | None:
        entry = self.stock(lcsc)
        return entry[0] if entry and self.now() - entry[1] < STOCK_MAX_AGE else None

    def put_stock(self, info: PartInfo) -> None:
        self._write("stock", info.lcsc, {"schema": PART_SCHEMA, **info.to_json()})
        (self.root / "unknown" / f"{info.lcsc}.json").unlink(missing_ok=True)

    def unknown(self, lcsc: str) -> bool:
        data = self._read("unknown", lcsc)
        try:
            return data is not None and self.now() - datetime.fromisoformat(data["fetched_at"]) < UNKNOWN_MAX_AGE
        except (KeyError, TypeError, ValueError):
            return False

    def put_unknown(self, lcsc: str) -> None:
        self._write("unknown", lcsc, {"fetched_at": self.now().isoformat()})
        (self.root / "stock" / f"{lcsc}.json").unlink(missing_ok=True)
