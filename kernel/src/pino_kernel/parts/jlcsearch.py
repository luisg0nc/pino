"""The jlcsearch client (https://github.com/tscircuit/jlcsearch, MIT; its docs/search-api.md).

GET /api/search?q=&limit=&package=&is_basic=true&is_preferred=true answers {"components": [...]}. Text search
hides parts with no stock; a search for an exact LCSC number does not. Every part found goes into the cache.
"""

from __future__ import annotations

import json
import os
import queue
import threading
import time
import urllib.parse
from dataclasses import dataclass
from datetime import timedelta
from typing import Sequence

from .cache import STOCK_MAX_AGE, PartsCache
from .model import PartInfo, klass_of
from .transport import OfflineError, Response, Transport

BASE_URL = "https://jlcsearch.tscircuit.com"


class JlcSearchError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code  # offline | unavailable | invalid | unknown | http
        super().__init__(message)


@dataclass(frozen=True)
class PartLookup:
    info: PartInfo | None  # None with no error: jlcsearch has no such part
    fresh: bool
    error: str | None


def _server_message(body: bytes) -> str:
    try:
        data = json.loads(body)
        return str(data.get("message") or data.get("error") or "")[:300]
    except (ValueError, AttributeError):
        return ""


def _error(response: Response, url: str) -> JlcSearchError:
    said = _server_message(response.body)
    tail = f": {said}" if said else ""
    if response.status == 400:
        return JlcSearchError("invalid", f"jlcsearch could not use that search{tail}")
    if response.status == 503:
        after = response.headers.get("retry-after")
        wait = f" (try again in {after} s)" if after else ""
        return JlcSearchError("unavailable", f"jlcsearch is unavailable right now{wait}{tail}")
    return JlcSearchError("http", f"jlcsearch answered {response.status} for {url}{tail}")


