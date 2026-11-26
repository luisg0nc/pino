"""The board.py library: what Claude writes to describe a board.

    from pino import Board
    b = Board("blinky", layers=2, outline="outline.json")
    usb = b.block("usb", "USB power in")
    j1 = usb.path("J1", "Connector:USB_C_Receptacle_USB2.0_16P", footprint="...")

Connections are by pin; net names are labels for people. Every call records the line of
board.py it came from, so a problem points at the line that caused it.
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from pino_kernel import fab as fab_profiles
from pino_kernel.circuit import (
    SCHEMA, BlockSpec, Circuit, NetSpec, OutlineSpec, PartSpec, PinInfo, PinRef,
)
from pino_kernel.libraries import Libraries, LibrariesNotFound, discover
from pino_kernel.symbols import Symbol, SymbolLibrary, SymbolNotFound, UnsupportedSymbol

ROLES = ("path", "shunt", "tap", "across")
REF_RE = re.compile(r"^[A-Z][A-Z_]*[0-9]+$")
NET_RE = re.compile(r"^[A-Za-z0-9_+.\-]+$")

_BOARDS: list["Board"] = []
_PACKAGE_DIR = str(Path(__file__).resolve().parent)
_SYMBOL_LIBS: dict[Libraries, SymbolLibrary] = {}


@dataclass
class Problem:
    message: str
    file: str | None = None
    line: int | None = None

    def __str__(self) -> str:
        where = f"{self.file}:{self.line}: " if self.file and self.line else ""
        return where + self.message


class CircuitError(Exception):
    def __init__(self, problems: list[Problem]):
        self.problems = list(problems)
        first = self.problems[0] if self.problems else Problem("")
        self.file, self.line = first.file, first.line
        super().__init__("\n".join(str(p) for p in self.problems))


def _caller() -> tuple[str | None, int | None]:
    """The first stack frame outside the pino package: the line of board.py that called us."""
    frame = sys._getframe(1)
    while frame is not None:
        filename = frame.f_code.co_filename
        if not os.path.abspath(filename).startswith(_PACKAGE_DIR + os.sep):
            return filename, frame.f_lineno
        frame = frame.f_back
    return None, None


def _fail(message: str, where: tuple[str | None, int | None] | None = None) -> CircuitError:
    file, line = where or _caller()
    return CircuitError([Problem(message, file, line)])


def _symbols() -> SymbolLibrary:
    try:
        libs = discover()
    except LibrariesNotFound as e:
        raise _fail(str(e)) from None
    if libs not in _SYMBOL_LIBS:
        _SYMBOL_LIBS[libs] = SymbolLibrary(libs.symbols)
    return _SYMBOL_LIBS[libs]


class PinSet(tuple):
    """Every pad that one name or number stands for ("VBUS" on USB-C is four pads)."""


def _pins_of(items) -> list[PinRef]:
    out: list[PinRef] = []
    for item in items:
        if isinstance(item, PinRef):
            out.append(item)
        elif isinstance(item, (PinSet, tuple, list)):
            out.extend(_pins_of(item))
        else:
            raise _fail(f"{item!r} is not a pin: use part['NAME'], part.NAME or part[1]")
    return out


class Part:
    def __init__(self, board: "Board", block: "Block", role: str, ref: str, symbol: Symbol, value: str,
                 footprint: str, lcsc: str, dnp: bool, key: str, where):
        self.board, self.block, self.role, self.ref = board, block, role, ref
        self.symbol, self.value, self.footprint, self.lcsc, self.dnp = symbol, value, footprint, lcsc, dnp
        self.key = key
        self.file, self.line = where

    def __repr__(self) -> str:
        return f"Part({self.ref})"

    def __getitem__(self, key) -> PinSet:
        pins = self.symbol.pins_for(key)
        if not pins:
            raise _fail(f"{self.ref}: no pin {str(key)!r} in {self.symbol.lib_id}")
        return PinSet(PinRef(self.ref, p.number) for p in pins)

    def __getattr__(self, name: str) -> PinSet:
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]


class Block:
    def __init__(self, board: "Board", key: str, title: str):
        self.board, self.key, self.title = board, key, title
        self.parts: list[Part] = []

    def _add(self, role, ref, symbol, value="", *, footprint="", lcsc="", dnp=False, id=None) -> Part:
        where = _caller()
        b = self.board
        if not isinstance(ref, str) or not REF_RE.match(ref):
            raise _fail(f"ref {ref!r} is not a reference: use capitals then a number, such as R1 or U12", where)
        if ref in b._parts:
            raise _fail(f"ref {ref} used twice (first at line {b._parts[ref].line})", where)
        key = ref if id is None else str(id)
        if id is not None and not id:
            raise _fail(f"{ref}: id must not be empty", where)
        if key in b._keys:
            what = f"id {key!r}" if id is not None else f"ref {ref}"
            raise _fail(f"{what} used twice: every part needs its own id", where)
        try:
            sym = _symbols().load(symbol)
        except (SymbolNotFound, UnsupportedSymbol) as e:
            raise _fail(f"{ref}: {e}", where) from None
        fp = footprint or sym.properties.get("Footprint", "")
        if not fp:
            raise _fail(f"{ref} has no footprint: pass footprint='Library:Name'", where)
        part = Part(b, self, role, ref, sym, value or sym.properties.get("Value", ""), fp, lcsc, bool(dnp), key, where)
        b._parts[ref] = part
        b._keys[key] = part
        self.parts.append(part)
        return part

    def path(self, ref, symbol, value="", **kw) -> Part:
        """In series along the block's main line, left to right, in declaration order."""
        return self._add("path", ref, symbol, value, **kw)

    def shunt(self, ref, symbol, value="", **kw) -> Part:
        """From a node down to ground."""
        return self._add("shunt", ref, symbol, value, **kw)

    def tap(self, ref, symbol, value="", **kw) -> Part:
        """From a supply down to a node (pull-up)."""
        return self._add("tap", ref, symbol, value, **kw)

    def across(self, ref, symbol, value="", **kw) -> Part:
        """Bridges two nodes of the main line."""
        return self._add("across", ref, symbol, value, **kw)


