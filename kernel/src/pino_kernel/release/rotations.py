"""The CPL rotation correction for each KiCad footprint family: pino's own table, data/jlc/rotations.csv.

KiCad draws its footprints in the IPC-7x51 zero orientation (pin 1 upper left, polarity on the left). JLC's zero
orientation is how the part sits in its tape ("Zero orientation for PCB library should match the component
orientation in the packaging(tape/reel)", https://jlcpcb.com/help/article/pcb-assembly-faqs-part-2), and EIA-481-D
says where pin 1 is there for each package family (as summed up in PCB Libraries' "Zero Component Orientation for
IPC, IEC and EIA" chart). Rotation is counter-clockwise (https://jlcpcb.com/help/article/pick-place-file-for-pcb-assembly).
So the correction is the turn that brings the tape's pin 1 onto KiCad's. Read on 2026-11-26.

The standards are a family's rule, and one maker's tape can differ. A rule carries a `checked` date only after a
person saw it right in JLC's placement preview; until then release lists the part to check there. Families the
chart does not settle (SSOP, MSOP, connectors, modules, switches) have no rule and are listed too. board.py's
rotation= replaces the correction for one part.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from ..pcb.footprint import norm_angle, rotate

ROTATIONS = Path(__file__).resolve().parent.parent / "data" / "jlc" / "rotations.csv"


@dataclass(frozen=True)
class Rule:
    pattern: str  # a regular expression on the footprint's name
    family: str
    rotation: float  # degrees counter-clockwise added to the footprint's angle
    offset: tuple[float, float]  # footprint mm (x right, y up) from the pad box's centre
    symmetric: bool  # both ends are the same, so a half turn changes nothing
    checked: str | None  # the day a person saw it right in JLC's placement preview
    basis: str

    @property
    def needs_check(self) -> bool:
        return not self.checked and not self.symmetric


def load_rules(path: Path = ROTATIONS) -> list[Rule]:
    with open(path, newline="", encoding="utf-8") as f:
        return [Rule(r["pattern"], r["family"], float(r["rotation"]), (float(r["offset_x"]), float(r["offset_y"])),
                     r["symmetric"] == "yes", r["checked"] or None, r["basis"]) for r in csv.DictReader(f)]


def rule_for(footprint: str, rules: Sequence[Rule]) -> Rule | None:
    """The first rule whose pattern matches the footprint's name (without its library)."""
    return next((r for r in rules if re.search(r.pattern, footprint)), None)


def cpl_angle(angle: float, back: bool, rule: Rule | None, override: float | None = None) -> float:
    """The CPL's rotation. A bottom part seen from below (the board flipped left to right) looks like a top part
    turned 180 - angle; the correction is added to that. `override` is board.py's rotation=."""
    correction = override if override is not None else (rule.rotation if rule else 0.0)
    return norm_angle((180 - angle if back else angle) + correction)


def cpl_offset(rule: Rule | None, angle: float, back: bool) -> tuple[float, float]:
    """The rule's offset in board mm: it turns, and flips on the bottom, just as the footprint's pads do."""
    if rule is None or rule.offset == (0.0, 0.0):
        return (0.0, 0.0)
    x, y = rule.offset
    lx, ly = x, -y  # KiCad's footprint frame has y down
    if back:
        ly = -ly
    dx, dy = rotate(lx, ly, angle)
    return (dx + 0.0, -dy + 0.0)
