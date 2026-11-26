"""A stand-in for kicad-cli in tests: prints what it was called with and never writes a file, except that
`pcb drc` copies the JSON file named by $FAKE_KICAD_DRC to its -o path when that is set (with --save-board the
board is left as it is)."""

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
if args[:2] == ["pcb", "drc"] and os.environ.get("FAKE_KICAD_DRC") and "-o" in args:
    shutil.copy(os.environ["FAKE_KICAD_DRC"], args[args.index("-o") + 1])
print(json.dumps({"argv": args, "env": {k: os.environ.get(k) for k in WATCHED}}))
