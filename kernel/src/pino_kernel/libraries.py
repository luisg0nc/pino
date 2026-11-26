"""Where KiCad's symbol, footprint and 3D model libraries live on this machine.

Order per kind: PINO_KICAD_<KIND>_DIR, then KICAD10_<KIND>_DIR, then the usual install
roots (system packages, /usr/local, Flatpak's library extension system-wide and per user).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

FLATPAK_LIB = "flatpak/runtime/org.kicad.KiCad.Library/x86_64/stable/active/files"

DEFAULT_ROOTS: tuple[str, ...] = (
    "/usr/share/kicad",
    "/usr/local/share/kicad",
    f"/var/lib/{FLATPAK_LIB}",
    f"~/.local/share/{FLATPAK_LIB}",
)

# kind -> (variable suffix, folder name under a root)
KINDS = {"symbols": ("SYMBOL", "symbols"), "footprints": ("FOOTPRINT", "footprints"), "models": ("3DMODEL", "3dmodels")}


class LibrariesNotFound(Exception):
    def __init__(self, missing: Sequence[str], tried: list[str]):
        self.missing = list(missing)
        self.tried = tried
        super().__init__(
            f"KiCad's {' and '.join(self.missing)} libraries were not found. Tried: {', '.join(tried)}. "
            "Install KiCad 10's libraries or set PINO_KICAD_SYMBOL_DIR and PINO_KICAD_FOOTPRINT_DIR."
        )


@dataclass(frozen=True)
class Libraries:
    symbols: Path
    footprints: Path
    models: Path

    def path_vars(self) -> dict[str, str]:
        return {
            "KICAD10_SYMBOL_DIR": str(self.symbols),
            "KICAD10_FOOTPRINT_DIR": str(self.footprints),
            "KICAD10_3DMODEL_DIR": str(self.models),
        }


def _expand(root: str, env: Mapping[str, str]) -> str:
    if root.startswith("~/"):
        home = env.get("HOME")
        if not home:
            return ""
        return home.rstrip("/") + root[1:]
    return root


def discover(env: Mapping[str, str] = os.environ, roots: Sequence[str] = DEFAULT_ROOTS) -> Libraries:
    found: dict[str, Path] = {}
    tried: list[str] = []
    for kind, (var, folder) in KINDS.items():
        candidates = [env.get(f"PINO_KICAD_{var}_DIR"), env.get(f"KICAD10_{var}_DIR")]
        candidates += [f"{_expand(r, env)}/{folder}" for r in roots if _expand(r, env)]
        for c in candidates:
            if not c:
                continue
            tried.append(c)
            if Path(c).is_dir():
                found[kind] = Path(c)
                break
    missing = [k for k in ("symbols", "footprints") if k not in found]
    if missing:
        raise LibrariesNotFound(missing, tried)
    models = found.get("models")
    if models is None:
        # A missing models folder is allowed: every 3D model then counts as missing.
        models = found["footprints"].parent / "3dmodels"
    return Libraries(found["symbols"], found["footprints"], models)
