"""Gerbers and drill files from kicad-cli, with their dates taken out, and the zip JLC takes.

Files come out in the board frame (the drill and place origin at the outline centre, y up) with Protel extensions,
as JLC's "How to Generate Gerber and Drill Files in KiCad" asks. The same board always gives the same bytes.
"""

from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from pathlib import Path
from typing import Mapping

from ..kicad_cli import CliRun, KicadCli
from ..normalize import normalize

MAX_SLUG = 60
_EXTENSIONS = {"F.Cu": "gtl", "B.Cu": "gbl", "F.Paste": "gtp", "B.Paste": "gbp", "F.Silkscreen": "gto",
               "B.Silkscreen": "gbo", "F.Mask": "gts", "B.Mask": "gbs", "Edge.Cuts": "gm1"}


class ExportError(Exception):
    pass


def slug(name: str) -> str:
    """A file name part: ASCII, lower case, dashes. "Placa ação #2" gives "placa-acao-2"."""
    ascii_text = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")[:MAX_SLUG].strip("-") or "board"


def fab_layers(n_copper: int) -> list[str]:
    inner = [f"In{i}.Cu" for i in range(1, n_copper - 1)]
    return ["F.Cu", *inner, "B.Cu", "F.Paste", "B.Paste", "F.Silkscreen", "B.Silkscreen", "F.Mask", "B.Mask",
            "Edge.Cuts"]


def file_name(stem: str, layer: str) -> str:
    extension = _EXTENSIONS.get(layer) or f"g{layer[2:-3]}"  # In1.Cu is .g1
    return f"{stem}-{layer.replace('.', '_')}.{extension}"


def _check(run: CliRun) -> None:
    if not run.ok:
        raise ExportError(f"kicad-cli {run.step} failed: {run.last_line() or f'exit code {run.returncode}'}")


def export(cli: KicadCli, work: Path, stem: str, n_copper: int, cancel=None) -> dict[str, bytes]:
    """{file name: bytes} for every fab layer and the two drill files of work/<stem>.kicad_pcb."""
    out = work / "export"
    pcb = work / f"{stem}.kicad_pcb"
    layers = fab_layers(n_copper)
    _check(cli.gerbers(pcb, out, layers, cancel=cancel))
    drill_out = work / "export-drill"
    _check(cli.drill(pcb, drill_out, cancel=cancel))
    wanted = {file_name(stem, layer): out for layer in layers}
    wanted.update({f"{stem}-PTH.drl": drill_out, f"{stem}-NPTH.drl": drill_out})
    files = {}
    for name in sorted(wanted):
        path = wanted[name] / name
        if not path.is_file():
            raise ExportError(f"kicad-cli did not write {name}")
        normalize(path)
        files[name] = path.read_bytes()
    return files


def zip_bytes(files: Mapping[str, bytes]) -> bytes:
    """The same files always zip to the same bytes: sorted names, one fixed time and mode."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o644 << 16
            z.writestr(info, files[name], compresslevel=9)
    return buffer.getvalue()
