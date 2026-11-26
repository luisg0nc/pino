from pino_kernel.coords import from_kicad, to_kicad


def test_round_trip_and_y_flip():
    assert to_kicad(0, 0) == (100.0, 100.0)
    assert to_kicad(3, 4) == (103.0, 96.0)
    assert from_kicad(*to_kicad(-7.5, 2.25)) == (-7.5, 2.25)
