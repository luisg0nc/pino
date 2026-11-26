import json
import socket
import threading
import time
from datetime import timedelta

import pytest

from pino_kernel.parts.cache import PartsCache, parts_root, utc_now
from pino_kernel.parts.jlcsearch import Jlcsearch, JlcSearchError
from pino_kernel.parts.model import PartInfo, klass_of, normalize_lcsc
from pino_kernel.parts.transport import (OfflineError, RecordedTransport, Response, http_transport, no_network,
                                         recorded_name, transport_from_env)


def test_normalize_lcsc():
    assert normalize_lcsc(" c25804 ") == "C25804" and normalize_lcsc("25804") == "C25804"
    for bad in ("R0603", "", "C", "C0", "C12a"):
        with pytest.raises(ValueError, match="not an LCSC number"):
            normalize_lcsc(bad)


def test_exact_lookup_from_recorded(recorded, parts_cache):
    p = Jlcsearch(RecordedTransport(recorded), parts_cache).part("C25804")
    assert p.klass == "basic" and p.package == "0603" and p.price == 0.0024 and p.stock is None
    assert p.checked_at == "2026-11-03T22:33:32.000Z" and p.mfr == "0603WAF1002T5E" and p.fetched_at
    assert p.to_json()["class"] == "basic" and PartInfo.from_json(p.to_json()) == p


def test_search_with_filters_and_query_order(recorded, parts_cache):
    t = RecordedTransport(recorded)
    found = Jlcsearch(t, parts_cache).search("10k 0603 resistor", basic=True, limit=8)
    assert found and all(p.klass == "basic" for p in found) and not t.misses
    assert t.calls == ["https://jlcsearch.tscircuit.com/api/search?q=10k+0603+resistor&limit=8&is_basic=true"]
    assert parts_cache.fresh(found[0].lcsc) == found[0]          # every part found is cached


def test_base_url_can_be_overridden(parts_cache, monkeypatch):
    monkeypatch.setenv("PINO_JLCSEARCH_URL", "http://example.invalid/")
    t = lambda url, timeout: (_ for _ in ()).throw(OfflineError(url))
    with pytest.raises(JlcSearchError, match="could not be reached.*http://example.invalid/api/search"):
        Jlcsearch(t, parts_cache).search("resistor")


def test_fresh_cache_skips_the_network(recorded, parts_cache):
    t = RecordedTransport(recorded)
    c = Jlcsearch(t, parts_cache)
    c.part("C25804")
    calls = len(t.calls)
    c.part("C25804")
    assert len(t.calls) == calls
    parts_cache.now = lambda: utc_now() + timedelta(hours=25)
    c.part("C25804")
    assert len(t.calls) == calls + 1


def test_cache_layout_and_atomic_writes(recorded, parts_cache):
    Jlcsearch(RecordedTransport(recorded), parts_cache).part("C25804")
    stored = json.loads((parts_cache.root / "stock" / "C25804.json").read_text())
    assert stored["schema"] == "pino.part/1" and stored["lcsc"] == "C25804"
    assert [p.name for p in (parts_cache.root / "stock").iterdir()] == ["C25804.json"]     # no temp file left


def test_a_broken_cache_file_is_not_an_entry(parts_cache):
    (parts_cache.root / "stock").mkdir(parents=True)
    (parts_cache.root / "stock" / "C1.json").write_text('{"schema": "pino.part/1", "lcsc"')
    assert parts_cache.stock("C1") is None


def test_parts_root_is_under_the_pino_cache(tmp_path):
    assert parts_root({"PINO_CACHE_DIR": str(tmp_path)}) == tmp_path / "parts"


def test_class_of_rows():
    assert [klass_of(r) for r in ({"is_basic": True}, {"is_preferred": True}, {})] == ["basic", "preferred", "extended"]


def test_unknown_part_is_none_and_remembered(recorded, parts_cache):
    t = RecordedTransport(recorded)
    c = Jlcsearch(t, parts_cache)
    assert c.part("C99999999") is None and parts_cache.unknown("C99999999") is True
    assert c.part("C99999999") is None and len(t.calls) == 1
    parts_cache.now = lambda: utc_now() + timedelta(hours=7)
    assert parts_cache.unknown("C99999999") is False


