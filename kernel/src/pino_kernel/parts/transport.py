"""How pino asks for a URL: over HTTP, from recorded answers, or not at all."""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Mapping

from .. import __version__


@dataclass(frozen=True)
class Response:
    status: int
    body: bytes
    headers: dict[str, str] = field(default_factory=dict)  # lower-case names


Transport = Callable[[str, float], Response]


class OfflineError(Exception):
    """No answer: no network, a timeout, or offline was asked for."""


def _headers(h) -> dict[str, str]:
    return {k.lower(): v for k, v in (h.items() if h is not None else ())}


def http_transport(url: str, timeout: float) -> Response:
    """The only request pino makes. Its User-Agent names pino and nothing about the user."""
    request = urllib.request.Request(url, headers={"User-Agent": f"pino-kernel/{__version__}"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as r:
            return Response(r.status, r.read(), _headers(r.headers))
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except (OSError, http.client.HTTPException):
            body = b""
        return Response(e.code, body, _headers(e.headers))
    except urllib.error.URLError as e:
        raise OfflineError(str(e.reason)) from None
    except (OSError, http.client.HTTPException) as e:  # a timeout or a dropped connection while reading
        raise OfflineError(str(e) or type(e).__name__) from None


def recorded_name(url: str) -> str:
    """The file a recorded answer lives in: the path, then a short hash of the query."""
    parts = urllib.parse.urlsplit(url)
    name = parts.path.replace("/", "_")
    if parts.query:
        name += "-" + hashlib.sha1(parts.query.encode()).hexdigest()[:8]
    return name + ".json"


class RecordedTransport:
    """Answers from files written by scripts/record_parts.py: {"status": 200, "body": ..., "headers": {...}}.
    A URL with no file gives 404 and is kept in `.misses`."""

    def __init__(self, folder: Path):
        self.folder = Path(folder)
        self.calls: list[str] = []
        self.misses: list[str] = []

    def __call__(self, url: str, timeout: float) -> Response:
        self.calls.append(url)
        path = self.folder / recorded_name(url)
        if not path.is_file():
            self.misses.append(url)
            return Response(404, b"", {})
        data = json.loads(path.read_text(encoding="utf-8"))
        return Response(int(data["status"]), json.dumps(data.get("body")).encode(), dict(data.get("headers") or {}))


def no_network(url: str, timeout: float) -> Response:
    raise OfflineError("offline: PINO_PARTS_OFFLINE is set")


def transport_from_env(env: Mapping[str, str] = os.environ) -> Transport:
    if env.get("PINO_PARTS_RECORDED"):
        return RecordedTransport(Path(env["PINO_PARTS_RECORDED"]))
    if env.get("PINO_PARTS_OFFLINE") == "1":
        return no_network
    return http_transport
