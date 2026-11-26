"""pino-kernel: build a project once, or serve builds over JSON lines.

    pino-kernel build <project> [--timeout S] [--render] [--no-kicad] [--no-cache]
    pino-kernel version
    pino-kernel serve

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
    args = parser.parse_args(argv)
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
