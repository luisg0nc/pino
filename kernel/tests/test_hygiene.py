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


def test_pino_does_not_use_easyeda():
    """The EasyEDA fallback is Luis's call (its data's licence notice): no EasyEDA host, tool or data."""
    pattern = re.compile(r"easyeda2kicad|easyeda\.com|lceda\.cn|easyeda_components", re.I)
    me = Path(__file__).resolve()
    hits = [str(p.relative_to(KERNEL)) for p in _files(KERNEL) if p != me and p.name != "README.md"
            and pattern.search(p.read_text(errors="replace"))]
    assert hits == []


def test_ported_files_name_their_origin():
    notice = (KERNEL / "NOTICE").read_text()
    ported = [line.split()[1] for line in notice.splitlines() if line.startswith("- src/")]
    assert ported and all((KERNEL / rel).is_file() for rel in ported)
    for rel in ported:
        head = "\n".join((KERNEL / rel).read_text().splitlines()[:40])
        assert "pcb-kit" in head, rel


def test_the_fab_readme_has_no_em_dash():
    assert "—" not in (KERNEL / "src/pino_kernel/release/readme.py").read_text()
