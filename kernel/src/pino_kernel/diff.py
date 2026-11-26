# Ported from pcb-kit (https://github.com/somebox/pcb-kit, commit 32867ca). MIT License, Copyright (c) 2026 Jeremy Seitz. See NOTICE.
"""What changed between two builds, in words: the circuit (parts, values, connections by pin) and the layout
(parts moved, turned or flipped, tracks, vias, zones, outline, silkscreen).

Ported from pcb-kit's release/versions.py. Functions take a board's text, never a path; the release parts
of layout() (title block, printed fields, masked version stamps) are left out, so silkscreen texts are
compared as written.
"""

from __future__ import annotations

import hashlib
import json
import math
import re

from .sexpr import Sym, dump, parse

BOM_FIELDS = ("LCSC", "MPN")            # with the footprint and value: what a part is, as the BOM orders it
BOM_FLAGS = ("dnp", "exclude_from_bom")  # a part not fitted, or not bought with the board


def _hidden(node):
    for c in node:
        if c == "hide" or (isinstance(c, list) and c[:2] == ["hide", "yes"]):
            return True
        if isinstance(c, list) and c and c[0] == "effects" and _hidden(c[1:]):
            return True
    return False


def _quote(s, most=60):
    s = s.replace("\\n", " / ").replace("\n", " / ")       # a new line as the file writes it, or as read
    return "'" + (s if len(s) <= most else s[:most - 3] + "...") + "'"


def circuit(text: str) -> dict:
    """The board's netlist and BOM as its .kicad_pcb has them (or text, the file's text, from git or a release), read
    as S-expressions (however the file is laid out: KiCad 8 and later indent with tabs, 6 and 7 with spaces): parts,
    one [reference, footprint name, value, LCSC, MPN, flags] row a footprint, in reference order, and nets, {name:
    sorted [reference, pad] pins}. Board-only footprints (logos, a test pad drawn on the board) are neither parts nor
    pins. A pad on no net, or on KiCad's unconnected-(...) net for a pin left open, is on none. KiCad 6 and 7 keep the
    reference and value as fp_text, and write a pad's net as (net 3 "name"), KiCad 10 as (net "name")."""
    tree = parse(text)
    parts, nets = [], {}
    for fp in tree[1:] if isinstance(tree, list) else []:
        if not isinstance(fp, list) or len(fp) < 2 or fp[0] not in ("footprint", "module"):
            continue
        props, flags, pads = {}, set(), []
        for c in fp[2:]:
            if not isinstance(c, list) or len(c) < 2:
                continue
            if c[0] == "property" and len(c) > 2:
                props.setdefault(str(c[1]), str(c[2]))
            elif c[0] == "fp_text" and len(c) > 2 and c[1] in ("reference", "value"):
                props.setdefault(str(c[1]).capitalize(), str(c[2]))
            elif c[0] == "attr":
                flags |= {str(x) for x in c[1:] if not isinstance(x, list)}
            elif c[0] in ("dnp", "exclude_from_bom", "board_only") and c[1] == "yes":
                flags.add(str(c[0]))
            elif c[0] == "pad":
                pads.append(c)
        if "board_only" in flags:
            continue
        ref = props.get("Reference", "")
        parts.append([ref, str(fp[1]).split(":")[-1], props.get("Value", "")]
                     + [props.get(f, "").strip() for f in BOM_FIELDS] + [sorted(flags & set(BOM_FLAGS))])
        for pad in pads:
            net = next((x for x in pad[2:] if isinstance(x, list) and len(x) > 1 and x[0] == "net"), None)
            name = str(net[-1]) if net else ""
            if str(pad[1]) and name and not name.startswith("unconnected-("):
                nets.setdefault(name, set()).add((ref, str(pad[1])))
    return dict(parts=sorted(parts, key=lambda r: (_natural(r[0]), r)),        # R1 and R01 sort alike: then by all
                nets={n: sorted([list(p) for p in v], key=lambda p: (_natural(p[0]), _natural(p[1]), p))
                      for n, v in sorted(nets.items())})


