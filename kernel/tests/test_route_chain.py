import dataclasses
import os
import threading
import time

from copper_boards import R0603, board, fp
from pino_kernel.circuit import RouteHint
from pino_kernel.pcb.copper import read_copper
from pino_kernel.routing.chain import chain_steps, hint_steps, run_steps
from pino_kernel.routing.krt import FORBIDDEN_FLAGS, locate
from pino_kernel.routing.plan import board_box, plan_route
from route_cases import DRU_2L, PRO_2L, USB_PAIR, board_with_gnd_zone_and_usb, board_with_mounting_holes

BOARD4 = board_with_gnd_zone_and_usb(4)
TWO_SIGNALS_BOARD = board(footprints=[fp("R1", (-5, 0, 0), R0603, nets={"1": "A", "2": "B"}),
                                      fp("R2", (5, 0, 0), R0603, nets={"1": "A", "2": "B"})])


def clean_env():
    env = {"PATH": os.environ["PATH"], "PYTHONHASHSEED": "0"}
    env.update({k: v for k, v in os.environ.items() if k.startswith("FAKE_KRT_")})
    return env


def run_chain_for(text, work, *, step_timeout=30.0, events=None, cancel=None, krt=None, pairs=(), hints=()):
    krt = krt or locate()
    plan = plan_route(text, PRO_2L, DRU_2L, pairs=list(pairs), hints=list(hints))
    steps = chain_steps(plan, krt) + hint_steps(plan, krt, board_box(text))
    return run_steps(krt, steps, text, PRO_2L, work, plan=plan, env=clean_env(), step_timeout=step_timeout,
                     deadline=time.monotonic() + 60, cancel=cancel or threading.Event(),
                     events=events or (lambda e: None))


def step_dir(r, name):
    return next(s.folder for s in r.steps if s.step == name)


def test_chain_order_and_arguments(fake_krt, tmp_path, argv_log):
    run_chain_for(BOARD4, tmp_path / "work", pairs=[USB_PAIR])
    calls = argv_log()
    assert [c["script"] for c in calls] == ["route_planes.py", "qfn_fanout.py", "route_diff.py", "route.py",
                                            "route_disconnected_planes.py"]
    sig = calls[3]["argv"]
    assert "--no-fix-drc-settings" in sig and sig[sig.index("--fab-overrides") + 1].endswith("fab-overrides.txt")
    assert sig[sig.index("--clearance") + 1] == "0.2" and sig[sig.index("--board-edge-clearance") + 1] == "0.3"
    assert sig[sig.index("--power-nets") + 1:sig.index("--power-nets") + 3] == ["+3V3", "VBUS"]
    assert sig[sig.index("--power-nets-widths") + 1:sig.index("--power-nets-widths") + 3] == ["0.5", "0.5"]
    assert sig[sig.index("--via-size") + 1] == "0.6" and sig[sig.index("--grid-step") + 1] == "0.05"
    pair = calls[2]["argv"]
    assert pair[pair.index("--nets") + 1:pair.index("--nets") + 3] == ["USB_D+", "USB_D-"] and "--no-gnd-vias" in pair
    planes = calls[0]["argv"]
    assert planes[planes.index("--nets") + 1] == "GND" and planes[planes.index("--plane-layers") + 1] == "In1.Cu"
    fan = calls[1]["argv"]
    assert fan[fan.index("-c") + 1] == "U1" and fan[fan.index("-o") + 1].endswith("out.kicad_pcb")
    assert not set(FORBIDDEN_FLAGS) & {a for c in calls for a in c["argv"]}


def test_each_step_feeds_the_next(fake_krt, tmp_path):
    r = run_chain_for(BOARD4, tmp_path / "work", pairs=[USB_PAIR])
    dirs = [tmp_path / "work" / s.folder for s in r.steps]
    for a, b in zip(dirs, dirs[1:]):
        assert (b / "in.kicad_pcb").read_bytes() == (a / "out.kicad_pcb").read_bytes()


def test_pro_file_beside_every_input(fake_krt, tmp_path):
    r = run_chain_for(BOARD4, tmp_path / "work")
    for s in r.steps:
        assert (tmp_path / "work" / s.folder / "in.kicad_pro").read_text() == PRO_2L
    assert (tmp_path / "work" / "fab-overrides.txt").read_text().startswith("track_width = 0.15\n")


def test_flags_the_script_lacks_are_left_out(fake_krt, tmp_path, argv_log):
    krt = locate()
    flags = dict(krt.flags)
    flags["qfn_fanout.py"] = frozenset(f for f in flags["qfn_fanout.py"] if f != "--fab-overrides")
    run_chain_for(BOARD4, tmp_path / "work", krt=dataclasses.replace(krt, flags=flags))
    fan = next(c for c in argv_log() if c["script"] == "qfn_fanout.py")["argv"]
    route = next(c for c in argv_log() if c["script"] == "route.py")["argv"]
    assert "--fab-overrides" not in fan and "--fab-overrides" in route


