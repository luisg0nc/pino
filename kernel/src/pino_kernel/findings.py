"""A finding: one thing a check found, with where it is (board, sheet or source)."""

from __future__ import annotations

from dataclasses import dataclass

from .jsonable import encode

SEVERITIES = ("error", "warning", "info")


@dataclass(frozen=True)
class At:
    space: str  # board | sheet | source
    x: float | None = None
    y: float | None = None
    layer: str | None = None
    file: str | None = None
    line: int | None = None

    def to_json(self) -> dict:
        return {k: encode(v) for k, v in self.__dict__.items() if v is not None}

    @classmethod
    def from_json(cls, d: dict) -> "At":
        return cls(**d)


@dataclass(frozen=True)
class Finding:
    source: str
    code: str
    severity: str
    message: str
    at: At | None = None
    refs: tuple[str, ...] = ()
    pins: tuple[str, ...] = ()
    nets: tuple[str, ...] = ()

    def to_json(self) -> dict:
        out: dict = {"source": self.source, "code": self.code, "severity": self.severity, "message": self.message}
        if self.at is not None:
            out["at"] = self.at.to_json()
        for k in ("refs", "pins", "nets"):
            v = getattr(self, k)
            if v:
                out[k] = list(v)
        return out

    @classmethod
    def from_json(cls, d: dict) -> "Finding":
        return cls(d["source"], d["code"], d["severity"], d["message"],
                   At.from_json(d["at"]) if d.get("at") else None,
                   tuple(d.get("refs", ())), tuple(d.get("pins", ())), tuple(d.get("nets", ())))