def _natural(s):
    return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", s)]


def _connections(c):
    """The nets as sets of pins, without their names: a net renamed is the same circuit. A net of one pin connects
    nothing."""
    return [(n, frozenset(map(tuple, pins))) for n, pins in c["nets"].items() if len(pins) > 1]


def circuit_fingerprint(c):
    """A hash of circuit(): the parts and the connections between their pins, not the nets' names."""
    nets = sorted(sorted(pins) for _, pins in _connections(c))
    return hashlib.sha1(json.dumps({"parts": c["parts"], "nets": nets}, sort_keys=True).encode()).hexdigest()


def _pins(ps, most=6):
    ps = sorted(ps, key=lambda p: (_natural(p[0]), _natural(p[1])))
    out = ", ".join(f"{r}.{n}" for r, n in ps[:most])
    return out + (f", ... ({len(ps)} pins)" if len(ps) > most else "")


def circuit_changes(old, new):
    """What changed from one circuit() to another, in words: parts added, removed or changed ("R3 value 10k -> 4.7k"),
    then the connections ("net VIN gains U2.5"), each net named as the new circuit names it. Empty when their
    fingerprints are the same."""
    out = []
    a, b = ({r[0]: r for r in c["parts"]} for c in (old, new))
    names = ("footprint", "value") + BOM_FIELDS
    for ref in sorted(set(a) | set(b), key=_natural):
        x, y = a.get(ref), b.get(ref)
        if not x:
            out.append(f"adds {ref} (" + ", ".join(v for v in [y[2], y[1]] + y[3:-1] if v) + ")")
        elif not y:
            out.append(f"removes {ref}")
        else:
            out += [f"{ref} {k} {u or '(none)'} -> {v or '(none)'}"
                    for k, u, v in zip(names, x[1:-1], y[1:-1]) if u != v]
            for f in BOM_FLAGS:
                if (f in x[-1]) != (f in y[-1]):
                    word = "DNP" if f == "dnp" else "out of the BOM"
                    out.append(f"{ref} {word}" if f in y[-1] else f"{ref} no longer {word}")
    was, now = _connections(old), _connections(new)
    gone = [(n, s) for n, s in was if s not in {s for _, s in now}]
    came = [(n, s) for n, s in now if s not in {s for _, s in was}]
    # each net that changed is matched with the old net it shares most pins with (the same name first, on a tie), or
    # failing that with the old net of its name, even with every pin replaced: one change, said once
    pairs = sorted(((len(s & t), n == m, i, j) for i, (n, s) in enumerate(came) for j, (m, t) in enumerate(gone)
                    if s & t or n == m), reverse=True)
    matched, used = {}, set()
    for _, _, i, j in pairs:
        if i not in matched and j not in used:
            matched[i] = j
            used.add(j)
    def moved(name, s, t):
        what = [f"gains {_pins(s - t)}"] * bool(s - t) + [f"loses {_pins(t - s)}"] * bool(t - s)
        return f"net {name} " + " and ".join(what)
    for i, (n, s) in enumerate(came):
        if i in matched:
            m, t = gone[matched[i]]
            out.append(moved(n if n == m else f"{m} (now {n})", s, t))
        elif n in old["nets"]:                  # it had one pin, which connected nothing
            out.append(moved(n, s, set(map(tuple, old["nets"][n]))))
        else:
            out.append(f"adds net {n} ({_pins(s)})")
    for j, (m, t) in enumerate(gone):
        if j in used:
            continue
        if m in new["nets"]:                    # down to one pin
            out.append(moved(m, set(map(tuple, new["nets"][m])), t))
        else:
            out.append(f"removes net {m} ({_pins(t)})")
    if not out and circuit_fingerprint(old) != circuit_fingerprint(new):
        out.append("the netlist or BOM changed")
    return out


def _xy(node):
    return float(node[1]), float(node[2])


