from pino_kernel.findings import At, Finding
from pino_kernel.result import (MAX_FINDINGS, BuildResult, Timing, cap_changes, headline, sort_and_cap)


def test_headline_ok_and_failed():
    counts = {"errors": 0, "warnings": 2, "unrouted": 18}
    assert headline(4, "ok", counts, None) == "On h4: 0 errors, 2 warnings, 18 unrouted"
    assert headline(4, "errors", {"errors": 1, "warnings": 1, "unrouted": 0}, None) == "On h4: 1 error, 1 warning"
    assert headline(4, "failed", {}, "board.py failed at line 12: NameError: name 'x' is not defined") == \
        "On h4: board.py failed at line 12: NameError: name 'x' is not defined"
    assert len(headline(4, "failed", {}, "x" * 500)) == 160


def test_sort_and_cap():
    found = [Finding("b", "c", "info", "i")] + [Finding("a", "c", "warning", f"w{i:03d}") for i in range(250)] + \
            [Finding("z", "c", "error", "e" * 400)]
    kept, truncated = sort_and_cap(found)
    assert len(kept) == MAX_FINDINGS and truncated == 52
    assert kept[0].severity == "error" and len(kept[0].message) == 300 and kept[0].message.endswith("…")


def test_cap_changes():
    out = cap_changes({"circuit": [f"line {i}" for i in range(60)], "layout": []})
    assert len(out["circuit"]) == 50 and out["circuit"][-1] == "and 11 more"


def test_round_trip():
    r = BuildResult("pino.build/1", "0.1.0", None, 3, "0123456789ab", "ok", "On h3: 0 errors, 0 warnings",
                    {"errors": 0}, [Finding("fit", "x", "error", "m", At("board", 1.0, 2.0))], 0, {"board": "b"},
                    [Timing("hash", 0.01), Timing("place", 0.2, True)], {"circuit": [], "layout": []},
                    None, ["routing: not started"], True)
    assert BuildResult.from_json(r.to_json()).to_json() == r.to_json()


def test_round_trip_with_routing():
    routing = {"state": "stale", "key": "0123456789ab", "route": ".pino/routes/ba9876543210", "route_key": "ba9876543210",
               "number": 2, "stale_because": ["parts moved"], "complete": None, "unrouted": None, "router_share": None,
               "router_seconds": None, "drc_errors": None, "copper_errors": None, "verdict": None}
    r = BuildResult("pino.build/1", "0.2.0", None, 3, "0123456789ab", "ok", "On h3: 0 errors, 0 warnings",
                    {}, [], 0, {}, [], {"circuit": [], "layout": []}, None, [], False, routing)
    assert BuildResult.from_json(r.to_json()).routing == routing
