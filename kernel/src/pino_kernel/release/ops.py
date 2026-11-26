"""serve's release job and the release_status op."""

from __future__ import annotations

from pathlib import Path

from .versions import BUMPS

RELEASE_OPTIONS = {"bump", "network"}


def release_argv(project: Path, raw) -> list[str]:
    raw = raw or {}
    if not isinstance(raw, dict):
        raise ValueError("options must be an object")
    extra = sorted(set(raw) - RELEASE_OPTIONS)
    if extra:
        raise ValueError(f"unknown option {extra[0]!r}")
    argv = ["release", str(project)]
    if raw.get("bump") is not None:
        if raw["bump"] not in BUMPS:
            raise ValueError("a version bump is patch, minor or major")
        argv.append(f"--{raw['bump']}")
    if raw.get("network") is False:
        argv.append("--offline")
    return argv


def serve_ops(server) -> dict:
    from ..serve import _project

    def release(req: dict) -> None:
        server.start_job(req, release_argv(_project(req, "release"), req.get("options")))
        return None

    def release_status(req: dict) -> dict:
        from .job import readiness

        status = readiness(_project(req, "release_status"))
        return {"id": req.get("id"), "ok": True, "status": status.to_json()}

    return {"release": release, "release_status": release_status}
