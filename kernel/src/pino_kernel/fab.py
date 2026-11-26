"""Fab profiles: the limits a fab can build, in mm.

The JLC values are conservative placeholders at or above JLCPCB's published standard
minimums. A person checks them against JLC's capability page before fab files are made.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FabProfile:
    name: str
    layers: int
    min_track: float
    min_clearance: float
    min_via_drill: float
    min_via_diameter: float
    min_annular: float
    min_hole: float
    hole_to_hole: float
    copper_to_edge: float
    silk_min_width: float
    silk_min_text_height: float
    board_thickness: float = 1.6
    copper_oz: float = 1.0


jlc_standard_2layer = FabProfile(
    name="jlc-standard-2layer", layers=2, min_track=0.15, min_clearance=0.15, min_via_drill=0.3,
    min_via_diameter=0.6, min_annular=0.15, min_hole=0.3, hole_to_hole=0.5, copper_to_edge=0.3,
    silk_min_width=0.15, silk_min_text_height=1.0,
)

jlc_standard_4layer = FabProfile(
    name="jlc-standard-4layer", layers=4, min_track=0.1, min_clearance=0.1, min_via_drill=0.3,
    min_via_diameter=0.6, min_annular=0.15, min_hole=0.3, hole_to_hole=0.5, copper_to_edge=0.3,
    silk_min_width=0.15, silk_min_text_height=1.0,
)

PROFILES: dict[str, FabProfile] = {p.name: p for p in (jlc_standard_2layer, jlc_standard_4layer)}


def for_layers(n: int) -> FabProfile:
    for p in PROFILES.values():
        if p.layers == n:
            return p
    raise ValueError(f"no fab profile for {n} copper layers; pino builds 2 or 4")