class _Net:
    def __init__(self, name, kind, symbol, where):
        self.name, self.kind, self.symbol = name, kind, symbol
        self.external = False
        self.pins: list[PinRef] = []
        self.file, self.line = where

    def spec(self) -> NetSpec:
        return NetSpec(self.name, self.kind, self.external, self.symbol, list(self.pins), self.line)


class Board:
    def __init__(self, name: str, *, layers: int = 2, outline=None, fab=None):
        self._where = _caller()
        self.name = str(name)
        self.layers = layers
        self.outline = outline
        self.fab = fab
        self._blocks: list[Block] = []
        self._parts: dict[str, Part] = {}
        self._keys: dict[str, Part] = {}
        self._nets: dict[str, _Net] = {}
        self._pin_net: dict[PinRef, str] = {}
        self._no_connects: dict[PinRef, tuple] = {}
        self._nc_rest: dict[str, list[str]] = {}
        self._init_rules()
        _BOARDS.append(self)

    def _init_rules(self) -> None:
        """Placement and rules state; filled in by the intent API."""

    @property
    def folder(self) -> Path:
        """The folder of the file that made this Board (board.py's folder)."""
        file = self._where[0]
        return Path(file).resolve().parent if file and os.path.exists(file) else Path.cwd()

    def block(self, key: str, title: str = "") -> Block:
        if any(b.key == key for b in self._blocks):
            raise _fail(f"block {key!r} used twice")
        blk = Block(self, str(key), str(title or key))
        self._blocks.append(blk)
        return blk

    def part(self, ref: str) -> Part:
        try:
            return self._parts[ref]
        except KeyError:
            raise _fail(f"no part {ref}") from None

    # -- connections ----------------------------------------------------------

    def _check_pin(self, pin: PinRef, where) -> None:
        part = self._parts.get(pin.ref)
        if part is None or not part.symbol.pins_for(pin.number):
            raise _fail(f"{pin} is not a pin of this board", where)

    def _connect(self, name, kind, items, symbol="", external=False, where=None) -> NetSpec:
        where = where or _caller()
        if not isinstance(name, str) or not NET_RE.match(name) or name.startswith(("Net-(", "unconnected-(")):
            raise _fail(f"net name {name!r} cannot be used: letters, digits and _ + . - only, "
                        "and not starting with Net-( or unconnected-(", where)
        pins = _pins_of(items)
        net = self._nets.get(name)
        if net is None:
            net = self._nets[name] = _Net(name, kind, symbol, where)
        elif net.kind != kind:
            raise _fail(f"net {name} is declared as both {net.kind} and {kind}", where)
        net.external |= bool(external)
        for pin in pins:
            self._check_pin(pin, where)
            other = self._pin_net.get(pin)
            if other == name:
                continue
            if other or pin in self._no_connects:
                raise _fail(f"{pin} is already on {other or 'no-connect'}, not {name}", where)
        for pin in pins:
            if self._pin_net.get(pin) != name:
                self._pin_net[pin] = name
                net.pins.append(pin)
        return net.spec()

    def _power_symbol(self, symbol: str, where) -> None:
        try:
            sym = _symbols().load(symbol)
        except (SymbolNotFound, UnsupportedSymbol):
            sym = None
        if sym is None or not sym.is_power:
            raise _fail(f"no power symbol {symbol}; pass symbol='power:<name>' with one that exists", where)

    def net(self, name, *pins) -> NetSpec:
        return self._connect(name, "signal", pins)

    def supply(self, name, *pins, external=False, symbol="") -> NetSpec:
        where = _caller()
        sym = symbol or f"power:{name}"
        self._power_symbol(sym, where)
        return self._connect(name, "supply", pins, sym, external, where)

    def gnd(self, *pins, external=False, name="GND") -> NetSpec:
        where = _caller()
        sym = f"power:{name}"
        self._power_symbol(sym, where)
        return self._connect(name, "gnd", pins, sym, external, where)

    def nc(self, *pins) -> None:
        where = _caller()
        for pin in _pins_of(pins):
            self._check_pin(pin, where)
            if pin in self._pin_net:
                raise _fail(f"{pin} is on {self._pin_net[pin]}, so it cannot be no-connect", where)
            self._no_connects.setdefault(pin, where)

    def nc_rest(self, part: Part) -> list[PinRef]:
        where = _caller()
        marked = []
        for p in part.symbol.pins:
            pin = PinRef(part.ref, p.number)
            if pin not in self._pin_net and pin not in self._no_connects:
                self._no_connects[pin] = where
                marked.append(pin)
        self._nc_rest.setdefault(part.ref, []).extend(p.number for p in marked)
        return marked

    # -- checks ---------------------------------------------------------------

    def _problems(self) -> list[Problem]:
        out: list[Problem] = []
        if self.outline is None:
            out.append(Problem("Board needs an outline: pass outline='outline.json' or outline=(width, height)",
                               *self._where))
        if self.layers not in (2, 4):
            out.append(Problem(f"layers={self.layers}: pino builds 2 or 4 copper layers", *self._where))
        for part in self._parts.values():
            where = (part.file, part.line)
            positions: dict[tuple[int, int], set[str]] = {}
            for p in part.symbol.pins:
                pin = PinRef(part.ref, p.number)
                if pin not in self._pin_net and pin not in self._no_connects:
                    out.append(Problem(f"{pin} ({p.name}) is on no net and not marked no-connect", *where))
                    continue
                positions.setdefault((p.x, p.y), set()).add(self._pin_net.get(pin, "no-connect"))
            for pos, nets in positions.items():
                if len(nets) > 1:
                    out.append(Problem(f"{part.ref}: stacked pins at one spot sit on different nets {sorted(nets)}",
                                       *where))
            if part.role != "path":
                if len(part.symbol.pins) != 2:
                    out.append(Problem(f"{part.ref}: role {part.role} needs a 2-pin part", *where))
                    continue
                kinds = [n.kind if n else None
                         for n in (self._nets.get(self._pin_net.get(PinRef(part.ref, p.number), ""))
                                   for p in part.symbol.pins)]
                if part.role == "shunt" and kinds.count("gnd") != 1:
                    out.append(Problem(f"{part.ref}: a shunt has exactly one pin on GND", *where))
                if part.role == "tap" and kinds.count("supply") != 1:
                    out.append(Problem(f"{part.ref}: a tap has exactly one pin on a supply", *where))
        for net in self._nets.values():
            if len(net.pins) < 2 and not net.external:
                out.append(Problem(f"net {net.name} has only {len(net.pins)} pin; join it to another pin, "
                                   "or pass external=True if it leaves the board", net.file, net.line))
        out += self._rule_problems()
        return out

    def _rule_problems(self) -> list[Problem]:
        return []

    def validate(self) -> None:
        problems = self._problems()
        if problems:
            raise CircuitError(problems)

    # -- output ---------------------------------------------------------------

    def _fab_profile(self):
        return self.fab or fab_profiles.for_layers(self.layers)

    def _outline_spec(self) -> OutlineSpec:
        w, h = self.outline
        return OutlineSpec(float(w), float(h), [], [], None, "board.py")

    def _circuit_extras(self) -> dict:
        return {"intents": [], "groups": [], "keepouts": [], "zones": [], "net_classes": [], "expects": []}

    def to_circuit(self) -> Circuit:
        self.validate()
        parts = [
            PartSpec(p.ref, p.key, p.symbol.lib_id, p.footprint, p.value, p.lcsc, p.dnp, p.block.key, p.role,
                     [PinInfo(s.number, s.name, s.etype) for s in p.symbol.pins], p.line)
            for blk in self._blocks for p in blk.parts
        ]
        declared = {ref: i for i, ref in enumerate(self._parts)}
        parts.sort(key=lambda p: declared[p.ref])
        return Circuit(
            schema=SCHEMA, name=self.name, layers=self.layers, fab=self._fab_profile().name,
            outline=self._outline_spec(),
            blocks=[BlockSpec(b.key, b.title, [p.ref for p in b.parts]) for b in self._blocks],
            parts=parts, nets=[n.spec() for n in self._nets.values()],
            no_connects=list(self._no_connects), nc_rest={k: list(v) for k, v in self._nc_rest.items() if v},
            source_file=os.path.basename(self._where[0] or "board.py"),
            **self._circuit_extras(),
        )
