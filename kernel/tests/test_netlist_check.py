from helpers import FIXTURES, usb_circuit
from pino_kernel.checks.netlist import compare, net_names, read_netlist

FIX = FIXTURES / "netlist"


def test_matching_netlist_passes():
    c = usb_circuit()
    assert compare(c, read_netlist(FIX / "ok.xml")) == [] and net_names(c, read_netlist(FIX / "ok.xml")) == []


def test_renamed_net_still_matches():
    assert compare(usb_circuit(), read_netlist(FIX / "renamed.xml")) == []


def test_right_names_wrong_pins_fail():
    # lesson from an earlier board: "a check that matches nets by label name passed a wrong join once"
    found = compare(usb_circuit(), read_netlist(FIX / "swapped.xml"))
    assert any(f.code == "netlist_mismatch" and "CC1" in f.message for f in found)
    assert any("USB_DP" in f.message for f in found) and all(f.severity == "error" for f in found)


def test_exported_names_are_checked_apart():
    c, n = usb_circuit(), read_netlist(FIX / "unnamed.xml")
    assert compare(c, n) == []
    assert [f.message for f in net_names(c, n)] == ["net CC1 exports as Net-(R1-Pad1)"]
    assert net_names(c, n)[0].severity == "warning"


def test_a_part_missing_from_the_netlist():
    c = usb_circuit()
    n = read_netlist(FIX / "ok.xml"); del n.comps["R2"]
    assert any(f.message == "part R2 is only in board.py" for f in compare(c, n))
