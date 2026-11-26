"""pino-kernel: build a project once, or serve builds over JSON lines.

    pino-kernel build <project> [--timeout S] [--render] [--no-kicad] [--no-cache]
    pino-kernel version
    pino-kernel serve
    pino-kernel router status|install
    pino-kernel route <project> [--build HASH] [--timeout S] [--step-timeout S] [--no-install] [--no-cache]
                                [--keep-steps] [--events]
    pino-kernel route-net <project> --net N [--region=x0,y0,x1,y1] [--layers L ...] [--corridor=x,y ...]
                                    [--rip P ...] [--events]
    pino-kernel nudge <project> --part REF [--by=dx,dy] [--rot DEG] [--back | --front] [--route] [--events]
    pino-kernel keep <project> --net N

`build` prints one build result (schema pino.build/1) on stdout and exits 0 for ok, 1 for errors,
2 for failed. `serve` reads one JSON request per stdin line and answers one JSON object per stdout
line (see serve.py). `route` prints one route result (schema pino.route/1), or with --events one
progress event per line and last {"event": "done", "result": ...}; it exits 0 ok, 1 errors, 2 failed,
timed out or busy, 130 cancelled. Logs go to stderr; nothing else is written to stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .build import BuildOptions, build
from .kicad_cli import KicadCli
from .libraries import LibrariesNotFound, discover
from .result import SCHEMA

EXIT = {"ok": 0, "errors": 1, "failed": 2}


def _version() -> dict:
    try:
        libs = discover()
        libraries = libs.path_vars()
    except LibrariesNotFound:
        libs, libraries = None, None
    kicad = None
    argv = KicadCli.find()
    if argv and libs is not None:
        import tempfile

        with tempfile.TemporaryDirectory(prefix="pino-kernel-") as home:
            kicad = KicadCli(libs, Path(home), argv).version() or None
    return {"kernel": __version__, "schema": SCHEMA, "kicad_cli": kicad, "libraries": libraries}


def _router(action: str) -> int:
    from .routing import krt as K

    out = {"router": "KiCadRoutingTools", "version": K.KRT_VERSION, "commit": K.KRT_COMMIT, "installed": False,
           "root": None, "problems": []}
    try:
        if action == "install":
            found = K.install(on_line=lambda s: print(s, file=sys.stderr))
        else:
            found = K.locate()
        out["installed"], out["root"] = True, str(found.root)
        out["problems"] = [f.to_json() for f in K.check(found)]
    except K.RouterMissing as e:
        out["problems"] = [e.finding.to_json()]
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    return 0 if out["installed"] and not out["problems"] else 1


ROUTE_EXIT = {"ok": 0, "errors": 1, "failed": 2}


def _numbers(text: str, n: int, what: str) -> list[float]:
    try:
        out = [float(v) for v in text.split(",")]
    except ValueError:
        raise SystemExit(f"pino-kernel: {what} takes {n} numbers, comma separated") from None
    if len(out) != n:
        raise SystemExit(f"pino-kernel: {what} takes {n} numbers, comma separated")
    return out


def _trial(args) -> int:
    import signal
    import threading

    from .routing import trials

    cancel = threading.Event()
    signal.signal(signal.SIGTERM, lambda s, f: cancel.set())
    signal.signal(signal.SIGINT, lambda s, f: cancel.set())
    lock = threading.Lock()

    def emit(event: dict) -> None:
        if getattr(args, "events", False):
            with lock:
                sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
                sys.stdout.flush()

    if args.command == "route-net":
        result = trials.route_net(args.project, args.net,
                                  region=_numbers(args.region, 4, "--region") if args.region else None,
                                  layers=args.layers or None,
                                  corridor=[tuple(_numbers(c, 2, "--corridor")) for c in args.corridor or []] or None,
                                  rip=args.rip or (), events=emit, cancel=cancel)
    elif args.command == "nudge":
        back = True if args.back else False if args.front else None
        result = trials.nudge(args.project, args.part, by=tuple(_numbers(args.by, 2, "--by")) if args.by else (0.0, 0.0),
                              rot=args.rot, back=back, route=args.route, events=emit, cancel=cancel)
    else:
        result = trials.keep(args.project, args.net)
    if getattr(args, "events", False):
        emit({"event": "done", "result": result.to_dict()})
    else:
        sys.stdout.write(result.to_json())
        sys.stdout.flush()
    return 0 if result.ok else 1


def _route(args) -> int:
    import signal
    import threading

    from .routing.job import RouteOptions, route_project

    cancel = threading.Event()

    def stop(signum, frame):
        cancel.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    lock = threading.Lock()

    def emit(event: dict) -> None:
        if args.events:
            with lock:
                sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
                sys.stdout.flush()

    options = RouteOptions(timeout=args.timeout, step_timeout=args.step_timeout, install=not args.no_install,
                           cache=not args.no_cache, keep_steps=args.keep_steps)
    result = route_project(args.project, build=args.build, options=options, events=emit, cancel=cancel)
    if args.events:
        emit({"event": "done", "result": result.to_dict()})
    else:
        sys.stdout.write(result.to_json())
        sys.stdout.flush()
    if result.state == "cancelled":
        return 130
    return ROUTE_EXIT.get(result.verdict, 2)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pino-kernel", description="pino's engine: board.py to a KiCad project")
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="build a project once and print the result")
    b.add_argument("project", type=Path)
    b.add_argument("--timeout", type=float, default=30.0, help="seconds board.py may run (default 30)")
    b.add_argument("--render", action="store_true", help="also render a picture of the board's top")
    b.add_argument("--no-kicad", action="store_true", help="skip every kicad-cli step")
    b.add_argument("--no-cache", action="store_true", help="build again even when this input was built before")
    sub.add_parser("version", help="print versions and where the libraries are")
    sub.add_parser("serve", help="answer JSON-line requests on stdin")
    r = sub.add_parser("router", help="show or install the router (KiCadRoutingTools)")
    r.add_argument("action", choices=["status", "install"])
    rt = sub.add_parser("route", help="route a project's latest build and print the result")
    rt.add_argument("project", type=Path)
    rt.add_argument("--build", default=None, help="the build hash to route (default: the latest)")
    rt.add_argument("--timeout", type=float, default=900.0, help="seconds the whole route may take (default 900)")
    rt.add_argument("--step-timeout", type=float, default=300.0, help="seconds one router step may take (default 300)")
    rt.add_argument("--no-install", action="store_true", help="fail instead of installing the router")
    rt.add_argument("--no-cache", action="store_true", help="route again even when this board was routed before")
    rt.add_argument("--keep-steps", action="store_true", help="keep every router step's files in the route folder")
    rt.add_argument("--events", action="store_true", help="print progress events, one JSON object per line")
    rn = sub.add_parser("route-net", help="try one net with the router and print a route_hint line")
    rn.add_argument("project", type=Path)
    rn.add_argument("--net", required=True)
    rn.add_argument("--region", default=None, help="x0,y0,x1,y1 in mm (write --region=-5,-5,5,5)")
    rn.add_argument("--layers", nargs="+", action="extend", default=None)
    rn.add_argument("--corridor", action="append", default=None, help="x,y in mm, once per point (--corridor=0,0)")
    rn.add_argument("--rip", nargs="+", action="extend", default=None,
                    help="nets (or patterns) the router may move; write --rip=-5V for a name that starts with -")
    rn.add_argument("--events", action="store_true")
    nd = sub.add_parser("nudge", help="try a part somewhere else and print a place line")
    nd.add_argument("project", type=Path)
    nd.add_argument("--part", required=True)
    nd.add_argument("--by", default=None, help="dx,dy in mm (write --by=-1,0)")
    nd.add_argument("--rot", type=float, default=None)
    side = nd.add_mutually_exclusive_group()
    side.add_argument("--back", action="store_true")
    side.add_argument("--front", action="store_true")
    nd.add_argument("--route", action="store_true", help="also route the board with the part moved")
    nd.add_argument("--events", action="store_true")
    kp = sub.add_parser("keep", help="print keep_route lines for a net's routed copper")
    kp.add_argument("project", type=Path)
    kp.add_argument("--net", required=True)
    args = parser.parse_args(argv)
    if args.command in ("route-net", "nudge", "keep"):
        if not args.project.is_dir():
            print(f"pino-kernel: no project folder at {args.project}", file=sys.stderr)
            return 2
        try:
            return _trial(args)
        except Exception as e:  # noqa: BLE001 - a fault is exit 2, in plain words on stderr
            print(f"pino-kernel: the trial failed: {type(e).__name__}: {e}", file=sys.stderr)
            return 2
    if args.command == "router":
        return _router(args.action)
    if args.command == "route":
        if not args.project.is_dir():
            print(f"pino-kernel: no project folder at {args.project}", file=sys.stderr)
            return 2
        return _route(args)
    if args.command == "version":
        sys.stdout.write(json.dumps(_version(), ensure_ascii=False) + "\n")
        return 0
    if args.command == "serve":
        from .serve import main as serve_main

        return serve_main()
    if not args.project.is_dir():
        print(f"pino-kernel: no project folder at {args.project}", file=sys.stderr)
        return 2
    result = build(args.project, BuildOptions(timeout=args.timeout, render=args.render, kicad=not args.no_kicad,
                                              cache=not args.no_cache))
    sys.stdout.write(result.to_json())
    sys.stdout.flush()
    return EXIT[result.verdict]


if __name__ == "__main__":
    sys.exit(main())
