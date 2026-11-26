"""Role-driven schematic layout. No coordinates come from board.py.

A block is drawn as horizontal chains (the `path` parts in series, input left, output right) with
shunts hanging to ground, taps coming down from a supply and `across` parts bridging two nodes
overhead. Shunts and taps whose net is not on a chain become small clusters beside the chain,
tied to the rest by the net's label or power symbol.
"""

import math
from dataclasses import dataclass, field

from ..circuit import Circuit, PinRef
from ..symbols import GRID, Symbol, SymbolLibrary, body_box, pin_at, pin_outward, turn
from .canvas import Canvas, Frame, Label, Pt, Sym, Text, text_width

SMALL_HUB = 8  # a multi-pin part this small may have shunts wired straight onto its side pins
SIDES = {(-1, 0): "L", (1, 0): "R", (0, -1): "U", (0, 1): "D"}


# -- the circuit as the layout reads it -------------------------------------------


@dataclass(eq=False)
class MPart:
    ref: str
    key: str
    symbol: Symbol
    value: str
    role: str
    block: "MBlock"
    footprint: str
    lcsc: str
    dnp: bool
    hand_fit: bool = False


@dataclass(eq=False)
class MNet:
    name: str
    kind: str
    pins: list
    external: bool
    symbol: str

    @property
    def is_power(self):
        return self.kind != "signal"


@dataclass(eq=False)
class MBlock:
    key: str
    title: str
    parts: list = field(default_factory=list)


class Model:
    """Circuit plus loaded symbols, shaped as the layout and writer read it."""

    def __init__(self, circuit: Circuit, symbols: SymbolLibrary):
        self.circuit = circuit
        self.name = circuit.name
        self.blocks = [MBlock(b.key, b.title) for b in circuit.blocks]
        by_key = {b.key: b for b in self.blocks}
        self.parts: dict[str, MPart] = {}
        for p in circuit.parts:
            self.parts[p.ref] = MPart(p.ref, p.key, symbols.load(p.symbol), p.value, p.role, by_key[p.block],
                                      p.footprint, p.lcsc, p.dnp, p.hand_fit)
        for b in circuit.blocks:
            by_key[b.key].parts = [self.parts[r] for r in b.parts]
        self.nets: dict[str, MNet] = {n.name: MNet(n.name, n.kind, list(n.pins), n.external, n.symbol)
                                      for n in circuit.nets}
        self._pin_net = {(p.ref, p.number): n.name for n in circuit.nets for p in n.pins}
        self.no_connects = set(circuit.no_connects)

    def net_of(self, ref, number):
        name = self._pin_net.get((ref, str(number)))
        return self.nets[name] if name else None


