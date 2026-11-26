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
