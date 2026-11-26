"""pino-kernel serve: JSON-line requests on stdin, one JSON object per line on stdout.

Ordered ops are answered in request order by one worker: ping, build, route_status, keep, nudge without
routing, unknown ops and bad lines, shutdown. Job ops (route, route_net, nudge with route, parts, release) start a child
`pino-kernel <op> ... --events` from that worker and stream: each progress event comes back as
{"id", "event": {...}}, and the end as {"id", "ok": true, "result": {...}}. cancel (or its older name route_cancel)
is answered at once, out of order. fab_profiles lists the fab's limits. shutdown and the end of input cancel running jobs, wait up to 10 s for them, and stop.
Every line is written whole, under one lock, and flushed.
"""

from __future__ import annotations

import importlib
import json
import os
import queue
import signal
import subprocess
import sys
import threading
from collections import deque
from pathlib import Path
from typing import Callable

from . import __version__
from .build import BuildOptions, build
from .fab import PROFILES
from .result import SCHEMA

SERVE_VERSION = 3
ROUTE_SCHEMA = "pino.route/1"
PARTS_SCHEMA = "pino.parts/1"
RELEASE_SCHEMA = "pino.release/1"
CANCEL_OPS = ("route_cancel", "cancel")
STOP_WAIT = 10.0
KILL_AFTER = 5.0
MAX_ERROR = 300


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


class Output:
    def __init__(self, stream):
        self.stream = stream
        self.lock = threading.Lock()

    def write(self, obj: dict) -> None:
        line = json.dumps(obj, ensure_ascii=False) + "\n"
        with self.lock:
            self.stream.write(line)
            self.stream.flush()


class JobRunner:
    """Child processes for job ops, each in its own process group, their lines relayed under the request id."""

    def __init__(self, out: Output):
        self.out = out
        self.jobs: dict = {}
        self.lock = threading.Lock()

    def start(self, id, argv: list[str]) -> None:
        proc = subprocess.Popen([sys.executable, "-m", "pino_kernel.cli", *argv, "--events"], stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, text=True, encoding="utf-8",
                                errors="replace", start_new_session=True)
        err: deque[str] = deque(maxlen=20)
        t = threading.Thread(target=self._relay, args=(id, proc, err), daemon=True)
        e = threading.Thread(target=self._stderr, args=(proc, err), daemon=True)
        with self.lock:
            self.jobs[id] = (proc, t)
        e.start()
        t.start()

    @staticmethod
    def _stderr(proc, err) -> None:
        for line in proc.stderr:
            if line.strip():
                err.append(line.rstrip("\n"))

    def _relay(self, id, proc, err) -> None:
        done = False
        for line in proc.stdout:
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(ev, dict) and ev.get("event") == "done":
                self.out.write({"id": id, "ok": True, "result": ev.get("result")})
                done = True
            else:
                self.out.write({"id": id, "event": ev})
        proc.wait()
        if not done:
            last = err[-1] if err else f"exit code {proc.returncode}"
            op = proc.args[3] if len(proc.args) > 3 else "pino"
            self.out.write({"id": id, "ok": False, "error": f"{op} job stopped: {last}"[:MAX_ERROR]})
        with self.lock:
            self.jobs.pop(id, None)

    def running(self, id) -> bool:
        with self.lock:
            job = self.jobs.get(id)
        return job is not None and job[0].poll() is None

    def cancel(self, id) -> bool:
        with self.lock:
            job = self.jobs.get(id)
        if job is None or job[0].poll() is not None:
            return False
        proc = job[0]
        try:
            os.killpg(proc.pid, signal.SIGTERM)  # the job's own group only
        except ProcessLookupError:
            return False

        def kill():
            if proc.poll() is None:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

        timer = threading.Timer(KILL_AFTER, kill)
        timer.daemon = True
        timer.start()
        return True

    def ids(self) -> list:
        with self.lock:
            return list(self.jobs)

    def wait_all(self, timeout: float) -> None:
        import time

        end = time.monotonic() + timeout
        for id in self.ids():
            with self.lock:
                job = self.jobs.get(id)
            if job is None:
                continue
            proc, t = job
            t.join(max(0.0, end - time.monotonic()))
            if proc.poll() is None:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                t.join(2.0)


def _project(req: dict, op: str) -> Path:
    project = req.get("project")
    if not isinstance(project, str) or not project:
        raise ValueError(f"{op} needs a project folder")
    if not Path(project).is_dir():
        raise ValueError(f"no project folder at {project}")
    return Path(project)


ROUTE_OPTIONS = {"build", "timeout", "step_timeout", "install", "cache"}


def route_argv(project: Path, raw) -> list[str]:
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ValueError("options must be an object")
    extra = sorted(set(raw) - ROUTE_OPTIONS)
    if extra:
        raise ValueError(f"unknown option {extra[0]!r}")
    argv = ["route", str(project)]
    if raw.get("build"):
        argv += ["--build", str(raw["build"])]
    if raw.get("timeout") is not None:
        argv += ["--timeout", str(float(raw["timeout"]))]
    if raw.get("step_timeout") is not None:
        argv += ["--step-timeout", str(float(raw["step_timeout"]))]
    if raw.get("install") is False:
        argv.append("--no-install")
    if raw.get("cache") is False:
        argv.append("--no-cache")
    return argv


