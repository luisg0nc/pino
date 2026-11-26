from pino_kernel import fab


def test_jlc_profiles():
    assert fab.for_layers(2) is fab.jlc_standard_2layer and fab.for_layers(4) is fab.jlc_standard_4layer
    assert set(fab.PROFILES) == {"jlc-standard-2layer", "jlc-standard-4layer"}
    assert fab.jlc_standard_2layer.board_thickness == 1.6 and fab.jlc_standard_4layer.copper_oz == 1.0


def test_jlc_2layer_limits_from_the_page():
    p = fab.jlc_standard_2layer
    assert (p.min_track, p.min_clearance, p.min_via_drill, p.min_via_diameter) == (0.10, 0.10, 0.2, 0.45)
    assert (p.min_annular, p.min_pth_annular, p.copper_to_edge, p.pad_to_pad) == (0.125, 0.18, 0.2, 0.15)
    assert (p.min_hole, p.min_npth, p.hole_to_hole, p.pad_hole_to_hole) == (0.2, 0.5, 0.2, 0.45)
    assert (p.via_hole_to_track, p.pth_to_track, p.heavy_track) == (0.2, 0.28, 0.16)
    assert (p.silk_min_width, p.silk_min_text_height, p.silk_to_pad) == (0.15, 1.0, 0.15)
    assert p.thicknesses == (0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0) and p.copper_options == (1.0, 2.0, 2.5, 3.5, 4.5)
    assert p.inner_copper_oz is None and p.title == "JLC standard 2-layer"
    assert p.assembly.sides == 1 and p.assembly.min_board == (10.0, 10.0) and p.read_on == "2026-11-26"
    assert p.assembly.max_board == (470.0, 500.0) and p.assembly.thickness == (0.8, 1.6)
    assert (p.assembly.smallest, p.assembly.min_pitch) == ("0402", 0.4)
    assert p.source == "https://jlcpcb.com/capabilities/pcb-capabilities"


def test_jlc_4layer_limits_from_the_page():
    p = fab.jlc_standard_4layer
    assert (p.min_track, p.min_pth_annular, p.inner_copper_oz, p.copper_options) == (0.09, 0.15, 0.5, (1.0, 2.0))
    assert (p.min_clearance, p.heavy_track, p.title) == (0.09, 0.15, "JLC standard 4-layer")


def test_profile_json_round_trips_and_has_every_field():
    import json
    from dataclasses import fields

    d = fab.jlc_standard_2layer.to_json()
    assert d["assembly"]["kind"] == "economic" and d["thicknesses"][-1] == 2.0 and d["title"] == "JLC standard 2-layer"
    assert set(d) == {f.name for f in fields(fab.FabProfile)} and d["assembly"]["min_board"] == [10.0, 10.0]
    assert json.loads(json.dumps(d)) == d


def test_the_docstring_dates_the_values():
    assert "2026-11-26" in fab.__doc__ and "placeholder" not in fab.__doc__
    assert "https://jlcpcb.com/capabilities/pcb-assembly-capabilities" in fab.__doc__