def _arc_length(a, m, b):
    """The length of the arc from a through m to b."""
    (ax, ay), (mx, my), (bx, by) = a, m, b
    d = 2 * (ax * (my - by) + mx * (by - ay) + bx * (ay - my))
    if abs(d) < 1e-12:                 # the three in a line
        return math.hypot(bx - ax, by - ay)
    sa, sm, sb = ax * ax + ay * ay, mx * mx + my * my, bx * bx + by * by
    ux = (sa * (my - by) + sm * (by - ay) + sb * (ay - my)) / d
    uy = (sa * (bx - mx) + sm * (ax - bx) + sb * (mx - ax)) / d
    t0, tm, t1 = (math.atan2(y - uy, x - ux) for x, y in (a, m, b))
    sweep = (t1 - t0) % (2 * math.pi)
    if (tm - t0) % (2 * math.pi) > sweep:      # m is on the other side: the arc goes the long way round
        sweep = 2 * math.pi - sweep
    return math.hypot(ax - ux, ay - uy) * sweep


def _child(node, key):
    return next((c for c in node if isinstance(c, list) and c and c[0] == key), None)


def _drawn(node, drop=()):
    """An item as drawn, to compare: the file's S-expression without its uuid and the children named in drop; a
    zone's (fill yes ...) without the yes, which says whether it was filled when saved."""
    return dump([[y for y in x if y != "yes"] if isinstance(x, list) and x[:1] == ["fill"] else x
                      for x in node if not (isinstance(x, list) and x and x[0] in ("uuid", "tstamp") + drop)])


def _net_named(node, codes):
    """A track or via with its (net 3) as (net "GND"): KiCad 6 to 9 number the nets anew when one is added."""
    return [[x[0], codes.get(str(x[1]), x[1])] if isinstance(x, list) and len(x) == 2 and x[0] == "net"
            and isinstance(x[1], Sym) else x for x in node]    # x[0] is the bare head, as KiCad 10 writes it


def _net_name(node, codes):
    """A zone's or pad's net by name: (net_name "GND"), (net "GND"), or a bare code through the board's net table; a
    quoted name that is a number ("5") is a name."""
    net = _child(node, "net_name") or _child(node, "net")
    v = net[-1] if net and len(net) > 1 else None
    return codes.get(str(v), "") if isinstance(v, Sym) else str(v) if v is not None else ""


def _in_frame(node, angle):
    """A footprint's pad or text with its angle in the footprint's frame: the file writes it turned with the part."""
    out = []
    for x in node:
        if isinstance(x, list) and x[:1] == ["at"] and len(x) >= 3:
            a = float(x[3]) if len(x) > 3 and not isinstance(x[3], list) and str(x[3]) not in ("unlocked",) else 0.0
            x = [x[0], x[1], x[2], Sym(f"{round((a - angle) % 360, 2):g}")] + x[4:]
        out.append(x)
    return out