class Jlcsearch:
    def __init__(self, transport: Transport, cache: PartsCache, base: str | None = None, timeout: float = 8.0):
        self.transport = transport
        self.cache = cache
        self.base = (base or os.environ.get("PINO_JLCSEARCH_URL") or BASE_URL).rstrip("/")
        self.timeout = timeout

    def _rows(self, query: list[tuple[str, str]], timeout: float) -> list[dict]:
        url = f"{self.base}/api/search?{urllib.parse.urlencode(query)}"
        try:
            response = self.transport(url, timeout)
        except OfflineError as e:
            raise JlcSearchError("offline", f"jlcsearch could not be reached: {e} ({url})") from None
        if response.status != 200:
            raise _error(response, url)
        try:
            rows = json.loads(response.body)["components"]
            if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
                raise TypeError
        except (ValueError, KeyError, TypeError):
            raise JlcSearchError("http", f"jlcsearch's answer for {url} was not a list of parts") from None
        return rows

    def _info(self, row: dict) -> PartInfo:
        try:
            stock, price = row.get("stock"), row.get("price")
            return PartInfo(f"C{int(row['lcsc'])}", str(row.get("mfr") or ""), str(row.get("package") or ""),
                            str(row.get("description") or ""), None if stock is None else int(stock),
                            None if price is None else float(price), klass_of(row),
                            row.get("stock_checked_at"), self.cache.now().isoformat(timespec="seconds"))
        except (KeyError, TypeError, ValueError):
            raise JlcSearchError("http", "jlcsearch's answer held a part pino cannot read") from None

    def search(self, q: str, *, package: str | None = None, basic: bool = False, preferred: bool = False,
               limit: int = 8, timeout: float | None = None) -> list[PartInfo]:
        if not 1 <= limit <= 1000:
            raise ValueError("limit must be from 1 to 1000")
        query = [("q", q), ("limit", str(limit))]
        if package:
            query.append(("package", package))
        if basic:
            query.append(("is_basic", "true"))
        if preferred:
            query.append(("is_preferred", "true"))
        found = [self._info(r) for r in self._rows(query, timeout or self.timeout)]
        for info in found:
            self.cache.put_stock(info)
        return found

    def part(self, lcsc: str, *, max_age: timedelta = STOCK_MAX_AGE, timeout: float | None = None) -> PartInfo | None:
        """One part by its number: the cache when it is young enough, else jlcsearch. None: no such part."""
        entry = self.cache.stock(lcsc)
        if entry and self.cache.now() - entry[1] < max_age:
            return entry[0]
        if max_age and self.cache.unknown(lcsc):
            return None
        rows = [r for r in self._rows([("q", lcsc), ("limit", "1")], timeout or self.timeout)
                if str(r.get("lcsc")) == lcsc[1:]]
        if not rows:
            self.cache.put_unknown(lcsc)
            return None
        info = self._info(rows[0])
        self.cache.put_stock(info)
        return info

    def _stale(self, lcsc: str, why: str) -> PartLookup:
        entry = self.cache.stock(lcsc)
        return PartLookup(entry[0] if entry else None, False, why)

    def parts(self, lcscs: Sequence[str], *, budget: float = 6.0, workers: int = 8,
              max_age: timedelta = STOCK_MAX_AGE, breaker: bool = False) -> dict[str, PartLookup]:
        """Many parts at once, within `budget` seconds; max_age=0 asks again about every one. What cannot be asked
        in time comes from the cache, however old, marked with the reason. With `breaker` (the fast build's), nothing
        is asked for a few minutes after jlcsearch could not be reached, so that not every save waits for it."""
        wanted = list(dict.fromkeys(lcscs))
        out: dict[str, PartLookup] = {}
        todo: queue.SimpleQueue = queue.SimpleQueue()
        done: queue.SimpleQueue = queue.SimpleQueue()
        for lcsc in wanted:
            entry = self.cache.stock(lcsc)
            if entry and self.cache.now() - entry[1] < max_age:
                out[lcsc] = PartLookup(entry[0], True, None)
            elif max_age and self.cache.unknown(lcsc):
                out[lcsc] = PartLookup(None, True, None)
            else:
                todo.put(lcsc)
        pending = len(wanted) - len(out)
        deliberate = getattr(self.transport, "deliberate", False)
        down = self.cache.unreachable() if breaker and pending and not deliberate else None
        if down:
            why = f"jlcsearch could not be reached a few minutes ago, so it is not asked again yet: {down}"
            return {lcsc: out.get(lcsc) or self._stale(lcsc, why) for lcsc in wanted}
        asked, answered = pending, 0
        unreached: list[str] = []
        deadline = time.monotonic() + budget

        def work() -> None:
            while time.monotonic() < deadline:
                try:
                    lcsc = todo.get_nowait()
                except queue.Empty:
                    return
                try:
                    left = max(0.5, min(self.timeout, deadline - time.monotonic()))
                    done.put((lcsc, PartLookup(self.part(lcsc, max_age=max_age, timeout=left), True, None), None))
                except JlcSearchError as e:
                    done.put((lcsc, self._stale(lcsc, str(e)), e.code))
                except OSError as e:
                    done.put((lcsc, self._stale(lcsc, str(e)), None))

        # daemon threads: a request that outlives the budget never keeps pino running
        for _ in range(min(workers, pending)):
            threading.Thread(target=work, daemon=True).start()
        while pending:
            try:
                lcsc, lookup, code = done.get(timeout=max(0.0, deadline - time.monotonic()))
            except queue.Empty:
                break
            out[lcsc] = lookup
            pending -= 1
            if lookup.error is None:
                answered += 1
            elif code in ("offline", "unavailable"):
                unreached.append(lookup.error)
        if asked and not deliberate:
            # one answer shows jlcsearch is there; none, with a refusal or silence, starts the wait
            if answered:
                self.cache.reachable()
            elif unreached or pending:
                self.cache.put_unreachable(unreached[0] if unreached else "jlcsearch did not answer in time")
        for lcsc in wanted:
            if lcsc not in out:
                out[lcsc] = self._stale(lcsc, "jlcsearch did not answer in time")
        return {lcsc: out[lcsc] for lcsc in wanted}
