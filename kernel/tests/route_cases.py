"""Project files and boards shared by the route plan, key and chain tests."""

from __future__ import annotations

import json

from copper_boards import (ESP32_MODULE, QFN32_05, R0603, SOT23_3, USB_C16, board, fp, mounting_holes, rect, track,
                           zone)
from pino_kernel.circuit import PairSpec
from pino_kernel.fab import for_layers
from pino_kernel.pcb.rules import kicad_dru


def pro(*, clearance=0.2, track=0.2, via=(0.6, 0.3), min_track=0.15, min_clearance=0.15, hole_clearance=0.25,
        hole_to_hole=0.5, edge=0.3, power=0.5, power_nets=("VBUS", "+3V3")) -> str:
    def cls(name, w, c, vd, vdr):
        return {"name": name, "track_width": w, "clearance": c, "via_diameter": vd, "via_drill": vdr,
                "diff_pair_gap": 0.25, "diff_pair_width": 0.2, "priority": 0 if name != "Default" else 2147483647}

    rules = {"min_track_width": min_track, "min_clearance": min_clearance, "min_hole_to_hole": hole_to_hole,
             "min_copper_edge_clearance": edge, "min_via_diameter": 0.6, "min_through_hole_diameter": 0.3}
    if hole_clearance is not None:
        rules["min_hole_clearance"] = hole_clearance
    classes = [cls("Default", track, clearance, *via)]
    patterns = []
    if power:
        classes.append(cls("power", power, clearance, *via))
        patterns = [{"netclass": "power", "pattern": n} for n in power_nets]
    data = {"board": {"design_settings": {"rules": rules}},
            "net_settings": {"classes": classes, "netclass_patterns": patterns, "meta": {"version": 4}}}
    return json.dumps(data, indent=2, sort_keys=True) + "\n"


PRO_2L = pro()
DRU_2L = kicad_dru(for_layers(2))
USB_PAIR = PairSpec("USB_D", "USB_D+", "USB_D-", None, None, 1)


def board_with(*fps, layers: int = 2, **kw) -> str:
    return board(footprints=list(fps), layers=layers, **kw)


QFN = fp("U1", (0, 0, 0), QFN32_05, nets={"1": "SDA", "2": "SCL", "3": "USB_D+", "4": "USB_D-", "5": "GPIO4",
                                         "33": "GND"})
USB = fp("J1", (0, -10, 0), USB_C16, nets={"A1": "GND", "A4": "VBUS", "A6": "USB_D+", "A7": "USB_D-", "B1": "GND",
                                          "B4": "VBUS"})
SOT = fp("U2", (10, 5, 0), SOT23_3, nets={"1": "GND", "2": "+3V3", "3": "VBUS"})
MODULE = fp("U3", (-12, 5, 0), ESP32_MODULE, nets={"1": "GND", "2": "+3V3"})
PULLS = [fp("R1", (6, 2, 0), R0603, nets={"1": "SDA", "2": "+3V3"}), fp("R2", (6, -2, 0), R0603, nets={"1": "SCL", "2": "+3V3"}),
         fp("R3", (-6, -2, 0), R0603, nets={"1": "GPIO4", "2": "GND"})]

QFN_USB_GND_BOARD = board_with(QFN, USB, SOT, *PULLS, zones=[zone("GND", "B.Cu", rect(-20, -15, 20, 15))])


def board_with_gnd_zone_and_usb(layers: int = 4) -> str:
    gnd_layer = "In1.Cu" if layers == 4 else "B.Cu"
    return board_with(QFN, USB, SOT, *PULLS, layers=layers, zones=[zone("GND", gnd_layer, rect(-20, -15, 20, 15))])


def board_with_power_nets() -> str:
    return board_with(QFN, USB, SOT, *PULLS)


def board_with_locked_vbus_and_gnd_zone() -> str:
    """4 layers; VBUS from J1.A4 to U2.3 is kept (locked); a GND plane on In1.Cu."""
    from pino_kernel.pcb.copper import read_copper

    base = board_with(QFN, USB, SOT, *PULLS, layers=4)
    pads = {(p.ref, p.number): p.centre for p in read_copper(base).pads}
    a, b, c = pads[("J1", "A4")], pads[("U2", "3")], pads[("J1", "B4")]
    tracks = [track("VBUS", a, (a[0], -8.0), locked=True), track("VBUS", (a[0], -8.0), (b[0], -8.0), locked=True),
              track("VBUS", (b[0], -8.0), b, locked=True), track("VBUS", c, (c[0], -8.0), locked=True)]
    return board_with(QFN, USB, SOT, *PULLS, layers=4, tracks=tracks,
                      zones=[zone("GND", "In1.Cu", rect(-20, -15, 20, 15))])


def board_with_mounting_holes() -> str:
    return board_with(*PULLS, *mounting_holes(), outline=(-30.0, -22.0, 30.0, 22.0))