def layout(text: str) -> dict:
    """What a board's layout is made of, to say what changed (layout_changes): parts, {reference: (x, y, angle, side,
    board only)}; tracks and their length in mm (segments and arcs); vias; where the tracks and vias are (a hash, by
    net name); zones, ("<net> on <layers>", the zone as drawn: outline and settings, not its fill or net code); the
    outline (its Edge.Cuts drawings, without their uuids); the silkscreen texts, (the text with a version or ISO date
    typed into it masked, its place, layer and font); each footprint's shown silkscreen texts, as drawn in the
    footprint's frame; and the title and company, with which of them the board's own texts print."""
    tree = parse(text)
    out = dict(parts={}, tracks=0, length=0.0, vias=0, zones=[], outline=[], silk=[], fp_silk={}, pads={})
    codes = {str(x[1]): str(x[2]) for x in tree[1:] if isinstance(x, list) and len(x) > 2 and x[0] == "net"} \
        if isinstance(tree, list) else {}
    copper = []                        # where each track and via is, to tell routing moved from routing the same
    for c in tree[1:] if isinstance(tree, list) else []:
        if not isinstance(c, list) or not c:
            continue
        head, layer = c[0], _child(c, "layer")
        layer = str(layer[1]) if layer and len(layer) > 1 else ""
        if head in ("segment", "arc", "via"):
            copper.append(_drawn(_net_named(c, codes)))
        if head in ("footprint", "module"):
            ref = next((str(x[2]) for x in c if isinstance(x, list) and len(x) > 2 and x[0] in ("property", "fp_text")
                        and x[1] in ("Reference", "reference")), "")
            at = _child(c, "at") or ["at", 0, 0]
            key, n = ref, 1
            while key in out["parts"]:                # two footprints of one reference (or none)
                n += 1
                key = f"{ref}#{n}"
            board_only = (_child(c, "board_only") or [])[1:2] == ["yes"] or \
                "board_only" in [str(x) for x in (_child(c, "attr") or [])[1:]]
            out["parts"][key] = (round(float(at[1]), 3), round(float(at[2]), 3),
                                 round(float(at[3]) % 360 if len(at) > 3 else 0.0, 2),
                                 "back" if layer.startswith("B.") else "front", board_only)
            turn = float(at[3]) if len(at) > 3 else 0.0
            out["fp_silk"][key] = sorted(_drawn(_in_frame(x, turn)) for x in c if isinstance(x, list) and
                                         x[:1] in (["property"], ["fp_text"], ["fp_text_box"]) and not _hidden(x)
                                         and str((_child(x, "layer") or ["", ""])[1]).endswith(".SilkS"))
            # the pads and holes as the part has them, without their nets (the circuit says those)
            out["pads"][key] = (str(c[1]), sorted(_drawn(_in_frame(x, turn), ("net", "pinfunction", "pintype"))
                                                  for x in c if isinstance(x, list) and x[:1] == ["pad"]))
        elif head == "segment":
            out["tracks"] += 1
            out["length"] += math.hypot(*(p - q for p, q in zip(_xy(_child(c, "end")), _xy(_child(c, "start")))))
        elif head == "arc" and _child(c, "mid"):     # a track's arc (a drawn one is a gr_arc)
            out["tracks"] += 1
            out["length"] += _arc_length(*(_xy(_child(c, k)) for k in ("start", "mid", "end")))
        elif head == "via":
            out["vias"] += 1
        elif head == "zone":
            name = _net_name(c, codes)
            layers = _child(c, "layers") or _child(c, "layer") or []
            out["zones"].append((f"{name or 'no net'} on {', '.join(str(x) for x in layers[1:])}",
                                 _drawn(c, ("filled_polygon", "fill_segments", "net", "net_name"))))
        elif head.startswith("gr_") and layer == "Edge.Cuts":
            out["outline"].append(dump([x for x in c if not (isinstance(x, list) and x and x[0] in
                                                                   ("uuid", "tstamp"))]))
        elif head in ("gr_text", "gr_text_box") and layer.endswith(".SilkS") and len(c) > 1:
            out["silk"].append((str(c[1]), _drawn(c[:1] + c[2:])))
    out["length"] = round(out["length"], 1)
    out["copper"] = hashlib.sha1("\n".join(sorted(copper)).encode()).hexdigest()
    out["zones"].sort()
    out["outline"].sort()
    out["silk"].sort()
    return out


def _refs(refs, most=8):
    refs = sorted(refs, key=_natural)
    return ", ".join(refs[:most]) + (f" and {len(refs) - most} more" if len(refs) > most else "")


