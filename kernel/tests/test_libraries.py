import pytest

from pino_kernel.libraries import LibrariesNotFound, discover


def test_pino_variables_win(tmp_path):
    for d in ("s", "f", "m"):
        (tmp_path / d).mkdir()
    env = {"PINO_KICAD_SYMBOL_DIR": str(tmp_path / "s"), "PINO_KICAD_FOOTPRINT_DIR": str(tmp_path / "f"),
           "PINO_KICAD_3DMODEL_DIR": str(tmp_path / "m"), "KICAD10_SYMBOL_DIR": "/nowhere"}
    libs = discover(env)
    assert libs.symbols == tmp_path / "s" and libs.path_vars()["KICAD10_3DMODEL_DIR"] == str(tmp_path / "m")


def test_nothing_found_lists_what_was_tried():
    with pytest.raises(LibrariesNotFound) as e:
        discover({"PINO_KICAD_SYMBOL_DIR": "/nowhere/s", "HOME": "/nowhere"}, roots=())
    assert "/nowhere/s" in e.value.tried


def test_missing_models_dir_is_allowed(tmp_path):
    (tmp_path / "s").mkdir(); (tmp_path / "f").mkdir()
    libs = discover({"PINO_KICAD_SYMBOL_DIR": str(tmp_path / "s"), "PINO_KICAD_FOOTPRINT_DIR": str(tmp_path / "f"),
                     "HOME": "/nowhere"}, roots=())
    assert libs.footprints == tmp_path / "f" and not libs.models.is_dir()


def test_a_wrong_pino_variable_is_not_replaced(tmp_path):
    (tmp_path / "s").mkdir(); (tmp_path / "f").mkdir()
    with pytest.raises(LibrariesNotFound) as e:
        discover({"PINO_KICAD_SYMBOL_DIR": "/nowhere/symbols", "KICAD10_SYMBOL_DIR": str(tmp_path / "s"),
                  "PINO_KICAD_FOOTPRINT_DIR": str(tmp_path / "f")})
    assert e.value.missing == ["symbols"] and e.value.tried[:2] == ["/nowhere/symbols", str(tmp_path / "f")]
