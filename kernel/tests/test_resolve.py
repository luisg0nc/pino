"""How an LCSC number becomes a KiCad part: an explicit row, else a rule on jlcsearch's category and package."""

import pytest

from pino_kernel.parts.model import PartInfo
from pino_kernel.parts.resolve import (MAP, NoMapping, PartNotCached, category, load_map, needs, prefetch_numbers,
                                       resolve)


def info(lcsc, description, package="0603", mfr="MFR-1"):
    return PartInfo(lcsc, mfr, package, description, 1000, 0.01, "basic", None, "2026-11-26T05:00:00+00:00")


RES = "-55℃~+155℃ 100mW 10kΩ 75V Thick Film Resistor ±1% ±100ppm/℃ 0603 Chip Resistor - Surface Mount ROHS"
CAP = "100nF 50V X7R ±10% 0603 Multilayer Ceramic Capacitors MLCC - SMD/SMT ROHS"
LED = "1.8V~2.4V 120° 20mA 300mcd 615nm~630nm Discrete Diode Red Water Clear 0603 LED Indication - Discrete ROHS"


@pytest.mark.parametrize("description,package,symbol,footprint,value", [
    (RES, "0603", "Device:R", "Resistor_SMD:R_0603_1608Metric", "10k"),
    ("62.5mW 5.1kΩ 0402 Chip Resistor - Surface Mount", "0402", "Device:R", "Resistor_SMD:R_0402_1005Metric", "5.1k"),
    ("1.5MΩ 1206 Chip Resistor - Surface Mount", "1206", "Device:R", "Resistor_SMD:R_1206_3216Metric", "1.5M"),
    ("0Ω 0805 Chip Resistor - Surface Mount", "0805", "Device:R", "Resistor_SMD:R_0805_2012Metric", "0"),
    (CAP, "0603", "Device:C", "Capacitor_SMD:C_0603_1608Metric", "100nF"),
    ("4.7µF 16V X5R 0805 Multilayer Ceramic Capacitors MLCC - SMD/SMT", "0805", "Device:C",
     "Capacitor_SMD:C_0805_2012Metric", "4.7uF"),
    (LED, "0603", "Device:LED", "LED_SMD:LED_0603_1608Metric", "red"),
])
def test_passive_by_category_and_package(parts_cache, description, package, symbol, footprint, value):
    parts_cache.put_stock(info("C900001", description, package))
    r = resolve("C900001", parts_cache)
    assert (r.how, r.symbol, r.footprint, r.value) == ("kicad-rule", symbol, footprint, value)
    assert r.lcsc == "C900001" and r.notes == []


@pytest.mark.parametrize("description,package", [
    ("10kΩ 4 62.5mW 8 ±5% 0603x4 Resistor Networks, Arrays ROHS", "0603x4"),
    ("10kΩ 0603x4 Resistor Networks, Arrays ROHS", "0603"),
    ("RGB 0603 LED Indication - Discrete", "0603"),
    ("Red,Green Bi-color 0603 LED Indication - Discrete", "0603"),
    ("3.3V 500mA Linear Voltage Regulator (LDO) SOT-23-5", "SOT-23-5"),
    ("10uF 16V Tantalum Capacitors 1206", "1206"),
    (RES, "2512"),
])
def test_anything_else_has_no_mapping(parts_cache, description, package):
    parts_cache.put_stock(info("C900002", description, package))
    with pytest.raises(NoMapping) as e:
        resolve("C900002", parts_cache)
    assert e.value.lcsc == "C900002" and package in e.value.reason


def test_category():
    assert [category(d) for d in (RES, CAP, LED, "a microcontroller")] == ["R", "C", "LED", None]


def test_a_row_for_the_number_wins_and_needs_no_lookup(parts_cache, tmp_path):
    table = tmp_path / "map.csv"
    table.write_text("match,symbol,footprint,checked\nC6186,Regulator_Linear:AMS1117-3.3,Package_TO_SOT_SMD:SOT-223-3_TabPin2,2026-11-26\n")
    rows = load_map(table)
    r = resolve("C6186", parts_cache, rows)
    assert (r.how, r.symbol, r.footprint, r.value) == (
        "kicad-map", "Regulator_Linear:AMS1117-3.3", "Package_TO_SOT_SMD:SOT-223-3_TabPin2", "")
    assert needs("C6186", parts_cache, rows) is None


def test_not_cached_names_the_number(parts_cache):
    with pytest.raises(PartNotCached) as e:
        resolve("C900009", parts_cache)
    assert e.value.lcsc == "C900009" and needs("C900009", parts_cache) == "lookup"


def test_a_number_jlc_does_not_have_is_no_mapping(parts_cache):
    parts_cache.put_unknown("C99999999")
    with pytest.raises(NoMapping, match="JLC has no part"):
        resolve("C99999999", parts_cache)
    assert needs("C99999999", parts_cache) is None


def test_old_cache_entries_still_resolve(parts_cache):
    parts_cache.put_stock(PartInfo("C900001", "m", "0603", RES, 1, 0.1, "basic", None, "2025-01-01T00:00:00+00:00"))
    assert resolve("C900001", parts_cache).symbol == "Device:R" and needs("C900001", parts_cache) is None


def test_prefetch_numbers():
    src = ('u.path("U1", lcsc="C900002")\nr.shunt("R1", lcsc=\'900001\', hand_fit=True)\nu.path("U2", lcsc="C900002")\n'
           'x.path("U3", lcsc="not one")\ny = "C123"\n')
    assert prefetch_numbers(src) == ["C900002", "C900001"]


@pytest.mark.kicad_libs
def test_the_shipped_map_reads(real_libs):
    from pino_kernel.pcb.footprint import FootprintLibrary
    from pino_kernel.symbols import SymbolLibrary

    rows = load_map(MAP)
    assert len(rows) == 11 and all(r.checked == "2026-11-26" for r in rows)
    symbols, footprints = SymbolLibrary(real_libs.symbols), FootprintLibrary(real_libs)
    for row in rows:
        sym, fp = symbols.load(row.symbol), footprints.load(row.footprint)
        pads = {p.number: p for p in fp.pads if p.number}
        assert {p.number for p in sym.pins} == set(pads) == {"1", "2"}, row
        assert pads["1"].x < 0 < pads["2"].x, row                      # pin 1 on the left, as the rules assume
    led = symbols.load("Device:LED")
    assert [(p.number, p.name) for p in led.pins] == [("1", "K"), ("2", "A")]
