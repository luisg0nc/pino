from pino_kernel import fab


def test_jlc_profiles():
    assert fab.for_layers(2) is fab.jlc_standard_2layer and fab.for_layers(4) is fab.jlc_standard_4layer
    assert (fab.jlc_standard_2layer.min_track, fab.jlc_standard_2layer.min_clearance) == (0.15, 0.15)
    assert (fab.jlc_standard_4layer.min_track, fab.jlc_standard_4layer.min_clearance) == (0.1, 0.1)
    assert set(fab.PROFILES) == {"jlc-standard-2layer", "jlc-standard-4layer"}
    assert fab.jlc_standard_2layer.board_thickness == 1.6 and fab.jlc_standard_4layer.copper_oz == 1.0