class Server:
    def __init__(self, out: Output):
        self.out = out
        self.jobs = JobRunner(out)
        # op -> handler(req) returning a reply dict, or None when a job was started
        self.ordered: dict[str, Callable[[dict], dict | None]] = {
            "ping": self.ping, "build": self.build, "route_status": self.route_status, "route": self.route,
            "fab_profiles": self.fab_profiles}
        self.extend()

    def extend(self) -> None:
        """Hook for more ops: the finishing tools, parts and release."""
        for module in ("routing.trials", "parts.ops", "release.ops"):
            try:
                serve_ops = importlib.import_module(f"{__package__}.{module}").serve_ops
            except ImportError:
                continue
            self.ordered.update(serve_ops(self))

    def fab_profiles(self, req: dict) -> dict:
        return {"id": req.get("id"), "ok": True, "profiles": [p.to_json() for p in PROFILES.values()]}

    def ping(self, req: dict) -> dict:
        return {"id": req.get("id"), "ok": True,
                "pong": {"kernel": __version__, "schema": SCHEMA, "serve": SERVE_VERSION, "route_schema": ROUTE_SCHEMA,
                         "parts_schema": PARTS_SCHEMA, "release_schema": RELEASE_SCHEMA}}

    def build(self, req: dict) -> dict:
        rid = req.get("id")
        project = _project(req, "build")
        options = _options(req.get("options"))
        try:
            result = build(project, options)
        except Exception as e:  # noqa: BLE001 - the loop must survive an engine fault
            print(f"pino-kernel: build failed inside the engine: {e!r}", file=sys.stderr)
            return {"id": rid, "ok": False, "error": f"the engine failed: {type(e).__name__}: {e}"[:MAX_ERROR]}
        return {"id": rid, "ok": True, "result": result.to_dict()}

    def route_status(self, req: dict) -> dict:
        from .routing.job import latest_build
        from .routing.state import build_routing

        project = _project(req, "route_status")
        b = latest_build(project)
        if b is None:
            return {"id": req.get("id"), "ok": False, "error": "no build yet: save board.py first"}
        return {"id": req.get("id"), "ok": True, "status": build_routing(project, project / ".pino" / "build" / b)}

    def start_job(self, req: dict, argv: list[str]) -> None:
        rid = req.get("id")
        if self.jobs.running(rid):
            raise ValueError(f"a job with id {rid!r} is already running")
        self.jobs.start(rid, argv)

    def route(self, req: dict) -> None:
        project = _project(req, "route")
        self.start_job(req, route_argv(project, req.get("options")))
        return None

    def answer(self, line: str) -> tuple[dict | None, bool]:
        """(the reply or None, whether to stop)."""
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            return {"id": None, "ok": False, "error": f"that line is not JSON: {e.msg}"}, False
        if not isinstance(req, dict):
            return {"id": None, "ok": False, "error": "a request is a JSON object with an op"}, False
        rid, op = req.get("id"), req.get("op")
        if op == "shutdown":
            return {"id": rid, "ok": True}, True
        handler = self.ordered.get(op)
        if handler is None:
            return {"id": rid, "ok": False, "error": f"unknown op {op!r}"}, False
        try:
            return handler(req), False
        except (TypeError, ValueError) as e:
            return {"id": rid, "ok": False, "error": str(e)[:MAX_ERROR]}, False
        except Exception as e:  # noqa: BLE001 - the loop must survive an engine fault
            print(f"pino-kernel: {op} failed inside the engine: {e!r}", file=sys.stderr)
            return {"id": rid, "ok": False, "error": f"the engine failed: {type(e).__name__}: {e}"[:MAX_ERROR]}, False

    def stop_jobs(self) -> None:
        for id in self.jobs.ids():
            self.jobs.cancel(id)
        self.jobs.wait_all(STOP_WAIT)


def main(stdin=None, stdout=None) -> int:
    stdin = stdin or sys.stdin
    out = Output(stdout or sys.stdout)
    server = Server(out)
    work: queue.Queue = queue.Queue()

    def reader() -> None:
        for line in stdin:
            if not line.strip():
                continue
            try:
                req = json.loads(line)
            except json.JSONDecodeError:
                req = None
            if isinstance(req, dict) and req.get("op") in CANCEL_OPS:
                out.write({"id": req.get("id"), "ok": True, "cancelled": server.jobs.cancel(req.get("job"))})
                continue
            work.put(line)
        work.put(None)

    threading.Thread(target=reader, daemon=True).start()
    while True:
        line = work.get()
        if line is None:  # end of input
            server.stop_jobs()
            return 0
        reply, stop = server.answer(line)
        if stop:
            server.stop_jobs()
        if reply is not None:
            out.write(reply)
        if stop:
            return 0
