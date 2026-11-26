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
from pino_kernel import outline as outlines
from pino_kernel.circuit import (
    SCHEMA, BlockSpec, Circuit, Expect, GroupSpec, Intent, Keepout, NetClassSpec, NetSpec, OutlineSpec, PartSpec,
    PinInfo, PinRef, ZoneSpec,
)
from pino_kernel.libraries import Libraries, LibrariesNotFound, discover
from pino_kernel.symbols import Symbol, SymbolLibrary, SymbolNotFound, UnsupportedSymbol

ROLES = ("path", "shunt", "tap", "across")
SIDES = ("top", "bottom", "left", "right")
FORBID = ("tracks", "vias", "pads", "copperpour", "footprints")
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


class Group:
    """Parts the placer keeps together; place it like a part."""

    def __init__(self, board: "Board", name: str, parts: list["Part"], where):
        self.board, self.name, self.parts = board, name, parts
        self.file, self.line = where

    def __repr__(self) -> str:
        return f"Group({self.name})"


def copper_layer_names(layers: int) -> list[str]:
    return ["F.Cu"] + [f"In{i}.Cu" for i in range(1, layers - 1)] + ["B.Cu"]


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
        if layers not in (2, 4):
            raise _fail(f"layers={layers}: pino builds boards with 2 or 4 copper layers", self._where)
        if fab is not None and getattr(fab, "layers", layers) != layers:
            raise _fail(f"fab profile {fab.name} is for {fab.layers} layers; this board has {layers}", self._where)
        self._intents: dict[str, Intent] = {}
        self._groups: dict[str, GroupSpec] = {}
        self._keepouts: list[Keepout] = []
        self._zones: list[ZoneSpec] = []
        self._net_classes: list[NetClassSpec] = []
        self._expects: list[Expect] = []
        _BOARDS.append(self)

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

    # -- placement intent -----------------------------------------------------

    def group(self, name: str, *parts: Part) -> Group:
        where = _caller()
        if name in self._groups:
            raise _fail(f"group {name!r} used twice", where)
        for p in parts:
            if not isinstance(p, Part):
                raise _fail(f"group {name}: {p!r} is not a part", where)
            for g in self._groups.values():
                if p.ref in g.refs:
                    raise _fail(f"{p.ref} is in group {g.name} already", where)
        self._groups[name] = GroupSpec(name, [p.ref for p in parts], where[1])
        return Group(self, name, list(parts), where)

    def _anchor(self, near, where) -> str:
        if isinstance(near, Part):
            return near.ref
        if isinstance(near, Group):
            return f"group:{near.name}"
        if isinstance(near, PinRef):
            return str(near)
        if isinstance(near, PinSet):
            if not near:
                raise _fail("near= names no pin", where)
            return str(near[0])
        if isinstance(near, str):
            return near
        raise _fail(f"near={near!r}: pass a part, a pin or a group", where)

    def place(self, target, *, edge=None, center=False, along=None, near=None, side=None, at=None, rot=None,
              back=False) -> None:
        where = _caller()
        if isinstance(target, Part):
            name = target.ref
        elif isinstance(target, Group):
            name = f"group:{target.name}"
        else:
            raise _fail(f"place() takes a part or a group, not {target!r}", where)
        if edge is not None and edge not in SIDES:
            raise _fail(f"edge={edge!r}: use one of {', '.join(SIDES)}", where)
        if side is not None and side not in SIDES:
            raise _fail(f"side={side!r}: use one of {', '.join(SIDES)}", where)
        if at is not None and (edge is not None or near is not None):
            raise _fail(f"{name}: at= is a fixed position; it cannot go with edge= or near=", where)
        if edge is not None and near is not None:
            raise _fail(f"{name}: edge= and near= cannot go together; pick one", where)
        if side is not None and near is None:
            raise _fail(f"{name}: side= says which side of near=; pass near= too", where)
        if (center or along is not None) and edge is None:
            raise _fail(f"{name}: center= and along= place a part along an edge; pass edge= too", where)
        if center and along is not None:
            raise _fail(f"{name}: center=True means along=0; pass one of them", where)
        if at is not None:
            try:
                at = (float(at[0]), float(at[1]))
            except (TypeError, ValueError, IndexError):
                raise _fail(f"{name}: at= takes (x, y) in mm", where) from None
        if name in self._intents:
            raise _fail(f"{name} is placed twice (lines {self._intents[name].line} and {where[1]})", where)
        self._intents[name] = Intent(
            name, edge, 0.0 if center else (None if along is None else float(along)),
            None if near is None else self._anchor(near, where), side, at,
            None if rot is None else float(rot), bool(back), where[1])

    # -- rules ----------------------------------------------------------------

    def _layers(self, layers, where) -> list[str]:
        if layers == "all":
            return ["*.Cu"]
        names = [layers] if isinstance(layers, str) else list(layers)
        copper = copper_layer_names(self.layers)
        for n in names:
            if n not in copper:
                raise _fail(f"this board has no {n}; its copper layers are {', '.join(copper)}", where)
        return names

    def keepout(self, *, region, layers="all", why="", forbid=FORBID) -> None:
        where = _caller()
        bad = [f for f in forbid if f not in FORBID]
        if bad:
            raise _fail(f"keepout forbid={bad}: use some of {', '.join(FORBID)}", where)
        try:
            if len(region) == 4 and all(isinstance(v, (int, float)) for v in region):
                x0, y0, x1, y1 = region
                poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            else:
                poly = [(p[0], p[1]) for p in region]
        except (TypeError, IndexError):
            raise _fail("keepout region takes (x0, y0, x1, y1) or a list of (x, y) points in mm", where) from None
        if len(poly) < 3:
            raise _fail("keepout region needs at least 3 points", where)
        self._keepouts.append(Keepout(poly, self._layers(layers, where), list(forbid), str(why), "board.py", where[1]))

    def zone(self, net, *, layer: str, region=None) -> None:
        where = _caller()
        name = net.name if isinstance(net, NetSpec) else str(net)
        (layer,) = self._layers(layer, where)
        poly = None
        if region is not None:
            if len(region) == 4 and all(isinstance(v, (int, float)) for v in region):
                x0, y0, x1, y1 = region
                poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            else:
                poly = [(p[0], p[1]) for p in region]
        self._zones.append(ZoneSpec(name, layer, poly, where[1]))

    def net_class(self, name: str, nets, *, width: float, clearance=None, via_diameter=None, via_drill=None) -> None:
        where = _caller()
        f = self._fab_profile()
        names = [n.name if isinstance(n, NetSpec) else str(n) for n in nets]
        if any(c.name == name for c in self._net_classes):
            raise _fail(f"net class {name} declared twice", where)
        self._net_classes.append(NetClassSpec(
            str(name), names, float(width), float(f.min_clearance if clearance is None else clearance),
            float(f.min_via_diameter if via_diameter is None else via_diameter),
            float(f.min_via_drill if via_drill is None else via_drill), where[1]))

    def _expect(self, kind, a, b, through) -> None:
        where = _caller()
        a_pins, b_pins = _pins_of([a]), _pins_of([b])
        for p in a_pins + b_pins:
            self._check_pin(p, where)
        refs = []
        for part in through:
            if not isinstance(part, Part):
                raise _fail(f"through= takes parts, not {part!r}", where)
            refs.append(part.ref)
        self._expects.append(Expect(kind, a_pins, b_pins, refs, where[1]))

    def expect_path(self, a, b, *, through=()) -> None:
        """a and b must be joined: on one net, or through the listed parts only. Checked by pins, never names."""
        self._expect("path", a, b, through)

    def expect_apart(self, a, b) -> None:
        """a and b must never be on one net."""
        self._expect("apart", a, b, ())

    # -- checks ---------------------------------------------------------------

    def _problems(self) -> list[Problem]:
        out: list[Problem] = []
        if self.outline is None:
            out.append(Problem("Board needs an outline: pass outline='outline.json' or outline=(width, height)",
                               *self._where))
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
        out: list[Problem] = []
        file = self._where[0]
        if isinstance(self.outline, (str, os.PathLike)):
            try:
                self._loaded_outline()
            except outlines.OutlineError as e:
                out.append(Problem(str(e), *self._where))
        elif self.outline is not None:
            try:
                w, h = self.outline
                if float(w) <= 0 or float(h) <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                out.append(Problem("outline=(width, height) takes two positive numbers in mm", *self._where))
        for c in self._net_classes:
            for n in c.nets:
                if n not in self._nets:
                    out.append(Problem(f"net class {c.name} names {n}, which is no net", file, c.line))
        for z in self._zones:
            if z.net not in self._nets:
                out.append(Problem(f"zone on {z.layer} names {z.net}, which is no net", file, z.line))
        known = set(self._parts) | {f"group:{g}" for g in self._groups}
        for i in self._intents.values():
            if i.target.startswith("group:") and i.target not in known:
                out.append(Problem(f"no group {i.target[6:]}", file, i.line))
            if i.near is not None:
                ref = i.near.split(".")[0] if not i.near.startswith("group:") else i.near
                if ref not in known:
                    out.append(Problem(f"{i.target}: near={i.near!r} is no part, pin or group", file, i.line))
                elif "." in i.near and not i.near.startswith("group:"):
                    r, num = i.near.split(".", 1)
                    if not self._parts[r].symbol.pins_for(num):
                        out.append(Problem(f"{i.target}: near={i.near!r} is no pin", file, i.line))
                if ref == i.target or (i.target.startswith("group:") and ref in self._groups.get(i.target[6:], GroupSpec("", [])).refs):
                    out.append(Problem(f"{i.target} is placed near itself", file, i.line))
        return out

    def _outline_path(self) -> Path:
        path = Path(self.outline)
        return path if path.is_absolute() else self.folder / path

    def _loaded_outline(self) -> OutlineSpec:
        cached = getattr(self, "_outline_cache", None)
        if cached is None:
            cached = self._outline_cache = outlines.load_outline(self._outline_path())
        return cached

    def validate(self) -> None:
        problems = self._problems()
        if problems:
            raise CircuitError(problems)

    # -- output ---------------------------------------------------------------

    def _fab_profile(self):
        return self.fab or fab_profiles.for_layers(self.layers)

    def _outline_spec(self) -> OutlineSpec:
        if isinstance(self.outline, (str, os.PathLike)):
            return self._loaded_outline()
        w, h = self.outline
        return outlines.rectangle(float(w), float(h), 1.0)

    def _circuit_extras(self) -> dict:
        keepouts = []
        if isinstance(self.outline, (str, os.PathLike)):
            keepouts += outlines.outline_keepouts(self._outline_path())
        keepouts += self._keepouts
        return {"intents": list(self._intents.values()), "groups": list(self._groups.values()),
                "keepouts": keepouts, "zones": list(self._zones), "net_classes": list(self._net_classes),
                "expects": list(self._expects)}

    def to_circuit(self) -> Circuit:
        self.validate()
        parts = [
            PartSpec(p.ref, p.key, p.symbol.lib_id, p.footprint, p.value, p.lcsc, p.dnp, p.block.key, p.role,
                     [PinInfo(s.number, s.name, s.etype) for s in p.symbol.pins], p.line,
                     p.symbol.properties.get("Datasheet", ""), p.symbol.properties.get("Description", ""))
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