def layout_changes(old, new):
    """What changed from one layout() to another, in words: parts moved, turned or put on the other side, board-only
    footprints added or removed (circuit_changes says the rest), the tracks, vias and zones, the outline and the
    silkscreen texts."""
    out = []
    a, b = old["parts"], new["parts"]
    both = [r for r in b if r in a]
    moved = [r for r in both if a[r][:2] != b[r][:2]]
    turned = [r for r in both if a[r][2] != b[r][2] and a[r][3] == b[r][3]]
    sides = [r for r in both if a[r][3] != b[r][3]]
    if moved:
        out.append(f"moves {len(moved)} part{'s' * (len(moved) > 1)}: {_refs(moved)}")
    if turned:
        out.append("turns " + ", ".join(f"{r} {a[r][2]:g} -> {b[r][2]:g}" for r in sorted(turned, key=_natural)[:8])
                   + (f" and {len(turned) - 8} more" if len(turned) > 8 else ""))
    for side in ("back", "front"):
        flipped = [r for r in sides if b[r][3] == side]
        if flipped:
            out.append(f"puts {_refs(flipped)} on the {side}")
    added = [r for r in b if r not in a and b[r][4]]
    gone = [r for r in a if r not in b and a[r][4]]
    if added:
        out.append(f"adds the board-only {_refs(added)}")
    if gone:
        out.append(f"removes the board-only {_refs(gone)}")
    if (old["tracks"], old["length"]) != (new["tracks"], new["length"]):
        out.append(f"tracks {old['tracks']} -> {new['tracks']}, {old['length']:g} -> {new['length']:g} mm")
    if old["vias"] != new["vias"]:
        out.append(f"vias {old['vias']} -> {new['vias']}")
    if (old["tracks"], old["length"], old["vias"]) == (new["tracks"], new["length"], new["vias"]) and \
            old.get("copper") != new.get("copper"):
        out.append("tracks or vias moved or resized (as many, as long)")
    for z, n, m, same in _by_name(old["zones"], new["zones"]):
        if m > n:
            out.append(f"adds a zone: {z}" + (f" (x{m - n})" if m - n > 1 else ""))
        elif n > m:
            out.append(f"removes a zone: {z}" + (f" (x{n - m})" if n - m > 1 else ""))
        elif not same:
            out.append(f"changes a zone: {z} (its outline or settings)")
    if old["outline"] != new["outline"]:
        out.append("the outline (Edge.Cuts) changed")
    silk = list(_by_name(old["silk"], new["silk"]))
    out += [f"silkscreen adds {_quote(t)}" + (f" (x{m - n})" if m - n > 1 else "") for t, n, m, _ in silk if m > n]
    out += [f"silkscreen removes {_quote(t)}" + (f" (x{n - m})" if n - m > 1 else "") for t, n, m, _ in silk if n > m]
    out += [f"silkscreen moves or restyles {_quote(t)}" for t, n, m, same in silk if n == m and not same]
    pa, pb = old.get("pads", {}), new.get("pads", {})
    pads = [r for r in pb if r in pa and pa[r][0] == pb[r][0] and pa[r][1] != pb[r][1]]   # the same footprint name
    if pads:
        out.append(f"changes the pads or holes of {len(pads)} part{'s' * (len(pads) > 1)}: {_refs(pads)}")
    fa, fb = old.get("fp_silk", {}), new.get("fp_silk", {})
    texts = [r for r in fb if r in fa and fa[r] != fb[r]]
    if texts:
        out.append(f"moves or restyles the silkscreen texts of {len(texts)} part{'s' * (len(texts) > 1)}: "
                   f"{_refs(texts)}")
    return out


def _by_name(old, new):
    """Items as (name, how drawn) pairs, by name: (name, how many before, how many now, drawn the same)."""
    for name in sorted({k for k, _ in old} | {k for k, _ in new}):
        a, b = sorted(d for k, d in old if k == name), sorted(d for k, d in new if k == name)
        yield name, len(a), len(b), a == b


# ---- git -------------------------------------------------------------------------------------------------------------


def changes(old_pcb: str | None, new_pcb: str) -> dict[str, list[str]]:
    """{"circuit": [...], "layout": [...]} from the previous build's board text to this one's."""
    if old_pcb is None:
        return {"circuit": ["first build"], "layout": []}
    return {"circuit": circuit_changes(circuit(old_pcb), circuit(new_pcb)),
            "layout": layout_changes(layout(old_pcb), layout(new_pcb))}
