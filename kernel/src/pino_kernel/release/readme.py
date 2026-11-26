"""The fab folder's README.md: what to upload, which parts, and what to check. No dates, so the same board gives the
same bytes."""

from __future__ import annotations

from typing import Mapping, Sequence

from ..checks.parts import assembled, lcsc_of
from ..circuit import Circuit
from ..fab import FabProfile
from ..parts.jlcsearch import PartLookup
from ..symbols import natural
from .jlc import CplRow

ORIGIN_LINE = ("Positions in the CPL are millimetres from the centre of the board outline, y up; the Gerbers use the "
               "same origin.")


def _refs(refs) -> str:
    return ", ".join(sorted(refs, key=natural))


def _sides(rows: Sequence[CplRow]) -> str:
    layers = {r.layer for r in rows}
    if layers == {"top", "bottom"}:
        return "standard assembly, both sides (standard assembly needs a board of at least 70 x 70 mm)"
    return f"economic assembly, {'bottom' if layers == {'bottom'} else 'top'} side only"


def _upload(m: dict, rows: Sequence[CplRow], circuit: Circuit, profile: FabProfile) -> list[str]:
    stem = f"{m['slug']}-v{m['version']}"
    size = f"{circuit.outline.width:g} x {circuit.outline.height:g} mm"
    inner = f", inner copper {profile.inner_copper_oz:g} oz" if profile.inner_copper_oz else ""
    out = [f"1. PCB order: upload `{stem}-gerbers.zip`. {circuit.layers} layers, {size}, "
           f"{profile.board_thickness:g} mm thick, {profile.copper_oz:g} oz copper{inner}."]
    if rows:
        out.append(f"2. Assembly: choose {_sides(rows)}. Upload `{stem}-bom.csv` as the BOM and `{stem}-cpl.csv` as "
                   "the CPL (placement) file.")
    else:
        out.append("2. Assembly: nothing for JLC to place on this board.")
    return out


def unconfirmed_stock(circuit: Circuit, rows: Sequence[CplRow], lookups: Mapping[str, PartLookup]) -> dict[str, list[str]]:
    """The placed LCSC numbers whose stock jlcsearch did not confirm just now, each with its parts."""
    placed = {r.ref for r in rows}
    out: dict[str, list[str]] = {}
    for part in circuit.parts:
        lcsc = lcsc_of(part)
        if part.ref not in placed or lcsc is None:
            continue
        lookup = lookups.get(lcsc)
        if lookup is None or lookup.error or lookup.info is None or lookup.info.stock is None:
            out.setdefault(lcsc, []).append(part.ref)
    return out


def _parts(rows: Sequence[CplRow], circuit: Circuit, lookups: Mapping[str, PartLookup]) -> list[str]:
    placed = {r.ref for r in rows}
    by_class: dict[str, set[str]] = {}
    extended = []
    for part in circuit.parts:
        if part.ref not in placed:
            continue
        lcsc = lcsc_of(part)
        info = lookups[lcsc].info if lcsc in lookups else None
        klass = info.klass if info else "not known"
        by_class.setdefault(klass, set()).add(lcsc)
        if klass == "extended":
            extended.append(f"- {part.ref} {lcsc} ({part.value}): {part.why}")
    counts = ", ".join(f"{len(by_class[k])} {k}" for k in ("basic", "preferred", "extended", "not known")
                       if k in by_class)
    out = [f"JLC places {len(rows)} parts. Part types: {counts or 'none'}."]
    if extended:
        out += ["", "Extended parts (JLC charges a setup fee per part type):", *extended]
    unsure = unconfirmed_stock(circuit, rows, lookups)
    if unsure:
        named = ", ".join(f"{lcsc} ({_refs(refs)})" for lcsc, refs in unsure.items())
        out += ["", f"Stock pino could not confirm (check it before you order): {named}."]
    hand = [p.ref for p in circuit.parts if p.hand_fit and not p.dnp]
    unfitted = [p.ref for p in circuit.parts if p.dnp]
    if hand:
        out += ["", f"Parts soldered by hand, not in the BOM or CPL: {_refs(hand)}."]
    if unfitted:
        out += ["", f"Parts not fitted (DNP): {_refs(unfitted)}."]
    return out


def _turned(r: CplRow) -> str:
    if r.override:
        return f"its rotation comes from board.py ({r.correction:g} degrees)"
    if r.rule is None:
        return "pino has no rule for this footprint, so it keeps KiCad's angle"
    done = f"turned it {r.correction:g} degrees" if r.correction else "keeps KiCad's angle"
    return f"pino {done} by a rule not yet checked in JLC's preview"


def _checks(rows: Sequence[CplRow]) -> list[str]:
    unsure = [r for r in rows if r.needs_check]
    if not unsure:
        return ["No rotation here needs a check. Still look at the preview before you pay, and check that each part "
                "sits on its pads."]
    out = ["JLC shows where each part will go before you pay. For each part below, check there that it sits on its "
           "pads and that pin 1, or the polarity mark, matches the silkscreen. If one is turned, add rotation= for "
           "that part in board.py and release again. If one sits off its pads, move it in JLC's preview before you "
           "order.", ""]
    out += [f"- {r.ref} {r.package}: {_turned(r)}" for r in unsure]
    return out


def readme(m: dict, rows: Sequence[CplRow], circuit: Circuit, lookups: Mapping[str, PartLookup],
           profile: FabProfile) -> str:
    lines = [f"# {m['board']} v{m['version']}, fab files for JLCPCB", "",
             f"Made by pino-kernel {m['kernel']} from build h{m['build']['number']} ({m['build']['hash']}) and route "
             f"r{m['route']['number']} ({m['route']['key']}), with kicad-cli {m['kicad_cli']}. Fab limits: "
             f"{profile.title}.", "",
             "## What to upload", "", *_upload(m, rows, circuit, profile), "",
             "## Parts", "", *_parts(rows, circuit, lookups), "",
             "## Check in JLC's placement preview", "", *_checks(rows), ""]
    if m["previous"]:
        lines += [f"## Changes since v{m['previous']}", "", *[f"- {w}" for w in m["why"]], ""]
    lines += [ORIGIN_LINE, ""]
    return "\n".join(lines)
