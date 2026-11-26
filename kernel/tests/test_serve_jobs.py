import json
import os
import subprocess
import sys
import time

import pytest


def wait_for_file(path, timeout=10.0):
    end = time.monotonic() + timeout
    while not path.exists() and time.monotonic() < end:
        time.sleep(0.02)


def serve(lines, wait_for=None, close_after_first_event=False, timeout=60, ready=None):
    """Run `pino-kernel serve`, write `lines` (dicts as JSON; ("after_first_event", dict) waits for the first event
    first), and return every output line parsed, in order. With wait_for, the last line is written only after
    the result of that id has come back."""
    proc = subprocess.Popen([sys.executable, "-m", "pino_kernel.cli", "serve"], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, text=True, start_new_session=True)
    out = []
    started = time.monotonic()

    def read_until(pred):
        for line in proc.stdout:
            o = json.loads(line)
            out.append(o)
            if pred(o):
                return

    def write(d):
        proc.stdin.write(json.dumps(d) + "\n")
        proc.stdin.flush()

    try:
        for i, item in enumerate(lines):
            last = i == len(lines) - 1
            if last and wait_for is not None:
                read_until(lambda o: o.get("id") == wait_for and "event" not in o)
            if isinstance(item, tuple) and item[0] == "after_first_event":
                if not any("event" in o for o in out):
                    read_until(lambda o: "event" in o)
                if ready:
                    ready()
                write(item[1])
            else:
                write(item)
        if close_after_first_event:
            if not any("event" in o for o in out):
                read_until(lambda o: "event" in o)
            if ready:
                ready()
        proc.stdin.close()
        for line in proc.stdout:
            out.append(json.loads(line))
        code = proc.wait(timeout=timeout)
    finally:
        if proc.poll() is None:
            proc.kill()
    serve.code = code
    serve.seconds = time.monotonic() - started
    return out


def gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


def test_route_streams_events_then_one_result(routed_project):
    out = serve([{"id": 7, "op": "route", "project": str(routed_project)}, {"id": 8, "op": "shutdown"}], wait_for=7)
    mine = [o for o in out if o.get("id") == 7]
    assert all("event" in o for o in mine[:-1]) and mine[-1]["ok"] and mine[-1]["result"]["state"] == "done"
    assert sum("result" in o for o in mine) == 1 and any(o.get("event", {}).get("event") == "step" for o in mine)
    assert out[-1] == {"id": 8, "ok": True} and serve.code == 0


def test_build_answers_while_a_route_runs(routed_project, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_SLOW", "3")
    out = serve([{"id": 1, "op": "route", "project": str(routed_project)},
                 {"id": 2, "op": "build", "project": str(routed_project), "options": {"kicad": False}},
                 {"id": 3, "op": "shutdown"}])
    order = [o["id"] for o in out if "result" in o]
    assert order.index(2) < order.index(1)


def test_route_cancel(routed_project, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep")
    monkeypatch.setenv("FAKE_KRT_PIDFILE", str(tmp_path / "pid"))
    out = serve([{"id": 1, "op": "route", "project": str(routed_project)},
                 ("after_first_event", {"id": 2, "op": "route_cancel", "job": 1}), {"id": 3, "op": "shutdown"}],
                wait_for=1, ready=lambda: wait_for_file(tmp_path / "pid"))
    assert {"id": 2, "ok": True, "cancelled": True} in out
    assert next(o for o in out if o.get("id") == 1 and "result" in o)["result"]["state"] == "cancelled"
    assert gone(int((tmp_path / "pid").read_text()))


def test_cancel_unknown_job():
    out = serve([{"id": 1, "op": "route_cancel", "job": 99}, {"id": 2, "op": "shutdown"}])
    assert out[0] == {"id": 1, "ok": True, "cancelled": False}


def test_shutdown_cancels_running_jobs(routed_project, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep")
    monkeypatch.setenv("FAKE_KRT_PIDFILE", str(tmp_path / "pid"))
    out = serve([{"id": 1, "op": "route", "project": str(routed_project)}, ("after_first_event", {"id": 2, "op": "shutdown"})],
                ready=lambda: wait_for_file(tmp_path / "pid"))
    assert serve.code == 0 and serve.seconds < 15
    assert next(o for o in out if o.get("id") == 1 and "result" in o)["result"]["state"] == "cancelled"
    assert out[-1] == {"id": 2, "ok": True}
    assert gone(int((tmp_path / "pid").read_text()))


def test_end_of_input_also_cancels(routed_project, monkeypatch, tmp_path):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep")
    monkeypatch.setenv("FAKE_KRT_PIDFILE", str(tmp_path / "pid"))
    out = serve([{"id": 1, "op": "route", "project": str(routed_project)}], close_after_first_event=True,
                ready=lambda: wait_for_file(tmp_path / "pid"))
    assert serve.code == 0
    assert next(o for o in out if o.get("id") == 1 and "result" in o)["result"]["state"] == "cancelled"
    assert gone(int((tmp_path / "pid").read_text()))


def test_route_status(routed_project):
    out = serve([{"id": 1, "op": "route_status", "project": str(routed_project)},
                 {"id": 2, "op": "route", "project": str(routed_project)},
                 {"id": 3, "op": "route_status", "project": str(routed_project)}], wait_for=2)
    first, last = out[0], out[-1]
    assert first["id"] == 1 and first["ok"] and first["status"]["state"] == "none"
    assert last["id"] == 3 and last["status"]["state"] == "current"


def test_route_bad_requests(tmp_path):
    out = serve([{"id": 1, "op": "route"}, {"id": 2, "op": "route", "project": str(tmp_path / "nope")},
                 {"id": 3, "op": "route", "project": str(tmp_path), "options": {"speed": 1}},
                 {"id": 4, "op": "route_status", "project": str(tmp_path)}])
    assert [o["ok"] for o in out] == [False, False, False, False]
    assert "unknown option" in out[2]["error"] and "save board.py first" in out[3]["error"]


def test_ping_says_serve_2():
    from pino_kernel import __version__

    out = serve([{"id": 1, "op": "ping"}])
    assert out[0]["pong"] == {"kernel": __version__, "schema": "pino.build/1", "serve": 2, "route_schema": "pino.route/1"}