def test_only_the_exact_number_is_kept(parts_cache):
    body = {"components": [{"lcsc": 258040, "mfr": "other", "package": "0603", "description": "x", "stock": 5}]}
    t = lambda url, timeout: Response(200, json.dumps(body).encode(), {})
    assert Jlcsearch(t, parts_cache).part("C25804") is None


def test_unavailable_timeout_and_invalid(recorded, parts_cache):
    c = Jlcsearch(RecordedTransport(recorded), parts_cache)
    with pytest.raises(JlcSearchError) as e:
        c.search("RK3576 unavailable")
    assert e.value.code == "unavailable" and "30" in str(e.value)         # its retry-after
    with pytest.raises(JlcSearchError) as e:
        c.search("IC")
    assert e.value.code == "invalid" and "Add another search term" in str(e.value)
    parts_cache.put_stock(PartInfo("C25804", "m", "0603", "d", 10, 0.1, "basic", None, "2026-01-01T00:00:00+00:00"))
    slow = lambda url, t: (_ for _ in ()).throw(OfflineError("timed out"))
    old = Jlcsearch(slow, parts_cache).parts(["C25804"])          # a stale entry is still given, marked
    assert old["C25804"].fresh is False and "timed out" in old["C25804"].error and old["C25804"].info.stock == 10


def test_a_bad_answer_is_an_http_error(parts_cache):
    for response in (Response(200, b"<html>", {}), Response(500, b"boom", {}), Response(200, b'{"components": 3}', {})):
        with pytest.raises(JlcSearchError) as e:
            Jlcsearch(lambda u, t: response, parts_cache).search("resistor")
        assert e.value.code == "http"


def test_parts_looks_up_many_at_once(recorded, parts_cache):
    got = Jlcsearch(RecordedTransport(recorded), parts_cache).parts(["C25804", "C14663", "C99999999", "C25804"])
    assert list(got) == ["C25804", "C14663", "C99999999"]
    assert got["C25804"].fresh and got["C25804"].info.klass == "basic" and got["C99999999"].info is None
    assert got["C99999999"].error is None and got["C99999999"].fresh


def test_budget_is_kept(parts_cache):
    release = threading.Event()

    def sleepy(url, t):
        release.wait(5)
        return Response(200, b'{"components": []}', {})

    t0 = time.monotonic()
    got = Jlcsearch(sleepy, parts_cache).parts([f"C{n}" for n in range(1, 20)], budget=1.0)
    assert time.monotonic() - t0 < 2.5
    assert len(got) == 19 and all(not x.fresh and x.info is None and "in time" in x.error for x in got.values())
    release.set()


def test_offline_env_refuses_the_network(monkeypatch):
    monkeypatch.setenv("PINO_PARTS_OFFLINE", "1")
    with pytest.raises(OfflineError):
        transport_from_env()("https://jlcsearch.tscircuit.com/api/search?q=C1", 1.0)
    assert transport_from_env({}) is http_transport


def test_recorded_env_wins(recorded):
    t = transport_from_env({"PINO_PARTS_RECORDED": str(recorded), "PINO_PARTS_OFFLINE": "1"})
    assert isinstance(t, RecordedTransport)


def test_a_recording_that_is_missing_is_a_404(tmp_path):
    t = RecordedTransport(tmp_path)
    assert t("https://x.invalid/api/search?q=a", 1.0).status == 404 and t.misses == ["https://x.invalid/api/search?q=a"]
    assert recorded_name("https://x.invalid/api/search?q=a").startswith("_api_search-")
    assert recorded_name("https://x.invalid/api/search").endswith("_api_search.json")


def test_limit_checked_before_any_request(parts_cache):
    for limit in (0, 1001):
        with pytest.raises(ValueError):
            Jlcsearch(no_network, parts_cache).search("resistor", limit=limit)


def test_tests_cannot_reach_the_network():
    with pytest.raises(RuntimeError, match="network in a test"):
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(("192.0.2.1", 80))


def test_the_user_agent_names_only_pino(monkeypatch):
    from pino_kernel import __version__
    import urllib.request

    seen = {}

    def fake_open(request, timeout):
        seen.update(request.header_items())
        raise urllib.error.URLError("no")

    monkeypatch.setattr(urllib.request, "urlopen", fake_open)
    with pytest.raises(OfflineError):
        http_transport("https://jlcsearch.tscircuit.com/api/search?q=C1", 1.0)
    assert seen == {"User-agent": f"pino-kernel/{__version__}"}
