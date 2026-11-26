"""A stand-in for kicad-cli in tests: prints what it was called with and never writes a file, except that
`pcb drc` copies the JSON file named by $FAKE_KICAD_DRC to its -o path when that is set (with --save-board the
board is left as it is), and `pcb export gerbers` and `pcb export drill` write one small dated file per layer and two
drill files, each carrying a digest of the board, and `pcb export glb` writes a dated stand-in model with its flags and
the digest of the board it was given (FAKE_KICAD_GLB_FAIL=<message> fails that one; FAKE_KICAD_EXPORT_FAIL=<message> fails them, and
FAKE_KICAD_EXPORT_SKIP=<layer> leaves one file out). FAKE_KICAD_DRC=auto writes a report whose unconnected items come from the board's copper
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


def export(kind):
    """Files named as kicad-cli names them, dated, each holding a digest of the board they came from."""
    import hashlib
    from pathlib import Path

    if os.environ.get("FAKE_KICAD_EXPORT_FAIL"):
        print(os.environ["FAKE_KICAD_EXPORT_FAIL"], file=sys.stderr)
        sys.exit(1)
    out, board = Path(args[args.index("-o") + 1]), Path(args[-1])
    out.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(board.read_bytes()).hexdigest()
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    if kind == "gerbers":
        ext = {"F.Cu": "gtl", "B.Cu": "gbl", "F.Paste": "gtp", "B.Paste": "gbp", "F.Silkscreen": "gto",
               "B.Silkscreen": "gbo", "F.Mask": "gts", "B.Mask": "gbs", "Edge.Cuts": "gm1"}
        for layer in args[args.index("--layers") + 1].split(","):
            name = f"{board.stem}-{layer.replace('.', '_')}.{ext.get(layer) or 'g' + layer[2:-3]}"
            skip = os.environ.get("FAKE_KICAD_EXPORT_SKIP")
            if not skip or skip not in name:
                (out / name).write_text(f"%TF.CreationDate,{stamp}*%\nG04 {layer} of {digest}*\nM02*\n")
        (out / f"{board.stem}-job.gbrjob").write_text('{"Header": {"CreationDate": "' + stamp + '"}}\n')
    else:
        for part in ("PTH", "NPTH"):
            (out / f"{board.stem}-{part}.drl").write_text(
                f"M48\n; DRILL file KiCad 10.0.6 date {stamp}\n; #@! TF.CreationDate,{stamp}\n; {digest}\nM30\n")


def export_glb():
    """Not a real GLB: enough to tell which board it came from, with which flags, and whether its date was taken out."""
    import hashlib
    from pathlib import Path

    if os.environ.get("FAKE_KICAD_GLB_FAIL"):
        print(os.environ["FAKE_KICAD_GLB_FAIL"], file=sys.stderr)
        sys.exit(1)
    board = Path(args[-1])
    Path(args[args.index("-o") + 1]).write_text(json.dumps({
        "generated_at": f"{time.time_ns()}", "board": hashlib.sha256(board.read_bytes()).hexdigest(),
        "flags": [a for a in args if a.startswith("--") and a != "--define-var"]}))


if args[:3] == ["pcb", "export", "glb"] and os.path.isfile(args[-1]):
    export_glb()
if args[:3] in (["pcb", "export", "gerbers"], ["pcb", "export", "drill"]):
    export(args[2])
if args[:2] == ["pcb", "drc"] and os.environ.get("FAKE_KICAD_SLOW"):
    if os.environ.get("FAKE_KICAD_PIDFILE"):
        with open(os.environ["FAKE_KICAD_PIDFILE"], "w") as f:
            f.write(str(os.getpid()))
    time.sleep(float(os.environ["FAKE_KICAD_SLOW"]))
if args[:2] == ["pcb", "drc"] and os.environ.get("FAKE_KICAD_DRC") and "-o" in args:
    if os.environ["FAKE_KICAD_DRC"] == "auto":
        with open(args[args.index("-o") + 1], "w", encoding="utf-8") as f:
            json.dump(auto_report(args[-1]), f, indent=2)
    else:
        shutil.copy(os.environ["FAKE_KICAD_DRC"], args[args.index("-o") + 1])
print(json.dumps({"argv": args, "env": {k: os.environ.get(k) for k in WATCHED}}))
