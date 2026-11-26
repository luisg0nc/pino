"""Load symbols from .kicad_sym libraries, flatten `extends`, and work out pin geometry.

A symbol is found by scanning the file's tokens with a depth counter, never by its
indentation, so libraries written by other tools load the same as KiCad's own.
All layout coordinates are integers in grid units (1 u = 1.27 mm).
"""

from __future__ import annotations

import copy
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from .sexpr import find, find_all, parse

GRID = 1.27


class SymbolNotFound(KeyError):
    def __str__(self) -> str:
        return str(self.args[0]) if self.args else "symbol not found"


class UnsupportedSymbol(ValueError):
    pass


def to_u(mm, lib_id: str = "") -> int:
    u = float(mm) / GRID
    if abs(u - round(u)) > 1e-6:
        raise UnsupportedSymbol(f"{lib_id}: pin position {mm} mm is off the 1.27 mm grid")
    return round(u)


def natural(s: str):
    return [(0, int(t), "") if t.isdigit() else (1, 0, t) for t in re.findall(r"\d+|\D+", s)]


@dataclass(frozen=True)
class Pin:
    number: str
    name: str
    etype: str
    x: int  # library coords (y up), grid units
    y: int
    angle: int  # direction from the connection point toward the body
    length: int = 0  # grid units, rounded
    hidden: bool = False


@dataclass(frozen=True)
class Symbol:
    lib_id: str
    node: list  # flattened, ready to embed in lib_symbols
    pins: tuple
    properties: dict
    is_power: bool
    body: tuple = (0.0, 0.0, 0.0, 0.0)  # (x0, y0, x1, y1) library coords, grid units

    def pins_for(self, key) -> list:
        """Pins by number ("A4", 1) first, else by name ("VBUS"); a name may hit several."""
        key = str(key)
        hit = [p for p in self.pins if p.number == key]
        return hit or [p for p in self.pins if p.name == key]


_TOKEN = re.compile(r'"(?:[^"\\]|\\.)*"|[()]')
_HEAD = re.compile(r'\(\s*symbol\s+"((?:[^"\\]|\\.)*)"')


@dataclass
class _LibFile:
    text: str
    blocks: dict[str, tuple[int, int]]


def _index(text: str) -> dict[str, tuple[int, int]]:
    """Top-level `(symbol "name" ...)` blocks: name -> (start, end) offsets."""
    blocks: dict[str, tuple[int, int]] = {}
    depth, start = 0, -1
    for tok in _TOKEN.finditer(text):
        t = tok[0]
        if t == "(":
            depth += 1
            if depth == 2:
                start = tok.start()
        elif t == ")":
            if depth == 2 and start >= 0:
                m = _HEAD.match(text, start)
                if m:
                    blocks.setdefault(m[1].replace('\\"', '"'), (start, tok.end()))
                start = -1
            depth -= 1
    return blocks


class SymbolLibrary:
    def __init__(self, root: Path):
        self.root = Path(root)
        self._files: dict[str, tuple[int, _LibFile]] = {}
        self._symbols: dict[tuple[str, int], Symbol] = {}

    def _file(self, lib: str, lib_id: str) -> _LibFile:
        path = self.root / f"{lib}.kicad_sym"
        try:
            mtime = path.stat().st_mtime_ns
        except FileNotFoundError:
            raise SymbolNotFound(f"no symbol library {lib!r} for {lib_id} in {self.root}") from None
        cached = self._files.get(lib)
        if cached and cached[0] == mtime:
            return cached[1]
        text = path.read_text(encoding="utf-8")
        f = _LibFile(text, _index(text))
        self._files[lib] = (mtime, f)
        return f

    def _block_text(self, lib: str, name: str, lib_id: str) -> str:
        f = self._file(lib, lib_id)
        span = f.blocks.get(name)
        if span is None:
            raise SymbolNotFound(f"no symbol {name!r} in library {lib!r} ({lib_id})")
        return f.text[span[0]:span[1]]

    def _chain(self, lib: str, name: str, lib_id: str) -> list[tuple[str, list]]:
        """The symbol and its `extends` parents, child first: [(text, node), ...]."""
        out, seen = [], set()
        while True:
            if name in seen:
                raise UnsupportedSymbol(f"{lib_id}: extends loops through {name}")
            seen.add(name)
            text = self._block_text(lib, name, lib_id)
            node = parse(text)
            out.append((text, node))
            ext = find(node, "extends")
            if not ext:
                return out
            name = str(ext[1])

    def source_digest(self, lib_id: str) -> str:
        lib, _, name = lib_id.partition(":")
        h = hashlib.sha256()
        for text, _ in self._chain(lib, name, lib_id):
            h.update(text.encode("utf-8"))
            h.update(b"\0")
        return h.hexdigest()

    def _flat(self, lib: str, name: str, lib_id: str) -> list:
        chain = self._chain(lib, name, lib_id)
        node = chain[-1][1]
        # Apply each child's properties over its parent, from the root down.
        for (_, child), (_, parent) in zip(reversed(chain[:-1]), reversed(chain[1:])):
            child_name, parent_name = str(child[1]), str(parent[1])
            out = copy.deepcopy(node)
            out[1] = child_name
            own = {str(p[1]): p for p in find_all(child, "property")}
            for i, c in enumerate(out):
                if isinstance(c, list) and c and c[0] == "property" and str(c[1]) in own:
                    out[i] = own.pop(str(c[1]))
                elif isinstance(c, list) and c and c[0] == "symbol":
                    c[1] = child_name + str(c[1])[len(parent_name):]
            at = next((i for i, c in enumerate(out) if isinstance(c, list) and c and c[0] == "symbol"), len(out))
            out[at:at] = list(own.values())
            node = out
        return node

    def load(self, lib_id: str) -> Symbol:
        lib, sep, name = lib_id.partition(":")
        if not sep or not lib or not name:
            raise SymbolNotFound(f"symbol {lib_id!r} is not in the form Library:Name")
        f = self._file(lib, lib_id)
        key = (lib_id, id(f))
        if key in self._symbols:
            return self._symbols[key]
        node = copy.deepcopy(self._flat(lib, name, lib_id))
        node[1] = lib_id
        sym = _symbol(lib_id, node)
        self._symbols[key] = sym
        return sym


