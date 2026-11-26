import json

from pino_kernel.normalize import normalize


def test_svg_title_loses_its_date(tmp_path):
    f = tmp_path / "a.svg"
    f.write_text('<svg>\n<title>SVG Image created as board-F_Cu.svg date 2026-11-26T04:36:50 </title>\n</svg>\n')
    normalize(f)
    assert "<title>SVG Image created as board-F_Cu.svg</title>" in f.read_text()


def test_reports_lose_date(tmp_path):
    f = tmp_path / "drc.json"
    f.write_text(json.dumps({"date": "2026-11-26T04:36:50", "source": "board.kicad_pcb", "violations": []}))
    normalize(f)
    assert "date" not in json.loads(f.read_text()) and json.loads(f.read_text())["source"] == "board.kicad_pcb"


def test_netlist_loses_date_and_path(tmp_path):
    f = tmp_path / "netlist.xml"
    f.write_text("<export>\n  <design>\n    <source>/somewhere/x.tmp-1/board.kicad_sch</source>\n    <date>2026-11-26T04:36:50</date>\n"
                 "  </design>\n</export>\n")
    normalize(f)
    assert "<source>board.kicad_sch</source>" in f.read_text() and "<date></date>" in f.read_text()


def test_glb_loses_its_time_and_keeps_its_size(tmp_path):
    f = tmp_path / "board.glb"
    body = b'{"asset":{"extras":{"generated_at":"2026-11-26T04:36:51"}}}'
    f.write_bytes(b"glTF" + body)
    normalize(f)
    out = f.read_bytes()
    assert b"2026-11-26" not in out and len(out) == 4 + len(body)


def test_unconnected_items_keep_only_positions_in_a_fixed_order(tmp_path):
    def report(pad):
        return {"unconnected_items": [
            {"type": "unconnected_items", "severity": "error", "description": "Missing connection between items",
             "items": [{"description": f"Pad {pad} [GND] of J1 on F.Cu", "pos": {"x": 2, "y": 1}, "uuid": pad},
                       {"description": "Pad 2 [GND] of C1 on F.Cu", "pos": {"x": 1, "y": 1}, "uuid": "c"}]},
            {"type": "unconnected_items", "severity": "error", "description": "Missing connection between items",
             "items": [{"description": "x", "pos": {"x": 0, "y": 0}, "uuid": "d"}]}]}
    a, b = tmp_path / "a.json", tmp_path / "b.json"
    a.write_text(json.dumps(report("A1"))); b.write_text(json.dumps(report("B12")))
    normalize(a); normalize(b)
    assert a.read_text() == b.read_text() and len(json.loads(a.read_text())["unconnected_items"]) == 2
