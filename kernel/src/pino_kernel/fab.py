"""Fab profiles: the limits a fab can build, in mm (copper weights in oz).

The JLC values, read on 2026-11-26. The pages carry no date of their own (the PCB page notes an
LDI upgrade of June 2025).

PCB, https://jlcpcb.com/capabilities/pcb-capabilities

    value                                      2 layers          4 layers
    track and gap, 1 oz                        0.10              0.09
    track and gap, 2 oz                        0.16              0.15
    via hole (0.15 possible; 0.2 preferred)    0.2               0.2
    via diameter (smaller costs more)          0.45              0.45
    via annular ring (from the two above)      0.125             0.125
    plated pad annular ring, minimum           0.18              0.15
    plated hole / non-plated hole              0.2 / 0.5         0.2 / 0.5
    hole to hole, vias / pads                  0.2 / 0.45        0.2 / 0.45
    via hole / plated pad hole to track        0.2 / 0.28        0.2 / 0.28
    non-plated hole to track                   0.2               0.2
    pad to pad, different nets                 0.15              0.15
    copper to routed board edge                0.2               0.2
    silkscreen line, text height, to pad       0.15, 1.0, 0.15   0.15, 1.0, 0.15
    board thickness                            0.4 0.6 0.8 1.0 1.2 1.6 2.0
    outer copper                               1 2 2.5 3.5 4.5   1 2
    inner copper                               none              0.5 (default) 1 2

Assembly, https://jlcpcb.com/capabilities/pcb-assembly-capabilities, economic assembly: one side,
board 10 x 10 to 470 x 500, thickness 0.8 to 1.6, smallest package 0402, IC pitch 0.4.
Standard assembly takes both sides but needs a board of at least 70 x 70.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace

SOURCE = "https://jlcpcb.com/capabilities/pcb-capabilities"
READ_ON = "2026-11-26"


@dataclass(frozen=True)
class Assembly:
    kind: str
    sides: int
    min_board: tuple[float, float]
    max_board: tuple[float, float]
    thickness: tuple[float, float]
    smallest: str
    min_pitch: float


JLC_ECONOMIC = Assembly("economic", 1, (10.0, 10.0), (470.0, 500.0), (0.8, 1.6), "0402", 0.4)


def _lists(v):
    if isinstance(v, dict):
        return {k: _lists(x) for k, x in v.items()}
    return [_lists(x) for x in v] if isinstance(v, (list, tuple)) else v


@dataclass(frozen=True)
class FabProfile:
    name: str
    title: str
    layers: int
    min_track: float
    min_clearance: float
    min_via_drill: float
    min_via_diameter: float
    min_annular: float  # a via's ring
    min_pth_annular: float
    min_hole: float
    min_npth: float
    hole_to_hole: float  # between via holes
    pad_hole_to_hole: float
    via_hole_to_track: float
    pth_to_track: float
    pad_to_pad: float
    copper_to_edge: float
    silk_min_width: float
    silk_min_text_height: float
    silk_to_pad: float
    board_thickness: float
    thicknesses: tuple[float, ...]
    copper_oz: float
    copper_options: tuple[float, ...]
    inner_copper_oz: float | None
    heavy_track: float  # track and gap at 2 oz
    assembly: Assembly
    source: str
    read_on: str

    def to_json(self) -> dict:
        return _lists(asdict(self))


jlc_standard_2layer = FabProfile(
    name="jlc-standard-2layer", title="JLC standard 2-layer", layers=2, min_track=0.10, min_clearance=0.10,
    min_via_drill=0.2, min_via_diameter=0.45, min_annular=0.125, min_pth_annular=0.18, min_hole=0.2, min_npth=0.5,
    hole_to_hole=0.2, pad_hole_to_hole=0.45, via_hole_to_track=0.2, pth_to_track=0.28, pad_to_pad=0.15,
    copper_to_edge=0.2, silk_min_width=0.15, silk_min_text_height=1.0, silk_to_pad=0.15, board_thickness=1.6,
    thicknesses=(0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0), copper_oz=1.0, copper_options=(1.0, 2.0, 2.5, 3.5, 4.5),
    inner_copper_oz=None, heavy_track=0.16, assembly=JLC_ECONOMIC, source=SOURCE, read_on=READ_ON,
)

jlc_standard_4layer = replace(
    jlc_standard_2layer, name="jlc-standard-4layer", title="JLC standard 4-layer", layers=4, min_track=0.09,
    min_clearance=0.09, min_pth_annular=0.15, copper_options=(1.0, 2.0), inner_copper_oz=0.5, heavy_track=0.15,
)

PROFILES: dict[str, FabProfile] = {p.name: p for p in (jlc_standard_2layer, jlc_standard_4layer)}


def for_layers(n: int) -> FabProfile:
    for p in PROFILES.values():
        if p.layers == n:
            return p
    raise ValueError(f"no fab profile for {n} copper layers; pino builds 2 or 4")
