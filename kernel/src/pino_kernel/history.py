"""Build history: .pino/builds.json, numbered builds, written atomically under a file lock.

A build takes its number first (an entry marked running), so two builds of one project at once
get different numbers; the entry gets its hash and verdict when the build ends.
"""

from __future__ import annotations

import datetime
import fcntl
import json
import os
from contextlib import contextmanager
from pathlib import Path

SCHEMA = "pino.builds/1"
KEEP = 100


class History:
    def __init__(self, project: Path):
        self.dot = Path(project) / ".pino"
        self.path = self.dot / "builds.json"
        self.lock_path = self.dot / "builds.lock"

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
        builds = data.get("builds") if isinstance(data, dict) else None
        return builds if isinstance(builds, list) else []

    def _write(self, builds: list[dict]) -> None:
        tmp = self.path.with_name(f"builds.json.tmp-{os.getpid()}")
        tmp.write_text(json.dumps({"schema": SCHEMA, "builds": builds[-KEEP:]}, indent=1) + "\n", encoding="utf-8")
        os.replace(tmp, self.path)

    @staticmethod
    def _now() -> str:
        return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()

    def next_number(self) -> int:
        """Take the next build number (recorded as running until record() is called)."""
        with self._locked():
            builds = self._read()
            number = max((b.get("number", 0) for b in builds), default=0) + 1
            builds.append({"number": number, "hash": None, "verdict": "running", "at": self._now()})
            self._write(builds)
            return number

    def mark(self, number: int, hash: str) -> None:
        """Say which build folder a running build is about to put in place, so no other build prunes it."""
        with self._locked():
            builds = self._read()
            for b in builds:
                if b.get("number") == number:
                    b["hash"] = hash
            self._write(builds)

    def record(self, number: int, hash: str | None, verdict: str, sources: str | None = None) -> None:
        """`sources` is the digest of the files this build read, so release can tell they changed since."""
        with self._locked():
            builds = [b for b in self._read() if b.get("number") != number]
            entry = {"number": number, "hash": hash, "verdict": verdict, "at": self._now()}
            builds.append({**entry, "sources": sources} if sources else entry)
            builds.sort(key=lambda b: b.get("number", 0))
            self._write(builds)

    def entries(self) -> list[dict]:
        with self._locked():
            return self._read()

    def previous(self, hash: str | None) -> dict | None:
        """The latest finished build with another hash whose folder still exists."""
        for b in reversed(self.entries()):
            h = b.get("hash")
            if h and h != hash and b.get("verdict") != "running" and (self.dot / "build" / h).is_dir():
                return b
        return None

    def recent_hashes(self, n: int) -> list[str]:
        """The newest n finished builds' hashes, plus every running build's."""
        out: list[str] = []
        finished = 0
        for b in reversed(self.entries()):
            h = b.get("hash")
            if not h or h in out:
                continue
            if b.get("verdict") == "running":
                out.append(h)
            elif finished < n:
                out.append(h)
                finished += 1
        return out
