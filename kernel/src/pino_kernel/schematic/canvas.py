"""What gets drawn, in sheet grid units (y down). Layout fills a Canvas; the writer serialises it."""

from dataclasses import dataclass, field

TEXT_W = 0.86  # advance per character, measured from KiCad's SVG export (probe.py) at KiCad's 1.27 mm font, in grid units
TEXT_H = 1.0


def text_width(text: str) -> float:
    return len(text) * TEXT_W


def text_box(x, y, text, justify="center"):
    w = text_width(text)
    x0 = {"left": x, "center": x - w / 2, "right": x - w}[justify]
    return (x0, y - TEXT_H / 2, x0 + w, y + TEXT_H / 2)


@dataclass
class Text:
    value: str
    x: float
    y: float
    justify: str = "center"  # as seen on screen
    hidden: bool = False

    def box(self):
        return text_box(self.x, self.y, self.value, self.justify)


@dataclass
class Sym:
    ref: str
    lib_id: str
    x: int
    y: int
    rot: int
    mirror: str | None
    key: str  # stable identity: the ref, or for power symbols what they serve
    body: tuple
    ref_text: Text
    value_text: Text
    part: object = None  # model.Part, None for power symbols


@dataclass
class Wire:
    net: str
    a: tuple
    b: tuple


@dataclass
class Pt:
    """A pin's connection point."""

    net: str | None
    x: int
    y: int
    ref: str
    number: str


@dataclass
class Label:
    net: str
    x: int
    y: int
    out: str  # "L" "R" "U" "D": which way the text runs from the anchor
    is_global: bool
    key: str

    def box(self):
        # a boxed label is just under one 2.54 mm pin pitch tall; plain text sits above its wire
        w = text_width(self.net) + (1.6 if self.is_global else 0.2)
        h = 1.9 if self.is_global else 1.2
        dy = 0 if self.is_global else -0.75
        if self.out == "R":
            return (self.x, self.y + dy - h / 2, self.x + w, self.y + dy + h / 2)
        if self.out == "L":
            return (self.x - w, self.y + dy - h / 2, self.x, self.y + dy + h / 2)
        if self.out == "U":
            return (self.x - h / 2, self.y - w, self.x + h / 2, self.y)
        return (self.x - h / 2, self.y, self.x + h / 2, self.y + w)


@dataclass
class Frame:
    title: str
    key: str
    box: tuple
    arrangement: str = ""  # "below" or "right": where the block's clusters stand


@dataclass
class Canvas:
    syms: list = field(default_factory=list)
    wires: list = field(default_factory=list)
    pins: list = field(default_factory=list)
    labels: list = field(default_factory=list)
    ncs: list = field(default_factory=list)  # (x, y, key)
    frames: list = field(default_factory=list)

    def wire(self, net, a, b):
        if a != b:
            if a[0] != b[0] and a[1] != b[1]:
                raise AssertionError(f"diagonal wire on {net}: {a} {b}")
            self.wires.append(Wire(net, a, b))

    def boxes(self):
        for s in self.syms:
            yield s.body
            for t in (s.ref_text, s.value_text):
                if not t.hidden:
                    yield t.box()
        for lab in self.labels:
            yield lab.box()
        for w in self.wires:
            yield (min(w.a[0], w.b[0]), min(w.a[1], w.b[1]), max(w.a[0], w.b[0]), max(w.a[1], w.b[1]))
        for p in self.pins:
            yield (p.x, p.y, p.x, p.y)
        for x, y, _ in self.ncs:
            yield (x - 0.5, y - 0.5, x + 0.5, y + 0.5)
        for f in self.frames:
            yield f.box

    def bbox(self):
        boxes = list(self.boxes()) or [(0, 0, 0, 0)]
        return (
            min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes),
        )

    def move(self, dx: int, dy: int):
        def box(b):
            return (b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy)

        for s in self.syms:
            s.x, s.y, s.body = s.x + dx, s.y + dy, box(s.body)
            for t in (s.ref_text, s.value_text):
                t.x, t.y = t.x + dx, t.y + dy
        for w in self.wires:
            w.a, w.b = (w.a[0] + dx, w.a[1] + dy), (w.b[0] + dx, w.b[1] + dy)
        for item in [*self.pins, *self.labels]:
            item.x, item.y = item.x + dx, item.y + dy
        self.ncs = [(x + dx, y + dy, k) for x, y, k in self.ncs]
        for f in self.frames:
            f.box = box(f.box)

    def add(self, other: "Canvas"):
        for name in ("syms", "wires", "pins", "labels", "ncs", "frames"):
            getattr(self, name).extend(getattr(other, name))