class Layout:
    def __init__(self, board: Model, symbols: SymbolLibrary):
        self.board = board
        self.symbols = symbols
        self.arrangements: dict[str, str] = {}
        spans = {}
        for net in board.nets.values():
            spans[net.name] = {board.parts[p.ref].block.key for p in net.pins}
        self.cross = {name for name, blocks in spans.items() if len(blocks) > 1}

    # -- primitives -------------------------------------------------------------

    def net_name(self, ref, number):
        net = self.board.net_of(ref, number)
        return net.name if net else None

    def place(self, cv, part, origin, rot=0, mirror=None, ref_text=None, value_text=None):
        sym = part.symbol
        body = body_box(sym, origin, rot, mirror)
        item = Sym(
            part.ref, sym.lib_id, origin[0], origin[1], rot, mirror, part.ref, body,
            ref_text or Text(part.ref, *origin), value_text or Text(part.value, *origin), part,
        )
        cv.syms.append(item)
        for p in sym.pins:
            x, y = pin_at(p, origin, rot, mirror)
            cv.pins.append(Pt(self.net_name(part.ref, p.number), x, y, part.ref, p.number))
        return item

    def power(self, cv, net_name, pos, key, rot=0):
        """A power symbol with its pin at `pos`. rot 0 is upright (ground down, supply up)."""
        net = self.board.nets[net_name]
        self._power_symbol(cv, net.symbol, net_name, net_name, pos, key, rot, "#PWR")

    def flag(self, cv, net_name, pos, key):
        self._power_symbol(cv, "power:PWR_FLAG", "PWR_FLAG", net_name, pos, key, 0, "#FLG")

    def _power_symbol(self, cv, lib_id, value, net_name, pos, key, rot, prefix):
        sym = self.symbols.load(lib_id)
        body = body_box(sym, pos, rot)
        down = lib_id == "power:GND"
        if rot == 0:
            text = Text(value, pos[0], body[3] + 0.9 if down else body[1] - 0.9)
        else:
            right = (body[0] + body[2]) / 2 > pos[0]
            text = Text(value, body[2] + 0.5 if right else body[0] - 0.5, pos[1], "left" if right else "right")
        cv.syms.append(
            Sym(prefix, lib_id, pos[0], pos[1], rot, None, f"{prefix}/{net_name}/{key}", body,
                Text(prefix, *pos, hidden=True), text)
        )
        cv.pins.append(Pt(net_name, pos[0], pos[1], f"{prefix}/{key}", "1"))

    def label(self, cv, net_name, pos, out, key, on_wire=False):
        """A name at the end of a wire is a boxed global label: a plain one there floats, and beside a
        boxed one at 2.54 mm pin pitch the two collide. A plain label is only for naming mid-wire."""
        boxed = not on_wire or net_name in self.cross
        cv.labels.append(Label(net_name, pos[0], pos[1], out, boxed, key))

    @staticmethod
    def two_terminal(part):
        """A passive with a pin at each end. A 2-way connector has two pins but is not one."""
        pins = part.symbol.pins
        return len(pins) == 2 and abs(pins[0].angle - pins[1].angle) == 180

    @staticmethod
    def two_pin_pose(part, first, second, direction):
        """Rotation that puts pin `first` before pin `second` going `direction` ((1,0) or (0,1))."""
        a, b = part.symbol.pins_for(first)[0], part.symbol.pins_for(second)[0]
        for rot in (0, 90, 180, 270):
            ax, ay = turn(a.x, a.y, rot)
            bx, by = turn(b.x, b.y, rot)
            span = (bx - ax) * direction[0] + (by - ay) * direction[1]
            off = (bx - ax) * direction[1] - (by - ay) * direction[0]
            if span > 0 and off == 0:
                return rot, (ax, ay), span
        raise ValueError(f"{part.ref}: cannot orient pins {first}->{second}")

    # -- shunts and taps ----------------------------------------------------------

    def split_pins(self, part):
        """(pin on the node, pin on the rail) for a shunt or tap."""
        rail = "gnd" if part.role == "shunt" else "supply"
        one, two = (p.number for p in part.symbol.pins)
        if self.board.net_of(part.ref, one).kind == rail:
            return two, one
        return one, two

    def node_of(self, part):
        return self.net_name(part.ref, self.split_pins(part)[0])

    def vertical(self, cv, part, x, y):
        """Hang a shunt below (x, y), or stand a tap above it."""
        node_pin, rail_pin = self.split_pins(part)
        node, rail = self.net_name(part.ref, node_pin), self.net_name(part.ref, rail_pin)
        down = part.role == "shunt"
        top, bottom = (node_pin, rail_pin) if down else (rail_pin, node_pin)
        rot, (ax, ay), span = self.two_pin_pose(part, top, bottom, (0, 1))
        top_y = y + 2 if down else y - 2 - span
        origin = (x - ax, top_y - ay)
        body = body_box(part.symbol, origin, rot)
        mid, tx = top_y + span / 2, max(body[2], x + 0.5) + 0.8
        self.place(cv, part, origin, rot,
                   ref_text=Text(part.ref, tx, mid - 0.8, "left"),
                   value_text=Text(part.value, tx, mid + 0.8, "left"))
        key = f"{part.ref}.{rail_pin}"
        if down:
            cv.wire(node, (x, y), (x, top_y))
            cv.wire(rail, (x, top_y + span), (x, top_y + span + 1))
            self.power(cv, rail, (x, top_y + span + 1), key)
        else:
            cv.wire(node, (x, y), (x, y - 2))
            cv.wire(rail, (x, top_y), (x, top_y - 1))
            self.power(cv, rail, (x, top_y - 1), key)

    def column_width(self, parts):
        """(room left of the column's wire, room right of it)."""
        left, right = 3, 3
        for part in parts:
            texts = max(text_width(part.ref), text_width(part.value))
            half = 2 if part.symbol.body[2] - part.symbol.body[0] < 4 else 3
            right = max(right, half + texts + 1)
        return left, math.ceil(right)

    def columns(self, parts):
        """Pair a tap with a shunt so a pull-up sits straight above what it pulls up."""
        taps = [p for p in parts if p.role == "tap"]
        shunts = [p for p in parts if p.role == "shunt"]
        out = []
        for i in range(max(len(taps), len(shunts))):
            out.append(taps[i : i + 1] + shunts[i : i + 1])
        return out

    # -- multi-pin parts ------------------------------------------------------------

    def positions(self, part, mirror=None):
        """Connection points relative to the origin: {(x, y): (net, side, [pins])}."""
        out = {}
        for p in part.symbol.pins:
            pos = pin_at(p, (0, 0), 0, mirror)
            side = SIDES[pin_outward(p, 0, mirror)]
            entry = out.setdefault(pos, [self.net_name(part.ref, p.number), side, []])
            entry[2].append(p)
        return out

    def hub(self, part, spine: dict, mirror=None) -> Canvas:
        """A multi-pin part at the origin with everything on its pins. `spine`: {side: position}."""
        cv = Canvas()
        positions = self.positions(part, mirror)
        item = self.place(cv, part, (0, 0), 0, mirror)
        x0, y0, x1, y1 = item.body
        top_pins = [pos[0] for pos, e in positions.items() if e[1] == "U" and e[0]]
        if top_pins:  # keep the name clear of pins that leave through the top
            tx, just = min(top_pins) - 2.5, "right"
        else:
            tx, just = (x0 + x1) / 2, "center"
        item.ref_text = Text(part.ref, tx, y0 - 2.8, just)
        item.value_text = Text(part.value, tx, y0 - 1.2, just)

        for pos, (net, _side, pins) in positions.items():
            unused_nc = all(p.hidden and p.etype == "no_connect" for p in pins)
            if net is None and not unused_nc:
                cv.ncs.append((pos[0], pos[1], f"{part.ref}.{pins[0].number}"))

        for side, (dx, dy) in (("L", (-1, 0)), ("R", (1, 0)), ("U", (0, -1)), ("D", (0, 1))):
            along = 1 if side in "LR" else 0
            wired = sorted(
                ((pos, e) for pos, e in positions.items() if e[1] == side and e[0]),
                key=lambda it: it[0][along],
            )
            groups = []  # neighbours on the same net share one stub
            for pos, entry in wired:
                last = groups[-1] if groups else None
                if last and last[0] == entry[0] and pos[along] - last[1][-1][0][along] <= 4:
                    last[1].append((pos, entry))
                else:
                    groups.append((entry[0], [(pos, entry)]))
            for net, members in groups:
                pts = [pos for pos, _ in members]
                key = f"{part.ref}.{members[0][1][2][0].number}"
                on_spine = side in spine and spine[side] in pts
                spine_here = side in spine and positions[spine[side]][0] == net
                if on_spine and len(pts) == 1:
                    continue
                ends = [(p[0] + 2 * dx, p[1] + 2 * dy) for p in pts]
                for p, e in zip(pts, ends):
                    if not (on_spine and p == spine[side]):
                        cv.wire(net, p, e)
                if on_spine:
                    sx, sy = spine[side]
                    cv.wire(net, (sx, sy), (sx + 2 * dx, sy + 2 * dy))
                for a, b in zip(ends, ends[1:]):
                    cv.wire(net, a, b)
                if on_spine:
                    continue
                if spine_here:
                    # Same net as the spine pin (an enable tied to VIN): wire it, if the way is clear.
                    lo, hi = sorted((spine[side][along], ends[0][along]))
                    between = [p for p, e in wired if lo < p[along] < hi and e[0] != net]
                    if not between:
                        sx, sy = spine[side]
                        cv.wire(net, ends[0], (sx + 2 * dx, sy + 2 * dy))
                        cv.wire(net, (sx, sy), (sx + 2 * dx, sy + 2 * dy))
                        continue
                end = ends[0]
                if self.board.nets[net].is_power:
                    ground = self.board.nets[net].kind == "gnd"
                    if side == "L":
                        rot = 270 if ground else 90
                    elif side == "R":
                        rot = 90 if ground else 270
                    else:
                        rot = 0 if (side == "D") == ground else 180
                    self.power(cv, net, end, key, rot)
                elif side in "LR":
                    self.label(cv, net, end, side, key)
                else:
                    away = "L" if end[0] <= (x0 + x1) / 2 else "R"
                    tip = (end[0] + (-2 if away == "L" else 2), end[1])
                    cv.wire(net, end, tip)
                    self.label(cv, net, tip, away, key)
        return cv

    # -- chains ---------------------------------------------------------------------

    def part_nets(self, part):
        nets = (self.net_name(part.ref, p.number) for p in part.symbol.pins)
        return {n for n in nets if n and self.board.nets[n].kind != "gnd"}

    def split_chains(self, paths):
        chains = []
        for part in paths:
            if chains and self.link(chains[-1][-1], part):
                chains[-1].append(part)
            else:
                chains.append([part])
        return chains

    def link(self, a, b):
        """The net that joins a's output side to b's input side, if any."""
        shared = sorted(self.part_nets(a) & self.part_nets(b))
        for net in shared:
            if self.can_face(a, net, "R") and self.can_face(b, net, "L"):
                return net
        return None

    def mirror_of(self, part, first_in_chain, link_net):
        """Flip a multi-pin part whose link to the next part would leave on the wrong side."""
        if self.two_terminal(part) or link_net is None:
            return None
        sides = {e[1] for e in self.positions(part).values() if e[0] == link_net}
        return "y" if first_in_chain and sides == {"L"} else None

    def can_face(self, part, net, side):
        if self.two_terminal(part):
            return True
        return any(e[0] == net and e[1] == side for e in self.positions(part).values())

    def hub_pin(self, part, side, link_net, attached_nets):
        """Which position on `side` the main line goes through, or None."""
        positions = self.positions(part)
        options = sorted((pos for pos, e in positions.items() if e[1] == side and e[0]), key=lambda p: (p[1], p[0]))
        if link_net:
            return next((p for p in options if positions[p][0] == link_net), None)
        if len(positions) > SMALL_HUB:
            return None
        return next((p for p in options if positions[p][0] in attached_nets), None)

    def chain(self, parts, pending: dict, across: list) -> Canvas:
        """Draw one chain. Consumes the shunts and taps of its nodes from `pending`."""
        cv = Canvas()
        links = [self.link(a, b) for a, b in zip(parts, parts[1:])]

        poses = []  # per element: (in_pos, out_pos, in_net, out_net, canvas or (part, rot, span))
        for i, part in enumerate(parts):
            before = links[i - 1] if i else None
            after = links[i] if i < len(links) else None
            if self.two_terminal(part):
                one, two = (p.number for p in part.symbol.pins)
                n1, n2 = self.net_name(part.ref, one), self.net_name(part.ref, two)
                if before:
                    swap = n2 == before
                elif after:
                    swap = n1 == after
                else:
                    swap = n1 in pending and n2 not in pending
                a, b = (two, one) if swap else (one, two)
                rot, (ax, ay), span = self.two_pin_pose(part, a, b, (1, 0))
                half_h = max(abs(v - 0) for v in (body_box(part.symbol, (0, 0), rot)[1], body_box(part.symbol, (0, 0), rot)[3]))
                sub = Canvas()
                origin = (-ax, -ay)
                self.place(sub, part, origin, rot,
                           ref_text=Text(part.ref, origin[0], -half_h - 1.1),
                           value_text=Text(part.value, origin[0], half_h + 1.1))
                poses.append(((0, 0), (span, 0), self.net_name(part.ref, a), self.net_name(part.ref, b), sub))
            else:
                mirror = self.mirror_of(part, i == 0, after)
                pin_in = self.hub_pin(part, "L", before, pending) if not mirror else None
                pin_out = self.hub_pin(part, "R", after, pending)
                if pin_out and pin_in and self.positions(part)[pin_in][0] == self.positions(part)[pin_out][0]:
                    pin_out = None
                spine = {}
                if pin_in:
                    spine["L"] = pin_in
                if pin_out:
                    spine["R"] = pin_out
                sub = self.hub(part, spine, mirror)
                pos = self.positions(part, mirror)
                poses.append((pin_in, pin_out, pos[pin_in][0] if pin_in else None,
                              pos[pin_out][0] if pin_out else None, sub))

        nodes = [poses[0][2]] + [p[3] for p in poses]
        drops = {}  # (across ref, net) -> (x, y)
        bridged = [p for p in across if len({self.net_name(p.ref, q.number) for q in p.symbol.pins} & set(nodes)) == 2]
        x, y = 0, 0  # right end of what is drawn, and the main line's height

        for i, net in enumerate(nodes):
            element = poses[i] if i < len(poses) else None
            prev = poses[i - 1] if i else None
            if net is not None:
                start = x
                reach = x  # the furthest point of this node that something connects to
                attached = pending.pop(net, [])
                mine = [p for p in bridged if net in {self.net_name(p.ref, q.number) for q in p.symbol.pins}]
                here = {PinRef(p.ref, self.split_pins(p)[0]) for p in attached}
                for p in [*mine]:
                    here |= {PinRef(p.ref, q.number) for q in p.symbol.pins if self.net_name(p.ref, q.number) == net}
                for el, side in ((prev, 3), (element, 2)):
                    if el:
                        part = el[4].syms[0].part
                        here |= {PinRef(part.ref, q.number) for q in part.symbol.pins
                                 if self.net_name(part.ref, q.number) == net}
                elsewhere = set(self.board.nets[net].pins) - here
                is_power = self.board.nets[net].is_power
                if prev is None:  # input terminal, far left
                    if elsewhere:
                        if is_power:
                            self.power(cv, net, (x, y), f"{parts[0].ref}/in")
                        else:
                            self.label(cv, net, (x, y), "L", f"{parts[0].ref}/in")
                    x += 1
                for p in mine:
                    x += 4
                    drops[(p.ref, net)] = (x, y)
                    reach = x
                    x += 1
                for column in self.columns(attached):
                    left, right = self.column_width(column)
                    x += left
                    for part in column:
                        self.vertical(cv, part, x, y)
                    reach = x
                    x += right
                if elsewhere and prev is not None:
                    if element is None:  # output terminal, far right
                        x += 4
                        if is_power:
                            self.power(cv, net, (x, y), f"{parts[-1].ref}/out")
                        else:
                            self.label(cv, net, (x, y), "R", f"{parts[-1].ref}/out")
                        reach = x
                    elif is_power:
                        x += 4
                        self.power(cv, net, (x, y), f"{parts[i].ref}/node")
                        x += 3
                    else:
                        self.label(cv, net, (x + 1, y), "R", f"{parts[i].ref}/node", on_wire=True)
                        x += math.ceil(text_width(net)) + 3
                if element is not None:
                    x = max(x + 3, start + 5)
                end = x
            else:
                start = end = None

            if element is None:
                if net is not None:
                    cv.wire(net, (start, y), (reach, y))
                continue

            pin_in, pin_out, _, _, sub = element
            anchor = pin_in or pin_out or (0, 0)
            sx0, _, sx1, _ = sub.bbox()
            if pin_in:
                target_x = max(x, x + math.ceil(anchor[0] - sx0) - 2)  # clear what hangs on its left
                sub.move(target_x - anchor[0], y - anchor[1])
                if net is not None:
                    cv.wire(net, (start, y), (target_x, y))
                dx, dy = target_x - anchor[0], y - anchor[1]
            else:
                dx = (math.ceil(x - sx0) + 2) if cv.syms else -math.floor(sx0)
                dy = y - anchor[1]
                sub.move(dx, dy)
            cv.add(sub)
            if pin_out:
                out_x, out_y = pin_out[0] + dx, pin_out[1] + dy
                x, y = out_x, out_y
                if not self.two_terminal(parts[i]):
                    x = math.ceil(sx1 + dx)  # past the part's own stubs and labels
                    if nodes[i + 1] is not None:
                        cv.wire(nodes[i + 1], (out_x, out_y), (x, y))
            else:
                x = math.ceil(sx1 + dx)

        for part in bridged:
            across.remove(part)
            ends = sorted(((pos, net) for (ref, net), pos in drops.items() if ref == part.ref))
            (a, net_a), (b, net_b) = ends
            pin_a = next(q.number for q in part.symbol.pins if self.net_name(part.ref, q.number) == net_a)
            pin_b = next(q.number for q in part.symbol.pins if self.net_name(part.ref, q.number) == net_b)
            rot, (ax, ay), span = self.two_pin_pose(part, pin_a, pin_b, (1, 0))
            overhead = [bx[1] for bx in cv.boxes() if bx[2] > a[0] and bx[0] < b[0]]
            top = math.floor(min([a[1], b[1], *overhead])) - 4
            left = a[0] + (b[0] - a[0] - span) // 2
            origin = (left - ax, top - ay)
            self.place(cv, part, origin, rot,
                       ref_text=Text(part.ref, origin[0], top - 2),
                       value_text=Text(part.value, origin[0], top + 2))
            cv.wire(net_a, a, (a[0], top))
            cv.wire(net_a, (a[0], top), (left, top))
            cv.wire(net_b, (left + span, top), (b[0], top))
            cv.wire(net_b, (b[0], top), b)
        return cv

    def cluster(self, net, parts) -> Canvas:
        """Shunts and taps away from any chain: name on the left, columns along a short rail."""
        cv = Canvas()
        key = f"{parts[0].ref}/cluster"
        is_power = self.board.nets[net].is_power
        x = 0
        columns = self.columns(parts)
        if is_power:
            self.power(cv, net, (0, 0), key)
            x = 1
        else:
            self.label(cv, net, (0, 0), "L", key)
        last = 0
        for column in columns:
            left, right = self.column_width(column)
            x += left
            for part in column:
                self.vertical(cv, part, x, 0)
            last = x
            x += right
        cv.wire(net, (0, 0), (last, 0))
        return cv

    def flag_cluster(self, net) -> Canvas:
        """PWR_FLAG on a net fed from off the board, kept out of the way of the circuit."""
        cv = Canvas()
        self.flag(cv, net, (0, 0), "ext")
        cv.wire(net, (0, 0), (10, 0))
        self.power(cv, net, (10, 0), "ext-flag")
        return cv

    # -- blocks and sheet -------------------------------------------------------------

    def block(self, blk) -> Canvas:
        pending: dict = {}
        across = []
        for part in blk.parts:
            if part.role in ("shunt", "tap"):
                pending.setdefault(self.node_of(part), []).append(part)
            elif part.role == "across":
                across.append(part)
        paths = [p for p in blk.parts if p.role == "path"]
        chains = [self.chain(group, pending, across) for group in self.split_chains(paths)]
        if across:
            raise ValueError(f"across parts not bridging two nodes of one chain: {[p.ref for p in across]}")
        # The first chain is the block's main line; later chains flow with the clusters.
        groups = self.split_chains(paths)
        satellites = [(cv, set().union(*(self.part_nets(p) for p in grp))) for cv, grp in zip(chains[1:], groups[1:])]
        satellites += [(self.cluster(net, parts), {net}) for net, parts in pending.items()]
        chains = chains[:1]
        # A block with a big part (more than SMALL_HUB pins) stacks its clusters in columns to its right;
        # otherwise they stand in a row below. One rule, so one more part never flips a learned sheet.
        hub = max(paths, key=lambda p: len(p.symbol.pins), default=None)
        below = hub is None or len(hub.symbol.pins) <= SMALL_HUB
        self.arrangements[blk.key] = "below" if below else "right"

        out = Canvas()
        bottom, right = 0, 0
        for cv in chains:
            bx = cv.bbox()
            cv.move(-math.floor(bx[0]), bottom - math.floor(bx[1]))
            bx = cv.bbox()
            bottom, right = math.ceil(bx[3]) + 5, max(right, math.ceil(bx[2]))
            out.add(cv)

        satellites = self.order_satellites(out, hub, satellites, below)
        for net in self.board.nets.values():
            if net.external and blk is self.board.blocks[0]:
                satellites.append(self.flag_cluster(net.name))

        if satellites:
            sizes = [cv.bbox() for cv in satellites]
            tallest = max(b[3] - b[1] for b in sizes)
            if below:
                # Short chain: put the clusters underneath, in a row.
                cx, cy, limit, row_h = 0, bottom, max(right, 60), 0
                for cv in satellites:
                    bx = cv.bbox()
                    w, h = math.ceil(bx[2] - bx[0]), math.ceil(bx[3] - bx[1])
                    if cx and cx + w > limit:
                        cx, cy, row_h = 0, cy + row_h + 4, 0
                    cv.move(cx - math.floor(bx[0]), cy - math.floor(bx[1]))
                    out.add(cv)
                    cx, row_h = cx + w + 5, max(row_h, h)
            else:
                # Tall chain (a big IC): fill columns to its right.
                height = max(bottom, math.ceil(tallest) + 1, 44)
                cx, cy, col_w = (right + 6 if chains else 0), 0, 0
                for cv in satellites:
                    bx = cv.bbox()
                    w, h = math.ceil(bx[2] - bx[0]), math.ceil(bx[3] - bx[1])
                    if cy and cy + h > height:
                        cx, cy, col_w = cx + col_w + 6, 0, 0
                    cv.move(cx - math.floor(bx[0]), cy - math.floor(bx[1]))
                    out.add(cv)
                    cy, col_w = cy + h + 4, max(col_w, w)
        return out

    def order_satellites(self, drawn, hub, satellites, below):
        """Clusters in the order of the hub pins they serve (left to right below, top to bottom on the
        right); clusters that serve no hub pin keep their declaration order after them."""
        if hub is None:
            return [cv for cv, _ in satellites]
        pins = [(p.x, p.y, p.net) for p in drawn.pins if p.ref == hub.ref and p.net]

        def key(item):
            i, (cv, nets) = item
            spots = [(x, y) if below else (y, x) for x, y, net in pins if net in nets]
            return (0, min(spots), i) if spots else (1, (0, 0), i)

        return [cv for _, (cv, _) in sorted(enumerate(satellites), key=key)]

    # -- net names ----------------------------------------------------------------

    def name_every_net(self, canvases):
        """Every signal net gets a global label, so KiCad exports it under its board.py name.

        A net that only has a plain mid-wire label gets that label boxed; a net drawn only as
        wire gets a boxed label on a two-grid stub from the first of its points with room.
        """
        labels = [lab for cv in canvases for lab in cv.labels]
        for net in self.board.nets.values():
            if net.is_power or any(lab.net == net.name and lab.is_global for lab in labels):
                continue
            plain = sorted((lab for lab in labels if lab.net == net.name), key=lambda lab: lab.key)
            if plain:
                plain[0].is_global = True
                continue
            for cv in canvases:
                if self._stub_label(cv, net.name):
                    break

    def _stub_label(self, cv, net) -> bool:
        from .writer import DrawingError, connect  # the writer's own geometry check decides

        points = sorted({w.a for w in cv.wires if w.net == net} | {w.b for w in cv.wires if w.net == net}
                        | {(p.x, p.y) for p in cv.pins if p.net == net})
        if not points:
            return False
        others = [b for b in self._obstacles(cv, net)]
        for x, y in points:
            for out, (dx, dy) in (("U", (0, -1)), ("D", (0, 1)), ("L", (-1, 0)), ("R", (1, 0))):
                end = (x + 2 * dx, y + 2 * dy)
                lab = Label(net, end[0], end[1], out, True, f"{net}/name")
                box = lab.box()
                sx, sy = x + 0.5 * dx, y + 0.5 * dy  # the stub leaves its own point: start just past it
                stub = (min(sx, end[0]), min(sy, end[1]), max(sx, end[0]), max(sy, end[1]))
                if any(_meets(box, o) or _meets(stub, o) for o in others):
                    continue
                cv.wire(net, (x, y), end)
                cv.labels.append(lab)
                try:
                    connect(cv)
                except DrawingError:
                    cv.wires.pop()
                    cv.labels.pop()
                    continue
                return True
        return False

    @staticmethod
    def _obstacles(cv, net):
        for s in cv.syms:
            yield s.body
            for t in (s.ref_text, s.value_text):
                if not t.hidden:
                    yield t.box()
        for lab in cv.labels:
            yield lab.box()
        for w in cv.wires:
            if w.net != net:
                yield (min(w.a[0], w.b[0]), min(w.a[1], w.b[1]), max(w.a[0], w.b[0]), max(w.a[1], w.b[1]))
        for p in cv.pins:
            if p.net != net:
                yield (p.x, p.y, p.x, p.y)
        for x, y, _ in cv.ncs:
            yield (x - 0.5, y - 0.5, x + 0.5, y + 0.5)

    def sheet(self):
        """Blocks left to right in declaration order, wrapping to a new row on the page."""
        drawn = [(blk, self.block(blk)) for blk in self.board.blocks]
        self.name_every_net([cv for _, cv in drawn])
        pages = [("A4", 297, 210), ("A3", 420, 297), ("A2", 594, 420), ("A1", 841, 594)]
        margin, gap, pad = 10, 5, 3
        for name, w_mm, h_mm in pages:
            width, height = int(w_mm / GRID) - 2 * margin, int(h_mm / GRID) - 2 * margin - 24
            rows, row, used = [], [], 0
            for blk, cv in drawn:
                bx = cv.bbox()
                size = (
                    math.ceil(max(bx[2] - bx[0], text_width(blk.title) * 1.5)) + 2 * pad,
                    math.ceil(bx[3] - bx[1]) + 2 * pad + 3,
                )
                if row and used + gap + size[0] > width:
                    rows.append(row)
                    row, used = [], 0
                row.append((blk, cv, size, bx))
                used += size[0] + (gap if len(row) > 1 else 0)
            rows.append(row)
            total_h = sum(max(s[1] for _, _, s, _ in r) for r in rows) + gap * (len(rows) - 1)
            if total_h <= height and all(s[0] <= width for r in rows for _, _, s, _ in r):
                break
        sheet, top = Canvas(), margin
        for row in rows:
            left, row_h = margin, max(s[1] for _, _, s, _ in row)
            for blk, cv, (w, _), bx in row:
                moved = Canvas()
                cv.move(left + pad - math.floor(bx[0]), top + pad + 3 - math.floor(bx[1]))
                moved.add(cv)
                h = next(s[1] for b, _, s, _ in row if b is blk)
                moved.frames.append(Frame(blk.title, blk.key, (left, top, left + w, top + h),
                                          self.arrangements.get(blk.key, "")))
                sheet.add(moved)
                left += w + gap
            top += row_h + gap
        return sheet, name


def layout_sheet(circuit: Circuit, symbols: SymbolLibrary) -> tuple[Canvas, str]:
    """Lay the circuit out on one sheet: (canvas in grid units, paper size)."""
    return Layout(Model(circuit, symbols), symbols).sheet()



def _meets(a, b) -> bool:
    """Boxes overlap (with a small margin)."""
    pad = 0.05
    return a[0] < b[2] + pad and b[0] < a[2] + pad and a[1] < b[3] + pad and b[1] < a[3] + pad
