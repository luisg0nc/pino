"""The project's design rules: .kicad_pro (board rules and net classes) and .kicad_dru (the fab's limits)."""

from __future__ import annotations

import json

from ..circuit import Circuit
from ..fab import FabProfile
from ..sexpr import num

# The Default net class, before the fab's minimums raise it.
DEFAULT_TRACK_WIDTH = 0.25
DEFAULT_CLEARANCE = 0.2
DEFAULT_VIA_DIAMETER = 0.6
DEFAULT_VIA_DRILL = 0.3
DEFAULT_TRACK = DEFAULT_TRACK_WIDTH


def default_rules(fab: FabProfile) -> tuple[float, float, float, float]:
    """The Default class as written: (track width, clearance, via diameter, via drill)."""
    return (max(DEFAULT_TRACK_WIDTH, fab.min_track), max(DEFAULT_CLEARANCE, fab.min_clearance),
            max(DEFAULT_VIA_DIAMETER, fab.min_via_diameter), max(DEFAULT_VIA_DRILL, fab.min_via_drill))


def net_rules(circuit: Circuit, fab: FabProfile, net: str) -> tuple[float, float, float, float]:
    """(width, clearance, via diameter, via drill) of `net`: its class's values, else the Default class's."""
    for c in circuit.net_classes:
        if net in c.nets:
            return (c.width, c.clearance, c.via_diameter, c.via_drill)
    return default_rules(fab)


def _netclass(name, clearance, track, via_d, via_drill, priority):
    return {
        "bus_width": 12, "clearance": clearance, "diff_pair_gap": 0.25, "diff_pair_via_gap": 0.25,
        "diff_pair_width": 0.2, "line_style": 0, "microvia_diameter": 0.3, "microvia_drill": 0.1,
        "name": name, "pcb_color": "rgba(0, 0, 0, 0.000)", "priority": priority,
        "schematic_color": "rgba(0, 0, 0, 0.000)", "track_width": track,
        "via_diameter": via_d, "via_drill": via_drill, "wire_width": 6,
    }


def kicad_pro(circuit: Circuit, fab: FabProfile) -> str:
    track, clearance, via_d, via_drill = default_rules(fab)
    classes = [_netclass("Default", clearance, track, via_d, via_drill, 2147483647)]
    for i, c in enumerate(circuit.net_classes):
        classes.append(_netclass(c.name, c.clearance, c.width, c.via_diameter, c.via_drill, i))
    patterns = [{"netclass": c.name, "pattern": n} for c in circuit.net_classes for n in c.nets]
    rules = {
        "min_clearance": fab.min_clearance, "min_track_width": fab.min_track,
        "min_via_diameter": fab.min_via_diameter, "min_via_annular_width": fab.min_annular,
        "min_through_hole_diameter": fab.min_hole, "min_hole_to_hole": fab.hole_to_hole,
        "min_copper_edge_clearance": fab.copper_to_edge, "min_hole_clearance": 0.25, "min_silk_clearance": 0.0,
        "min_text_height": fab.silk_min_text_height, "min_text_thickness": fab.silk_min_width * 0.5,
        "max_error": 0.005, "allow_blind_buried_vias": False, "allow_microvias": False,
    }
    pro = {
        "board": {"design_settings": {
            "defaults": {}, "diff_pair_dimensions": [], "drc_exclusions": [], "rules": rules,
            "track_widths": [0.0, DEFAULT_TRACK_WIDTH, 0.5],
            "via_dimensions": [{"diameter": 0.0, "drill": 0.0},
                               {"diameter": DEFAULT_VIA_DIAMETER, "drill": DEFAULT_VIA_DRILL}],
        }},
        "boards": [], "libraries": {"pinned_footprint_libs": [], "pinned_symbol_libs": []},
        "meta": {"filename": "board.kicad_pro", "version": 3},
        "net_settings": {"classes": classes, "meta": {"version": 4}, "net_colors": None,
                         "netclass_assignments": None, "netclass_patterns": patterns},
        "pcbnew": {"last_paths": {}}, "sheets": [], "text_variables": {},
    }
    return json.dumps(pro, indent=2, sort_keys=True) + "\n"


def kicad_dru(fab: FabProfile) -> str:
    """One rule per fab limit. KiCad drops every custom rule when one token is wrong, so DRC must read this
    file after every change of it (the kicad tests prove it is read)."""
    limits = [
        ("track_width", fab.min_track), ("clearance", fab.min_clearance), ("hole_size", fab.min_hole),
        ("via_diameter", fab.min_via_diameter), ("annular_width", fab.min_annular),
        ("hole_to_hole", fab.hole_to_hole), ("edge_clearance", fab.copper_to_edge), ("silk_clearance", 0.0),
        ("text_height", fab.silk_min_text_height),
    ]
    conditions = {
        "text_height": "A.Layer == 'F.SilkS' || A.Layer == 'B.SilkS'",
        # silk to silk only: silk printed over copper or a zone is fine for the fab
        "silk_clearance": "(A.Layer == 'F.SilkS' && B.Layer == 'F.SilkS') || (A.Layer == 'B.SilkS' && B.Layer == 'B.SilkS')",
    }
    lines = ["(version 1)"]
    for name, value in limits:
        cond = f'\n\t(condition "{conditions[name]}")' if name in conditions else ""
        lines.append(f'(rule "pino: {name}"\n\t(constraint {name} (min {num(value)}mm)){cond})')
    return "\n".join(lines) + "\n"
