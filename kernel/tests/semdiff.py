"""Semantic diff of two .kicad_pcb texts by top-level item, ignoring order (from the board-writer spike)."""

from __future__ import annotations

from pino_kernel.sexpr import dump, find, parse

IGNORED = {"generator", "generator_version"}  # KiCad always writes its own


def _key(n):
    u = find(n, "uuid")
    return (str(n[0]), str(u[1]) if u else dump(n)[:60])


def _canon(n):
    if not isinstance(n, list):
        return str(n)
    return "(" + " ".join(sorted(_canon(c) for c in n)) + ")"


def _items(root):
    return {_key(c): c for c in root[1:] if isinstance(c, list) and c and str(c[0]) not in IGNORED}


def changed_items(a_text: str, b_text: str) -> list[tuple[str, str]]:
    """Top-level (kind, uuid) pairs that differ, are added or are removed; order ignored."""
    a, b = _items(parse(a_text)), _items(parse(b_text))
    out = {k for k in a.keys() ^ b.keys()}
    out |= {k for k in a.keys() & b.keys() if _canon(a[k]) != _canon(b[k])}
    return sorted(out)
