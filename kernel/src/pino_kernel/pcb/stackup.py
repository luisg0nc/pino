"""KiCad's (stackup ...) for the board's layer count, adding up to the fab's board thickness."""

from __future__ import annotations

from ..fab import FabProfile
from ..sexpr import Sym as S
from ..sexpr import num

MASK = 0.01
OUTER_CU = 0.035
# JLC04161H-7628, JLC's standard 4-layer build at 1.6 mm
INNER_CU = 0.0152
PREPREG_4L = 0.2104
CORE_4L = 1.065


def _layer(name, kind, thickness=None, extra=()):
    node = [S("layer"), name, [S("type"), kind]]
    if thickness is not None:
        node.append([S("thickness"), num(thickness)])
    node += list(extra)
    return node


def _dielectric(i, kind, thickness):
    return _layer(f"dielectric {i}", kind, thickness,
                  [[S("material"), "FR4"], [S("epsilon_r"), num(4.5)], [S("loss_tangent"), num(0.02)]])


def stackup(layers: int, fab: FabProfile) -> list:
    out = [S("stackup"),
           _layer("F.SilkS", "Top Silk Screen"), _layer("F.Paste", "Top Solder Paste"),
           _layer("F.Mask", "Top Solder Mask", MASK), _layer("F.Cu", "copper", OUTER_CU)]
    if layers == 2:
        core = round(fab.board_thickness - 2 * MASK - 2 * OUTER_CU, 6)
        out.append(_dielectric(1, "core", core))
    elif layers == 4:
        out += [_dielectric(1, "prepreg", PREPREG_4L), _layer("In1.Cu", "copper", INNER_CU),
                _dielectric(2, "core", CORE_4L), _layer("In2.Cu", "copper", INNER_CU),
                _dielectric(3, "prepreg", PREPREG_4L)]
    else:
        raise ValueError(f"no stackup for {layers} layers")
    out += [_layer("B.Cu", "copper", OUTER_CU), _layer("B.Mask", "Bottom Solder Mask", MASK),
            _layer("B.Paste", "Bottom Solder Paste"), _layer("B.SilkS", "Bottom Silk Screen"),
            [S("copper_finish"), "None"], [S("dielectric_constraints"), S("no")]]
    return out
