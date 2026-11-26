"""A stand-in for kicad-cli in tests: prints what it was called with and never writes a file, except that
`pcb drc` copies the JSON file named by $FAKE_KICAD_DRC to its -o path when that is set (with --save-board the
board is left as it is). FAKE_KICAD_DRC=auto writes a report whose unconnected items come from the board's copper
(pads of a net that pino's contact rule does not join), with no violations."""

import json
import os
import shutil
import sys
import time

WATCHED = ("DISPLAY", "WAYLAND_DISPLAY", "KICAD_CONFIG_HOME", "XDG_CACHE_HOME",
           "KICAD10_SYMBOL_DIR", "KICAD10_FOOTPRINT_DIR", "KICAD10_3DMODEL_DIR")

args = sys.argv[1:]
if "--help" in args:
    print("  -D, --define-var  Overrides or adds project variables")
    sys.exit(0)
if args and args[0] == "sleep":
    time.sleep(30)
if args == ["version"]:
    print("10.0.6")
    sys.exit(0)


def auto_report(board_path):
    from pino_kernel.coords import to_kicad
    from pino_kernel.pcb.copper import contact_map, items_of, read_copper

    with open(board_path, encoding="utf-8") as f:
        copper = read_copper(f.read())
    items = [it for it in items_of(copper) if it.kind != "zone"]
    near = contact_map(items)
    comp = [-1] * len(items)
    for s in range(len(items)):
        if comp[s] < 0:
            comp[s], stack = s, [s]
            while stack:
                k = stack.pop()
                for j in near[k]:
                    if comp[j] < 0:
                        comp[j] = s
                        stack.append(j)
    by_net = {}
    for k, it in enumerate(items):
        if it.kind == "pad" and it.net and not it.net.startswith("unconnected-("):
            by_net.setdefault(it.net, {}).setdefault(comp[k], it.obj)
    unconnected = []
    for net in sorted(by_net):
        pads = list(by_net[net].values())
        for a, b in zip(pads, pads[1:]):
            entry = []
            for p in (a, b):
                X, Y = to_kicad(*p.centre)
                entry.append({"description": f"Pad {p.number} [{net}] of {p.ref} on F.Cu", "pos": {"x": X, "y": Y},
                              "uuid": f"{p.ref}-{p.number}"})
            unconnected.append({"description": "Missing connection between items", "severity": "error",
                                "type": "unconnected_items", "items": entry})
    return {"$schema": "https://schemas.kicad.org/drc.v1.json", "coordinate_units": "mm", "kicad_version": "10.0.6",
            "source": "board.kicad_pcb", "violations": [], "unconnected_items": unconnected, "schematic_parity": []}


if args[:2] == ["pcb", "drc"] and os.environ.get("FAKE_KICAD_DRC") and "-o" in args:
    if os.environ["FAKE_KICAD_DRC"] == "auto":
        with open(args[args.index("-o") + 1], "w", encoding="utf-8") as f:
            json.dump(auto_report(args[-1]), f, indent=2)
    else:
        shutil.copy(os.environ["FAKE_KICAD_DRC"], args[args.index("-o") + 1])
print(json.dumps({"argv": args, "env": {k: os.environ.get(k) for k in WATCHED}}))
