"""Route history: .pino/routes.json, numbered routes, written atomically under a file lock."""

from __future__ import annotations

import datetime
import fcntl
import json
import os
from contextlib import contextmanager
from pathlib import Path

SCHEMA = "pino.routes/1"
KEEP = 100


class RouteHistory:
    def __init__(self, project: Path):
        self.dot = Path(project) / ".pino"
        self.path = self.dot / "routes.json"
        self.lock_path = self.dot / "routes.lock"

    @contextmanager
    def _locked(self):
        self.dot.mkdir(parents=True, exist_ok=True)
        with open(self.lock_path, "a+") as fh:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)

    def _read(self) -> list[dict]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return []
        routes = data.get("routes") if isinstance(data, dict) else None
        return routes if isinstance(routes, list) else []

    def _write(self, routes: list[dict]) -> None:
        tmp = self.path.with_name(f"routes.json.tmp-{os.getpid()}")
        tmp.write_text(json.dumps({"schema": SCHEMA, "routes": routes[-KEEP:]}, indent=1) + "\n", encoding="utf-8")
        os.replace(tmp, self.path)

    @staticmethod
    def _now() -> str:
        return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()

    def next_number(self) -> int:
        """Take the next route number (recorded as running until record() is called)."""
        with self._locked():
            routes = self._read()
            number = max((r.get("number", 0) for r in routes), default=0) + 1
            routes.append({"number": number, "key": None, "build": None, "state": "running", "complete": None,
                           "at": self._now()})
            self._write(routes)
            return number

    def fail_running(self, except_number: int) -> None:
        """Mark every running entry but one as failed (call it while holding the project's job lock)."""
        with self._locked():
            routes = self._read()
            changed = False
            for r in routes:
                if r.get("state") == "running" and r.get("number") != except_number:
                    r["state"] = "failed"
                    changed = True
            if changed:
                self._write(routes)

    def record(self, number: int, key: str | None, build: str | None, state: str, complete: bool | None) -> None:
        with self._locked():
            routes = [r for r in self._read() if r.get("number") != number]
            routes.append({"number": number, "key": key, "build": build, "state": state, "complete": complete,
                           "at": self._now()})
            routes.sort(key=lambda r: r.get("number", 0))
            self._write(routes)

    def entries(self) -> list[dict]:
        with self._locked():
            return self._read()

    def latest_done(self, key: str | None = None) -> dict | None:
        """The newest finished route (of `key` when given) whose folder still exists."""
        for r in reversed(self.entries()):
            if r.get("state") == "done" and r.get("key") and (key is None or r["key"] == key) and \
                    (self.dot / "routes" / r["key"] / "route.json").is_file():
                return r
        return None

    def recent_keys(self, n: int) -> list[str]:
        out: list[str] = []
        for r in reversed(self.entries()):
            k = r.get("key")
            if r.get("state") == "done" and k and k not in out:
                out.append(k)
            if len(out) >= n:
                break
        return out
