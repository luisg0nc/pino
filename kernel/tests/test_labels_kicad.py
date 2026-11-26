"""The label step against KiCad's own DRC: turned parts, parts on the back, KiCad's own footprints."""

import pytest

from pino_kernel.build import build

pytestmark = [pytest.mark.kicad_cli, pytest.mark.kicad_libs]

# Parts 3 mm apart, turned every way and on both sides, so most labels must leave their footprint's own spot.
TURNED_BOARD_PY = '''from pino import Board

b = Board("turned", layers=2, outline=(24, 16))
m = b.block("m", "Turned parts")
R0402 = "Resistor_SMD:R_0402_1005Metric"
C0805 = "Capacitor_SMD:C_0805_2012Metric"
LED0603 = "LED_SMD:LED_0603_1608Metric"
parts = [
    m.path("R1", "Device:R", "1k", footprint=R0402),
    m.path("R2", "Device:R", "1k", footprint=R0402),
    m.path("R3", "Device:R", "1k", footprint=R0402),
    m.path("R4", "Device:R", "1k", footprint=R0402),
    m.path("C1", "Device:C", "1uF", footprint=C0805),
    m.path("D1", "Device:LED", "green", footprint=LED0603),
    m.path("R5", "Device:R", "1k", footprint=R0402),
    m.path("C2", "Device:C", "1uF", footprint=C0805),
    m.path("R6", "Device:R", "1k", footprint=R0402),
    m.path("D2", "Device:LED", "red", footprint=LED0603),
]
for i, (a, c) in enumerate(zip(parts, parts[1:])):
    b.net(f"N{i}", a[2], c[1])
b.gnd(parts[0][1], parts[-1][2], external=True)

poses = [((-6, 3), 0, False), ((-3, 3), 90, False), ((0, 3), 180, False), ((3, 3), 270, False),
         ((6.5, 3), 45, False), ((-6, -3), 0, True), ((-3, -3), 90, True), ((0.5, -3), 180, True),
         ((3.5, -3), 270, True), ((6.5, -3), 45, True)]
for p, (at, rot, back) in zip(parts, poses):
    b.place(p, at=at, rot=rot, back=back)
b.label(parts[1], rot=30)
'''


def test_turned_and_back_parts_get_labels_drc_finds_no_fault_with(make_project, real_libs):
    project = make_project(TURNED_BOARD_PY)
    r = build(project)
    assert r.verdict != "failed", r.headline
    assert r.kicad_cli and r.kicad_cli.startswith("10.")
    silk = [f"{f.code}: {f.message}" for f in r.findings if f.source == "drc" and f.code.startswith("silk")]
    assert silk == []
    assert not [f for f in r.findings if f.code == "label_hidden"]