def test_failed_step_is_skipped_and_the_chain_goes_on(fake_krt, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_MODE", "crash")
    monkeypatch.setenv("FAKE_KRT_CRASH", "route_diff.py")
    r = run_chain_for(BOARD4, tmp_path / "work", pairs=[USB_PAIR])
    s = {x.step: x for x in r.steps}["pair USB_D"]
    assert s.returncode == 1 and "skipped" in s.note and r.stopped is None
    assert {t.net for t in read_copper(r.board_text).tracks} >= {"SDA"}


def test_step_timeout_stops_the_chain(fake_krt, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep")
    r = run_chain_for(TWO_SIGNALS_BOARD, tmp_path / "work", step_timeout=1.0)
    assert r.stopped == "timed_out" and r.seconds < 10 and r.steps[-1].returncode == -9


def test_cancel_stops_the_chain(fake_krt, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep")
    cancel = threading.Event()
    threading.Timer(0.5, cancel.set).start()
    r = run_chain_for(BOARD4, tmp_path / "work", cancel=cancel)
    assert r.stopped == "cancelled" and len(r.steps) == 1 and r.seconds < 10


def test_progress_events(fake_krt, tmp_path):
    events = []
    run_chain_for(TWO_SIGNALS_BOARD, tmp_path / "work", events=events.append)
    assert {"event": "step", "step": "signals", "index": 1, "of": 1} in events
    assert {"event": "net", "step": "signals", "index": 1, "of": 2, "net": "A"} in events
    assert events[-1]["event"] == "step_done" and events[-1]["routed"] == 2


def test_hint_keepouts_live_only_in_their_step(fake_krt, tmp_path):
    text = board_with_mounting_holes()
    r = run_chain_for(text, tmp_path / "work", hints=[RouteHint("SDA", (-5, -5, 5, 5), None, None, [], 3)])
    hint_in = (tmp_path / "work" / step_dir(r, "hint SDA (board.py line 3)") / "in.kicad_pcb").read_text()
    sig_in = (tmp_path / "work" / step_dir(r, "signals") / "in.kicad_pcb").read_text()
    assert "pino-router:region:" in hint_in and "pino-router:hole:H1" in hint_in
    assert "pino-router:region:" not in sig_in and "pino-router:hole:H1" in sig_in
    assert "pino-router:" not in r.board_text


def test_corridor_hint(fake_krt, tmp_path, argv_log):
    r = run_chain_for(TWO_SIGNALS_BOARD, tmp_path / "work", hints=[RouteHint("A", None, None, [(0.0, 0.0), (2.0, 2.0)], [], 7)])
    hint_in = (tmp_path / "work" / step_dir(r, "hint A (board.py line 7)") / "in.kicad_pcb").read_text()
    assert '(layer "User.1")' in hint_in
    assert "--guide-corridor" in [c for c in argv_log() if c["script"] == "route.py"][-1]["argv"]
    assert '(layer "User.1")' not in r.board_text


def test_rip_is_explicit(fake_krt, tmp_path, argv_log):
    run_chain_for(TWO_SIGNALS_BOARD, tmp_path / "work", hints=[RouteHint("A", None, ["B.Cu"], None, ["*"], 7)])
    argv = [c for c in argv_log() if c["script"] == "route.py"][-1]["argv"]
    rip = argv[argv.index("--rip-existing-nets") + 1:]
    assert rip[0] == "B" and "*" not in argv
    assert argv[argv.index("--layers") + 1] == "B.Cu" and argv[argv.index("--nets") + 1] == "A"


def test_pair_left_single_ended_goes_to_the_signals_step(fake_krt, tmp_path, monkeypatch, argv_log):
    monkeypatch.setenv("FAKE_KRT_PAIR_DEFER", "1")
    r = run_chain_for(BOARD4, tmp_path / "work", pairs=[USB_PAIR])
    sig = next(c for c in argv_log() if c["script"] == "route.py")["argv"]
    nets = sig[sig.index("--nets") + 1:sig.index("--track-width")]
    assert {"USB_D+", "USB_D-"} <= set(nets) and nets == sorted(nets)
    assert {t.net for t in read_copper(r.board_text).tracks} >= {"USB_D+", "USB_D-"}


def test_failed_pair_step_goes_single_ended(fake_krt, tmp_path, monkeypatch, argv_log):
    monkeypatch.setenv("FAKE_KRT_MODE", "crash")
    monkeypatch.setenv("FAKE_KRT_CRASH", "route_diff.py")
    run_chain_for(BOARD4, tmp_path / "work", pairs=[USB_PAIR])
    sig = next(c for c in argv_log() if c["script"] == "route.py")["argv"]
    assert {"USB_D+", "USB_D-"} <= set(sig[sig.index("--nets") + 1:sig.index("--track-width")])


def test_only_a_pair_still_gets_a_signals_step(fake_krt, tmp_path, monkeypatch, argv_log):
    monkeypatch.setenv("FAKE_KRT_PAIR_DEFER", "1")
    pair_only = board(footprints=[fp("R1", (-5, 0, 0), R0603, nets={"1": "USB_D+", "2": "USB_D-"}),
                                  fp("R2", (5, 0, 0), R0603, nets={"1": "USB_D+", "2": "USB_D-"})])
    r = run_chain_for(pair_only, tmp_path / "work", pairs=[USB_PAIR])
    assert [s.step for s in r.steps] == ["pair USB_D", "signals"]
    monkeypatch.delenv("FAKE_KRT_PAIR_DEFER")
    r = run_chain_for(pair_only, tmp_path / "work2", pairs=[USB_PAIR])
    assert [s.step for s in r.steps] == ["pair USB_D", "signals"] and "nothing left" in r.steps[1].note
