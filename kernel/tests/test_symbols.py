import pytest

from pino_kernel.libraries import discover
from pino_kernel.sexpr import find_all
from pino_kernel.symbols import SymbolLibrary, SymbolNotFound, UnsupportedSymbol


def test_loads_pins_in_number_order(fixture_libs):
    assert [p.number for p in SymbolLibrary(fixture_libs.symbols).load("pino_test:R").pins] == ["1", "2"]


def test_symbol_library_indented_with_spaces(fixture_libs):
    lib = SymbolLibrary(fixture_libs.symbols)
    assert lib.load("pino_test:IC6").pins_for("EN")[0].number == "6"


def test_extends_is_flattened(fixture_libs):
    lib = SymbolLibrary(fixture_libs.symbols)
    d = lib.load("pino_test:R_Derived")
    assert d.node[1] == "pino_test:R_Derived" and d.properties["Value"] == "Rd"
    assert d.pins == lib.load("pino_test:R").pins
    assert all(str(s[1]).startswith("R_Derived_") for s in find_all(d.node, "symbol"))


def test_name_stands_for_every_pad(fixture_libs):
    lib = SymbolLibrary(fixture_libs.symbols)
    assert len(lib.load("pino_test:CONN_VBUS").pins_for("VBUS")) == 4
    assert lib.load("pino_test:CONN_VBUS").pins_for(5)[0].name == "GND"


def test_multi_unit_is_refused_in_plain_words(fixture_libs):
    with pytest.raises(UnsupportedSymbol, match="multi-unit symbols are not supported yet: pino_test:DUAL"):
        SymbolLibrary(fixture_libs.symbols).load("pino_test:DUAL")


def test_missing_symbol_and_library(fixture_libs):
    lib = SymbolLibrary(fixture_libs.symbols)
    with pytest.raises(SymbolNotFound):
        lib.load("pino_test:Nope")
    with pytest.raises(SymbolNotFound):
        lib.load("nolib:R")


def test_power_symbol(fixture_libs):
    s = SymbolLibrary(fixture_libs.symbols).load("power:GND")
    assert s.is_power and [p.number for p in s.pins] == ["1"]


def test_source_digest_changes_with_the_parent(fixture_libs, tmp_path):
    import shutil
    shutil.copytree(fixture_libs.symbols, tmp_path / "s")
    lib = SymbolLibrary(tmp_path / "s")
    before = lib.source_digest("pino_test:R_Derived")
    path = tmp_path / "s" / "pino_test.kicad_sym"
    path.write_text(path.read_text().replace('"A derived resistor"', '"Changed"'))
    assert SymbolLibrary(tmp_path / "s").source_digest("pino_test:R_Derived") != before


@pytest.mark.kicad_libs
def test_real_ldo_extends_and_footprint():
    s = SymbolLibrary(discover().symbols).load("Regulator_Linear:AP2112K-3.3")
    assert {p.name for p in s.pins} >= {"VIN", "GND", "EN", "VOUT"}
    assert s.properties["Footprint"] == "Package_TO_SOT_SMD:SOT-23-5"
