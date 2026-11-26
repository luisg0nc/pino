"""Serve ops beyond ping, build and shutdown, which the CLI's loop hands here."""

from __future__ import annotations

import re
from pathlib import Path

from .diff import changes
from .result import cap_changes

_HASH = re.compile(r"[0-9a-f]{12}")


def _board(project: Path, digest: str) -> str | None:
    path = project / ".pino" / "build" / digest / "board.kicad_pcb"
    return path.read_text(encoding="utf-8") if path.is_file() else None


def _diff(req: dict) -> dict:
    rid = req.get("id")
    project = req.get("project")
    if not isinstance(project, str) or not project:
        return {"id": rid, "ok": False, "error": "diff needs a project folder"}
    hashes = [req.get("from"), req.get("to")]
    if not all(isinstance(h, str) and _HASH.fullmatch(h) for h in hashes):
        return {"id": rid, "ok": False, "error": "not a build hash"}
    boards = [_board(Path(project), h) for h in hashes]
    for digest, board in zip(hashes, boards):
        if board is None:
            return {"id": rid, "ok": False, "error": f"build {digest} is no longer kept"}
    try:
        found = cap_changes(changes(boards[0], boards[1]))
    except Exception as e:  # noqa: BLE001 - the loop must survive a board it cannot read
        return {"id": rid, "ok": False, "error": f"the builds could not be compared: {type(e).__name__}: {e}"}
    return {"id": rid, "ok": True, "changes": found}


def extra_op(req: dict) -> dict | None:
    """The reply to an op this module answers, or None for any other op."""
    if req.get("op") == "diff":
        return _diff(req)
    return None