def _symbol(lib_id: str, node: list) -> Symbol:
    pins, points, units = [], [], set()
    for unit in find_all(node, "symbol"):
        um = re.search(r"_(\d+)_(\d+)$", str(unit[1]))
        u, style = (int(um[1]), int(um[2])) if um else (0, 1)
        if u > 0:
            units.add(u)
        if style > 1:
            continue  # alternate body style (De Morgan): pino draws the first style only
        for p in find_all(unit, "pin"):
            at = find(p, "at")
            hide = find(p, "hide")
            length = find(p, "length")
            pins.append(Pin(
                number=str(find(p, "number")[1]),
                name=str(find(p, "name")[1]),
                etype=str(p[1]),
                x=to_u(at[1], lib_id),
                y=to_u(at[2], lib_id),
                angle=int(float(at[3])) % 360 if len(at) > 3 else 0,
                length=round(float(length[1]) / GRID) if length else 0,
                hidden=bool(hide and hide[1] == "yes") or "hide" in p[1:3],
            ))
        for r in find_all(unit, "rectangle"):
            for k in ("start", "end"):
                points.append(find(r, k)[1:3])
        for poly in find_all(unit, "polyline"):
            points += [xy[1:3] for xy in find_all(find(poly, "pts"), "xy")]
        for c in find_all(unit, "circle"):
            cx, cy = map(float, find(c, "center")[1:3])
            rad = float(find(c, "radius")[1])
            points += [(cx - rad, cy - rad), (cx + rad, cy + rad)]
        for a in find_all(unit, "arc"):
            points += [find(a, k)[1:3] for k in ("start", "mid", "end") if find(a, k)]
    if len(units) > 1:
        raise UnsupportedSymbol(f"multi-unit symbols are not supported yet: {lib_id}")
    if not points:
        points = [(p.x * GRID, p.y * GRID) for p in pins] or [(0, 0)]
    xs = [float(p[0]) / GRID for p in points]
    ys = [float(p[1]) / GRID for p in points]
    props = {str(p[1]): str(p[2]) for p in find_all(node, "property")}
    return Symbol(
        lib_id=lib_id,
        node=node,
        pins=tuple(sorted(pins, key=lambda p: natural(p.number))),
        properties=props,
        is_power=find(node, "power") is not None,
        body=(min(xs), min(ys), max(xs), max(ys)),
    )


# --- placement transforms ---------------------------------------------------


def turn(x, y, rot: int, mirror: str | None = None):
    """Library vector (y up) -> sheet vector (y down) for a placed symbol.

    KiCad applies the rotation (counter-clockwise on screen), then the mirror.
    """
    for _ in range(rot // 90 % 4):
        x, y = -y, x
    y = -y
    if mirror == "y":
        x = -x
    elif mirror == "x":
        y = -y
    return x, y


def pin_at(pin: Pin, origin, rot=0, mirror=None):
    dx, dy = turn(pin.x, pin.y, rot, mirror)
    return origin[0] + dx, origin[1] + dy


def pin_outward(pin: Pin, rot=0, mirror=None):
    """Unit vector on the sheet pointing from the pin's connection point away from the body."""
    vec = {0: (-1, 0), 90: (0, -1), 180: (1, 0), 270: (0, 1)}[pin.angle]
    return turn(*vec, rot, mirror)


def body_box(sym: Symbol, origin, rot=0, mirror=None):
    x0, y0, x1, y1 = sym.body
    pts = [turn(x, y, rot, mirror) for x in (x0, x1) for y in (y0, y1)]
    xs = [origin[0] + p[0] for p in pts]
    ys = [origin[1] + p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)
