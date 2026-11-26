"""Every UUID pino writes comes from here.

UUIDs are uuid5 of a path of parts, so the same board.py always gives the same ids.
`key` is a part's `id=` when given, else its ref. The board name is never part of a key,
so renaming the board keeps every link.
"""

from __future__ import annotations

import uuid

NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://pino.invalid/kernel/v1")


def uid(*parts: str) -> str:
    return str(uuid.uuid5(NAMESPACE, "/".join(parts)))


def symbol_uuid(key: str) -> str:
    return uid("symbol", key)


def footprint_uuid(key: str) -> str:
    return uid("footprint", key)


def sheet_uuid() -> str:
    return uid("sheet", "root")


def footprint_path(key: str) -> str:
    """The footprint's `(path ...)`: the root sheet path plus the symbol UUID."""
    return "/" + symbol_uuid(key)
