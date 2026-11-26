import re
from pathlib import Path

KERNEL = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".venv", "__pycache__", ".pytest_cache", ".spike-cache"}
TEXT_SUFFIXES = {".py", ".toml", ".md", ".json", ".kicad_sym", ".kicad_mod", ".txt", ".xml", ".yml", ".yaml", ""}


def _files(root: Path):
    for p in sorted(root.rglob("*")):
        if p.is_file() and not (set(p.relative_to(KERNEL).parts) & SKIP_DIRS) and p.suffix in TEXT_SUFFIXES:
            yield p


def test_no_pcbnew_import():
    pattern = re.compile(r"^\s*(import|from)\s+pcbnew", re.M)
    hits = [str(p) for p in _files(KERNEL / "src") if pattern.search(p.read_text(errors="replace"))]
    assert hits == []


def test_no_personal_paths():
    pattern = re.compile(r"/home/[a-z]|/Users/")
    me = Path(__file__).resolve()
    hits = [str(p.relative_to(KERNEL)) for p in _files(KERNEL) if p != me and pattern.search(p.read_text(errors="replace"))]
    assert hits == []


def test_no_gpl_code():
    pattern = re.compile(r"GNU General Public License|SPDX-License-Identifier: GPL")
    hits = [str(p.relative_to(KERNEL)) for p in _files(KERNEL / "src") if pattern.search(p.read_text(errors="replace"))]
    assert hits == []
