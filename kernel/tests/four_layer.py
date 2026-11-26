"""The 4-layer pass-mark board: Watchy (MIT), fetched from GitHub at a pinned commit, checked by sha256, upgraded
to KiCad 10, stripped of its copper, with finish.json's moves applied. Nothing of it is committed but its source."""

from __future__ import annotations

import hashlib
import json
import shutil
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

from pino_kernel.circuit import PairSpec, RouteHint
from pino_kernel.pcb.copper import move_footprint, strip_copper

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "four_layer"


class Offline(Exception):
    pass


def finish() -> dict:
    return json.loads((FIXTURE / "finish.json").read_text())


def finish_pairs() -> list[PairSpec]:
    out = []
    for p, n in finish()["pairs"]:
        out.append(PairSpec(p[:-1] if p.endswith("+") else p[:-2], p, n, None, None, None))
    return out


def finish_hints() -> list[RouteHint]:
    return [RouteHint(h["net"], tuple(h["region"]) if h.get("region") else None, h.get("layers"),
                      [tuple(p) for p in h["corridor"]] if h.get("corridor") else None, list(h.get("rip", [])), k + 1)
            for k, h in enumerate(finish()["hints"])]


def fetch(dest: Path, cache: Path | None = None) -> dict[str, Path]:
    """The source files in dest, fetched (or copied from `cache`) and checked against their sha256."""
    source = json.loads((FIXTURE / "source.json").read_text())
    dest.mkdir(parents=True, exist_ok=True)
    out = {}
    for name in source["files"]:
        path = dest / name
        if cache is not None and (cache / name).is_file():
            shutil.copy(cache / name, path)
        else:
            url = f"{source['repo'].replace('github.com', 'raw.githubusercontent.com')}/{source['commit']}/{name}"
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "pino-tests"}),
                                            timeout=60) as resp:
                    path.write_bytes(resp.read())
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                raise Offline(f"offline: the 4-layer test board is fetched from GitHub ({e})") from None
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != source["sha256"][name]:
            raise ValueError(f"{name} does not match its pinned sha256 ({digest})")
        out[name] = path
    return out


def prepare(kicad, dest: Path, cache: Path | None = None) -> SimpleNamespace:
    """The stripped, moved board ready to route: text, pro text, project files and the baseline DRC."""
    files = fetch(dest / "source", cache)
    work = dest / "board"
    work.mkdir(parents=True, exist_ok=True)
    pcb, pro = work / "board.kicad_pcb", work / "board.kicad_pro"
    shutil.copy(files["Watchy.kicad_pcb"], pcb)
    shutil.copy(files["Watchy.kicad_pro"], pro)
    run = kicad.run("pcb upgrade", "pcb", "upgrade", str(pcb), timeout=120)
    assert run.ok, run.output
    text = strip_copper(pcb.read_text(encoding="utf-8"))
    for m in finish()["moves"]:
        text = move_footprint(text, m["ref"], m["dx"], m["dy"])
    pcb.write_text(text, encoding="utf-8")
    base = dest / "baseline"
    base.mkdir(exist_ok=True)
    shutil.copy(pcb, base / "board.kicad_pcb")
    shutil.copy(pro, base / "board.kicad_pro")
    r = kicad.drc(base / "board.kicad_pcb", base / "drc.json", refill=True, save=True)
    assert r.ok, r.output
    return SimpleNamespace(text=text, pro=pro.read_text(encoding="utf-8"), files={"board.kicad_pro": pro},
                           baseline_drc=json.loads((base / "drc.json").read_text(encoding="utf-8")))
