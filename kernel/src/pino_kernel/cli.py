"""pino-kernel: build a project once, or serve builds over JSON lines.

    pino-kernel build <project> [--timeout S] [--render] [--no-kicad] [--no-cache]
    pino-kernel version
    pino-kernel serve
    pino-kernel router status|install
    pino-kernel route <project> [--build HASH] [--timeout S] [--step-timeout S] [--no-install] [--no-cache]
                                [--keep-steps] [--events]

`build` prints one build result (schema pino.build/1) on stdout and exits 0 for ok, 1 for errors,
2 for failed. `serve` reads one JSON request per stdin line and answers one JSON object per stdout
line, in request order. Logs go to stderr; nothing else is written to stdout.
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


def _options(raw) -> BuildOptions:
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ValueError("options must be an object")
    known = {"timeout", "render", "kicad", "cache"}
    extra = sorted(set(raw) - known)
    if extra:
        raise ValueError(f"unknown option {extra[0]!r}")
    return BuildOptions(timeout=float(raw.get("timeout", 30.0)), render=bool(raw.get("render", False)),
                        kicad=bool(raw.get("kicad", True)), cache=bool(raw.get("cache", True)))


def _answer(line: str) -> tuple[dict, bool]:
    """(the reply, whether to stop)."""
    try:
        req = json.loads(line)
    except json.JSONDecodeError as e:
        return {"id": None, "ok": False, "error": f"that line is not JSON: {e.msg}"}, False
    if not isinstance(req, dict):
        return {"id": None, "ok": False, "error": "a request is a JSON object with an op"}, False
    rid = req.get("id")
    op = req.get("op")
    if op == "ping":
        return {"id": rid, "ok": True, "pong": {"kernel": __version__, "schema": SCHEMA}}, False
    if op == "shutdown":
        return {"id": rid, "ok": True}, True
    if op == "build":
        project = req.get("project")
        if not isinstance(project, str) or not project:
            return {"id": rid, "ok": False, "error": "build needs a project folder"}, False
        if not Path(project).is_dir():
            return {"id": rid, "ok": False, "error": f"no project folder at {project}"}, False
        try:
            options = _options(req.get("options"))
        except (TypeError, ValueError) as e:
            return {"id": rid, "ok": False, "error": str(e)}, False
        try:
            result = build(Path(project), options)
        except Exception as e:  # noqa: BLE001 - the loop must survive an engine fault
            print(f"pino-kernel: build failed inside the engine: {e!r}", file=sys.stderr)
            return {"id": rid, "ok": False, "error": f"the engine failed: {type(e).__name__}: {e}"}, False
        return {"id": rid, "ok": True, "result": result.to_dict()}, False
    return {"id": rid, "ok": False, "error": f"unknown op {op!r}"}, False


def serve(stdin=None, stdout=None) -> int:
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    for line in stdin:
        if not line.strip():
            continue
        reply, stop = _answer(line)
        stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
        stdout.flush()
        if stop:
            break
    return 0


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
    args = parser.parse_args(argv)
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
        return serve()
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
