"""Take the run's date and the build folder's absolute path out of what kicad-cli writes.

A build folder must be a pure function of its inputs (two copies of a project give the same
bytes), and must not carry absolute paths. kicad-cli stamps the time into SVG titles, report
JSON, the netlist, the GLB, Gerbers and drill files, and the input's full path into the netlist; its threaded DRC
lists unconnected pads in no fixed order.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

_SVG_TITLE = re.compile(r"<title>SVG Image created as (\S+) date [^<]*</title>")
_SOURCE = re.compile(r"<source>[^<]*?([^/<]+)</source>")
_DATE = re.compile(r"<date>[^<]*</date>")
_GLB_TIME = re.compile(rb'"generated_at"\s*:\s*"([^"]*)"')
# Gerber and drill files: X2's creation date, and the date in KiCad's comments
_GERBER_SUFFIX = re.compile(r"^\.(gbr|gtl|gbl|gto|gbo|gts|gbs|gtp|gbp|gm\d+|g\d+|drl)$")
_FIXED_DATE = "2000-01-01T00:00:00+00:00"
_GERBER_DATES = (
    (re.compile(r"%TF\.CreationDate,[^*]*\*%"), f"%TF.CreationDate,{_FIXED_DATE}*%"),
    (re.compile(r"(G04 Created by KiCad \([^)]*\)) date [^*]*\*"), r"\1*"),
    (re.compile(r"(?m)^(; DRILL file .*?) date \S+"), r"\1"),
    (re.compile(r"(?m)^(; #@! TF\.CreationDate,)\S+"), rf"\g<1>{_FIXED_DATE}"),
)


def _unconnected(entries: list) -> list:
    """DRC's unconnected items as positions only, in a fixed order. KiCad's DRC runs in threads and names either
    of two pads that share a spot (USB-C's stacked A1 and B12), so the pads' names and ids vary between runs."""
    out = []
    for e in entries:
        items = sorted(({"pos": it["pos"]} for it in e.get("items", []) if "pos" in it),
                       key=lambda it: (it["pos"].get("x", 0), it["pos"].get("y", 0)))
        out.append({"description": e.get("description", ""), "items": items, "severity": e.get("severity", ""),
                    "type": e.get("type", "")})
    return sorted(out, key=lambda e: json.dumps(e, sort_keys=True))


def normalize(path: Path) -> None:
    path = Path(path)
    if not path.is_file():
        return
    if path.suffix == ".svg":
        text = path.read_text(encoding="utf-8")
        new = _SVG_TITLE.sub(r"<title>SVG Image created as \1</title>", text)
        if new != text:
            path.write_text(new, encoding="utf-8")
    elif path.suffix == ".json":
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return
        if not isinstance(data, dict):
            return
        changed = data.pop("date", None) is not None
        if isinstance(data.get("unconnected_items"), list):
            data["unconnected_items"] = _unconnected(data["unconnected_items"])
            changed = True
        if changed:
            path.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    elif _GERBER_SUFFIX.match(path.suffix):
        data = path.read_bytes().decode("utf-8", "surrogateescape")
        new = data
        for pattern, replacement in _GERBER_DATES:
            new = pattern.sub(replacement, new)
        if new != data:
            path.write_bytes(new.encode("utf-8", "surrogateescape"))
    elif path.suffix == ".xml":
        text = path.read_text(encoding="utf-8")
        new = _DATE.sub("<date></date>", _SOURCE.sub(r"<source>\1</source>", text))
        if new != text:
            path.write_text(new, encoding="utf-8")
    elif path.suffix == ".glb":
        data = path.read_bytes()
        # same length, so the GLB's chunk sizes stay right
        new = _GLB_TIME.sub(lambda m: m.group(0).replace(m.group(1), b"0" * len(m.group(1))), data)
        if new != data:
            path.write_bytes(new)
