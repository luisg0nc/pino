"""Release versions: 1.0.0 first, then minor for a circuit change and patch for a layout change."""

import copy
import json

import pytest

from helpers import small_board
from pino_kernel.release.versions import (FIRST_VERSION, bump, circuit_changes, circuit_fingerprint, circuit_summary,
                                          fab_fingerprint, manifests, next_version, parse)


def circuit():
    c = small_board().to_circuit()
    c.part("R1").lcsc = "C900001"
    return c


def with_value(c, ref, value):
    c = copy.deepcopy(c)
    c.part(ref).value = value
    return c


def renamed_net(c):
    c = copy.deepcopy(c)
    next(n for n in c.nets if n.name == "STATUS").name = "LED_CTRL"
    return c


def test_parse_and_bump():
    assert parse("1.2.3") == (1, 2, 3) and bump("1.2.3", "patch") == "1.2.4"
    assert bump("1.2.3", "minor") == "1.3.0" and bump("1.2.3", "major") == "2.0.0"
    for bad in ("1.2", "v1.2.3", "1.2.x", "1.2.3.4", "01.2.3"):
        with pytest.raises(ValueError):
            parse(bad)


def test_versions():
    assert FIRST_VERSION == "1.0.0"
    assert next_version(None, "c", "f", None) == ("1.0.0", None, ["first release"])
    assert next_version(None, "c", "f", "major")[0] == "1.0.0"
    last = {"version": "1.2.0", "circuit_fingerprint": "c", "fab_fingerprint": "f"}
    assert next_version(last, "c", "f", None) == (None, None, ["the same files as v1.2.0"])
    assert next_version(last, "c", "f", "major")[0] is None
    assert next_version(last, "c", "g", None) == ("1.2.1", "patch", ["the same circuit, new layout"])
    assert next_version(last, "d", "g", None, changes=["R1 added"]) == ("1.3.0", "minor", ["R1 added"])
    assert next_version(last, "c", "g", "major")[:2] == ("2.0.0", "major")


def test_net_rename_is_not_a_circuit_change(fixture_libs):
    c = circuit()
    assert circuit_fingerprint(circuit_summary(renamed_net(c))) == circuit_fingerprint(circuit_summary(c))
    assert circuit_changes(circuit_summary(c), circuit_summary(renamed_net(c))) == []


def test_summary_holds_what_the_fab_builds(fixture_libs):
    s = circuit_summary(circuit())
    assert s["parts"]["R1"] == ["10k", "pino_test:R_0603", "C900001", False, False]
    assert ["R1.1", "U2.2"] in s["nets"] or any("R1.1" in n for n in s["nets"])
    assert s["nets"] == sorted(s["nets"]) and json.loads(json.dumps(s)) == s


def test_changes_in_words(fixture_libs):
    c = circuit()
    old = circuit_summary(c)
    assert circuit_changes(old, circuit_summary(with_value(c, "R1", "4.7k"))) == ["R1 value 10k -> 4.7k"]
    changed = copy.deepcopy(c)
    changed.part("R1").lcsc = "C900009"
    changed.part("C1").dnp = True
    changed.part("C2").hand_fit = True
    got = circuit_changes(old, circuit_summary(changed))
    assert got == ["C1 now not fitted", "C2 now soldered by hand", "R1 LCSC C900001 -> C900009"]
    fewer = copy.deepcopy(c)
    fewer.parts = [p for p in fewer.parts if p.ref != "D1"]
    for n in fewer.nets:
        n.pins = [p for p in n.pins if p.ref != "D1"]
    assert "D1 removed" in circuit_changes(old, circuit_summary(fewer))
    assert "D1 added" in circuit_changes(circuit_summary(fewer), old)


def test_a_moved_pin_is_named(fixture_libs):
    c = circuit()
    moved = copy.deepcopy(c)
    by = {n.name: n for n in moved.nets}
    pin = next(p for p in by["STATUS"].pins if p.ref == "R1")
    by["STATUS"].pins.remove(pin)
    by["GND"].pins.append(pin)
    got = circuit_changes(circuit_summary(c), circuit_summary(moved))
    assert any(line.startswith("R1.1 joins the net of ") for line in got), got


def test_changes_are_capped(fixture_libs):
    old = {"parts": {f"R{i}": ["1k", "f", "", False, False] for i in range(30)}, "nets": []}
    new = {"parts": {f"R{i}": ["2k", "f", "", False, False] for i in range(30)}, "nets": []}
    got = circuit_changes(old, new)
    assert len(got) == 21 and got[-1] == "and 10 more" and got[0] == "R0 value 1k -> 2k" and got[2] == "R2 value 1k -> 2k"


def test_fab_fingerprint_ignores_order():
    assert fab_fingerprint({"a": b"1", "b": b"2"}) == fab_fingerprint({"b": b"2", "a": b"1"})
    assert fab_fingerprint({"a": b"1"}) != fab_fingerprint({"a": b"2"}) != fab_fingerprint({"b": b"2"})


def test_manifests_newest_first_and_only_readable_ones(tmp_path):
    for version, body in (("1.0.0", None), ("1.10.0", None), ("1.9.0", None), ("2.0.0", "not json"),
                          ("3.0.0", '{"schema": "else"}')):
        d = tmp_path / "fab" / f"v{version}"
        d.mkdir(parents=True)
        (d / "manifest.json").write_text(body or json.dumps({"schema": "pino.fab/1", "version": version}))
    (tmp_path / "fab" / "v4.0.0").mkdir()
    assert [m["version"] for m in manifests(tmp_path)] == ["1.10.0", "1.9.0", "1.0.0"]
    assert manifests(tmp_path / "none") == []
