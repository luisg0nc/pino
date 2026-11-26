"""Shared code of the fake KiCadRoutingTools scripts the tests run in place of the real router.

Every script appends {"script", "argv", "cwd"} to $FAKE_KRT_ARGV_LOG and its pid to $FAKE_KRT_PIDFILE when they
are set, then acts by $FAKE_KRT_MODE:

- copy (default): the output is the input; route.py and route_diff.py also add one F.Cu segment per --nets net,
  from its first pad centre to its second, except nets named in $FAKE_KRT_FAIL (comma separated).
  $FAKE_KRT_SLOW (seconds) makes route.py wait before it writes. $FAKE_KRT_PAIR_DEFER makes route_diff.py route
  nothing and name its nets as single-ended follow-ups, as the real one does when a pair cannot couple.
- sleep: sleep 60 s.
- crash: exit 1 without output (only the script named in $FAKE_KRT_CRASH, when that is set).
- env: print the environment as one JSON line.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import uuid

COMMON = ["--board-edge-clearance", "--clearance", "--fab-overrides", "--grid-step", "--via-drill", "--via-size",
          "--nets", "--help"]
FLAGS = {
    "route.py": COMMON + ["--track-width", "--hole-to-hole-clearance", "--power-nets", "--power-nets-widths",
                          "--layers", "--rip-existing-nets", "--guide-corridor", "--no-fix-drc-settings",
                          "--visualize", "--auto", "--display-time", "--keepout"],
    "route_diff.py": COMMON + ["--track-width", "--diff-pair-gap", "--no-gnd-vias", "--hole-to-hole-clearance",
                               "--layers", "--no-fix-drc-settings"],
    "qfn_fanout.py": COMMON + ["--component", "--width", "--output"],
    "route_planes.py": COMMON + ["--plane-layers", "--track-width", "--hole-to-hole-clearance",
                                 "--no-fix-drc-settings"],
    "route_disconnected_planes.py": COMMON + ["--plane-layers", "--hole-to-hole-clearance", "--no-fix-drc-settings"],
}


def _rotate(x: float, y: float, deg: float) -> tuple[float, float]:
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return x * c + y * s, -x * s + y * c


def pad_centres(root) -> dict[str, list[tuple[float, float]]]:
    """net -> pad centres in KiCad's frame, in file order."""
    from pino_kernel.sexpr import find, find_all

    out: dict[str, list[tuple[float, float]]] = {}
    for fp in find_all(root, "footprint"):
        at = find(fp, "at")
        X, Y = float(at[1]), float(at[2])
        A = float(at[3]) if len(at) > 3 else 0.0
        for pad in find_all(fp, "pad"):
            net = find(pad, "net")
            if net is None:
                continue
            pat = find(pad, "at")
            dx, dy = _rotate(float(pat[1]), float(pat[2]), A)
            out.setdefault(str(net[-1]), []).append((round(X + dx, 6), round(Y + dy, 6)))
    return out


def _values(argv: list[str], flag: str) -> list[str]:
    if flag not in argv:
        return []
    out = []
    for a in argv[argv.index(flag) + 1:]:
        if a.startswith("--"):
            break
        out.append(a)
    return out


def _paths(argv: list[str]) -> tuple[str, str | None]:
    src = argv[0]
    for flag in ("-o", "--output"):
        if flag in argv:
            return src, argv[argv.index(flag) + 1]
    return src, argv[1] if len(argv) > 1 and not argv[1].startswith("-") else None


def _copy(script: str, argv: list[str]) -> int:
    from pino_kernel.sexpr import Sym, dump, num, parse

    src, out = _paths(argv)
    with open(src, encoding="utf-8") as f:
        root = parse(f.read())
    routed, failed = 0, []
    followup = []
    if script == "route_diff.py" and os.environ.get("FAKE_KRT_PAIR_DEFER"):
        followup = _values(argv, "--nets")
    elif script in ("route.py", "route_diff.py"):
        nets = _values(argv, "--nets")
        fail = set(filter(None, os.environ.get("FAKE_KRT_FAIL", "").split(",")))
        widths = _values(argv, "--track-width") or ["0.2"]
        pads = pad_centres(root)
        tail = next((i for i, c in enumerate(root) if isinstance(c, list) and c and c[0] == "embedded_fonts"),
                    len(root))
        for i, net in enumerate(nets, 1):
            print(f"[{i}/{len(nets)}] Routing {net} (id={i})", flush=True)
            where = pads.get(net, [])
            if net in fail or len(where) < 2:
                failed.append(net)
                continue
            (x0, y0), (x1, y1) = where[0], where[1]
            seg = [Sym("segment"), [Sym("start"), num(x0), num(y0)], [Sym("end"), num(x1), num(y1)],
                   [Sym("width"), Sym(widths[0])], [Sym("layer"), "F.Cu"], [Sym("net"), net],
                   [Sym("uuid"), str(uuid.uuid4())]]
            root.insert(tail, seg)
            tail += 1
            routed += 1
        if script == "route.py" and os.environ.get("FAKE_KRT_SLOW"):
            time.sleep(float(os.environ["FAKE_KRT_SLOW"]))
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(dump(root) + "\n")
    summary = {"successful": routed, "failed": len(failed), "failed_single": failed, "total_time": 0.01,
               "total_vias": 0}
    if script == "route_diff.py":
        summary["single_ended_followup_nets"] = followup
    print("JSON_SUMMARY: " + json.dumps(summary), flush=True)
    return 0


def main(script: str) -> None:
    argv = sys.argv[1:]
    if "--help" in argv or "-h" in argv:
        print(f"usage: {script} [-h] input_file output_file")
        for flag in FLAGS[script]:
            print(f"  {flag} VALUE")
        sys.exit(0)
    if os.environ.get("FAKE_KRT_ARGV_LOG"):
        with open(os.environ["FAKE_KRT_ARGV_LOG"], "a", encoding="utf-8") as f:
            f.write(json.dumps({"script": script, "argv": argv, "cwd": os.getcwd()}, ensure_ascii=False) + "\n")
    if os.environ.get("FAKE_KRT_PIDFILE"):
        with open(os.environ["FAKE_KRT_PIDFILE"], "w") as f:
            f.write(str(os.getpid()))
    mode = os.environ.get("FAKE_KRT_MODE", "copy")
    if mode == "crash" and os.environ.get("FAKE_KRT_CRASH", script) != script:
        mode = "copy"
    if mode == "sleep":
        print("routing slowly", flush=True)
        time.sleep(60)
        sys.exit(0)
    if mode == "crash":
        sys.exit(1)
    if mode == "env":
        print(json.dumps(dict(os.environ)), flush=True)
        sys.exit(0)
    sys.exit(_copy(script, argv))
