"""The circuit model: what board.py declares, as plain data and JSON.

board.py runs in a child process and prints one Circuit as JSON; every writer and check
reads this model. Positions are board millimetres (outline centre, y up).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from .jsonable import decode, encode

SCHEMA = "pino.circuit/1"


class CircuitSchemaError(ValueError):
    pass


@dataclass(frozen=True, order=True)
class PinRef:
    ref: str
    number: str

    def __str__(self) -> str:
        return f"{self.ref}.{self.number}"

    def __json__(self):
        return [self.ref, self.number]

    @classmethod
    def __from_json__(cls, value):
        return cls(str(value[0]), str(value[1]))


@dataclass
class PinInfo:
    number: str
    name: str
    etype: str


@dataclass
class PartSpec:
    ref: str
    key: str
    symbol: str
    footprint: str
    value: str
    lcsc: str
    dnp: bool
    block: str
    role: str  # path | shunt | tap | across
    pins: list[PinInfo]
    line: int | None = None
    datasheet: str = ""  # the symbol's, carried onto the footprint so DRC's parity check agrees
    description: str = ""
    hand_fit: bool = False  # soldered by hand: left out of JLC's assembly files
    why: str = ""  # board.py's reason for choosing this part (an extended part needs one)
    source: str = "kicad"  # kicad when board.py named the symbol, else how the LCSC number was mapped
    rotation: float | None = None  # board.py's rotation=: replaces pino's CPL rotation correction for this part


@dataclass
class NetSpec:
    name: str
    kind: str  # signal | supply | gnd
    external: bool
    symbol: str
    pins: list[PinRef]
    line: int | None = None


@dataclass
class BlockSpec:
    key: str
    title: str
    parts: list[str]


@dataclass
class Intent:
    target: str  # "U1", "U1.3" or "group:<name>"
    edge: str | None
    along: float | None
    near: str | None
    side: str | None
    at: tuple[float, float] | None
    rot: float | None
    back: bool
    line: int | None = None


@dataclass
class GroupSpec:
    name: str
    refs: list[str]
    line: int | None = None


@dataclass
class Keepout:
    polygon: list[tuple[float, float]]
    layers: list[str]
    forbid: list[str]  # tracks | vias | pads | copperpour | footprints
    why: str
    source: str  # board.py | outline.json
    line: int | None = None


@dataclass
class ZoneSpec:
    net: str
    layer: str
    polygon: list[tuple[float, float]] | None
    line: int | None = None


@dataclass
class NetClassSpec:
    name: str
    nets: list[str]
    width: float
    clearance: float
    via_diameter: float
    via_drill: float
    line: int | None = None


@dataclass
class Expect:
    kind: str  # path | apart
    a: list[PinRef]
    b: list[PinRef]
    through: list[str]
    line: int | None = None


PAIR_SUFFIXES = (("+", "-"), ("_P", "_N"))


def pair_base(positive: str, negative: str) -> str | None:
    """The shared base of two net names that pair (USB_D+ and USB_D-, or USB_D_P and USB_D_N), else None.
    KiCadRoutingTools pairs nets by these suffixes."""
    for p, n in PAIR_SUFFIXES:
        if positive.endswith(p) and negative.endswith(n):
            base = positive[: -len(p)]
            if base and base == negative[: -len(n)]:
                return base
    return None


@dataclass
class PairSpec:
    name: str  # the shared base, "USB_D"
    positive: str
    negative: str
    width: float | None
    gap: float | None
    line: int | None = None


@dataclass
class RouteStep:
    kind: str  # point | via
    x: float
    y: float
    layer: str | None  # a via step: the layer the route continues on


def _end_json(v):
    return v.__json__() if isinstance(v, PinRef) else [round(float(v[0]), 6) + 0.0, round(float(v[1]), 6) + 0.0]


def _end_from_json(v):
    if all(isinstance(x, str) for x in v):
        return PinRef(str(v[0]), str(v[1]))
    return (float(v[0]), float(v[1]))


@dataclass
class KeptRoute:
    """A route Claude keeps: from a pin (or a point on other copper) through steps to a pin, on one net."""

    net: str
    frm: PinRef | tuple[float, float]
    to: PinRef | tuple[float, float]
    layer: str
    width: float | None
    steps: list[RouteStep]
    line: int | None = None

    def __json__(self):
        return {"net": self.net, "frm": _end_json(self.frm), "to": _end_json(self.to), "layer": self.layer,
                "width": encode(self.width), "steps": encode(self.steps), "line": self.line}

    @classmethod
    def __from_json__(cls, d):
        return cls(d["net"], _end_from_json(d["frm"]), _end_from_json(d["to"]), d["layer"], d.get("width"),
                   [decode(RouteStep, s) for s in d.get("steps", [])], d.get("line"))


@dataclass
class FixedVia:
    net: str
    x: float
    y: float
    diameter: float | None
    drill: float | None
    line: int | None = None


@dataclass
class RouteHint:
    net: str
    region: tuple[float, float, float, float] | None
    layers: list[str] | None
    corridor: list[tuple[float, float]] | None
    rip: list[str]
    line: int | None = None


@dataclass
class LabelSpec:
    """board.py's label(): where one part's reference label goes, by hand. side and at are exclusive; rot alone
    turns the automatic search; hide leaves the label off the silkscreen."""

    ref: str
    side: str | None  # top | bottom | left | right
    at: tuple[float, float] | None  # the label's centre from the part's origin, board mm
    rot: float | None  # degrees, counter-clockwise
    hide: bool
    line: int | None = None


@dataclass
class Hole:
    name: str
    x: float
    y: float
    drill: float
    courtyard: float


@dataclass
class OutlineSpec:
    width: float
    height: float
    segments: list[tuple]  # ("line", a, b) or ("arc", start, mid, end), board mm
    holes: list[Hole]
    height_limit: dict | None
    source: str


@dataclass
class Circuit:
    schema: str
    name: str
    layers: int
    fab: str
    outline: OutlineSpec
    blocks: list[BlockSpec]
    parts: list[PartSpec]
    nets: list[NetSpec]
    no_connects: list[PinRef]
    nc_rest: dict[str, list[str]]
    intents: list[Intent]
    groups: list[GroupSpec]
    keepouts: list[Keepout]
    zones: list[ZoneSpec]
    net_classes: list[NetClassSpec]
    expects: list[Expect]
    source_file: str
    pairs: list[PairSpec] = field(default_factory=list)
    kept_routes: list[KeptRoute] = field(default_factory=list)
    fixed_vias: list[FixedVia] = field(default_factory=list)
    route_hints: list[RouteHint] = field(default_factory=list)
    labels: list[LabelSpec] = field(default_factory=list)
    _pin_nets: dict = field(default=None, init=False, repr=False, compare=False)

    def to_json(self) -> str:
        data = encode(self)
        data.pop("_pin_nets", None)
        return json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n"

    @staticmethod
    def from_json(text: str) -> "Circuit":
        data = json.loads(text)
        if not isinstance(data, dict) or data.get("schema") != SCHEMA:
            got = data.get("schema") if isinstance(data, dict) else None
            raise CircuitSchemaError(f"circuit schema {got!r} is not {SCHEMA}")
        return decode(Circuit, data)

    def part(self, ref: str) -> PartSpec:
        for p in self.parts:
            if p.ref == ref:
                return p
        raise KeyError(ref)

    def net_of(self, ref: str, number: str) -> NetSpec | None:
        if self._pin_nets is None:
            self._pin_nets = {(p.ref, p.number): n for n in self.nets for p in n.pins}
        return self._pin_nets.get((ref, str(number)))


@dataclass
class PartPose:
    x: float
    y: float
    rot: float
    back: bool


Placement = dict[str, PartPose]


def placement_to_json(p: Placement) -> str:
    return json.dumps({k: encode(v) for k, v in p.items()}, indent=1, sort_keys=True) + "\n"


def placement_from_json(text: str) -> Placement:
    return {k: decode(PartPose, v) for k, v in json.loads(text).items()}
