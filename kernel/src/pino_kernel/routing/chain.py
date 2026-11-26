"""The router chain: one KiCadRoutingTools script per step, each step's output the next step's input.

    planes <net>         route_planes.py                 (planes first, KRT's own order)
    fanout <ref>         qfn_fanout.py                   (per four-sided fine-pitch part)
    pair <name>          route_diff.py                   (per declared differential pair)
    signals              route.py                        (every other net with two or more pads)
    planes repair        route_disconnected_planes.py
    hint <net> (board.py line <n>)  route.py             (board.py's route hints, in order)

Each step works in `work/<NN>-<slug>/`: `in.kicad_pcb` (the last output plus this step's router items),
`in.kicad_pro` (pino's project file) and `out.kicad_pcb`. A failed step is skipped (its input goes on); a
timeout or a cancel stops the chain.
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Mapping, Sequence

from ..geometry import Point
from ..sexpr import num
from .krt import Krt, run
from .plan import ROUTER_PREFIX, RoutePlan, RouterKeepout, add_router_items, fab_overrides_text, region_keepouts, \
    strip_router_items

Events = Callable[[dict], None]
NET_LINE = re.compile(r"^\[(\d+)/(\d+)\] Routing (.+?)( \(id=\d+\))?$")
LOG_EVERY = 0.5  # s
LOG_CHARS = 300


@dataclass
class ChainStep:
    name: str
    script: str
    args: list[str]  # with the placeholders {IN}, {OUT}, {FAB}
    keepouts: list[RouterKeepout] = field(default_factory=list)
    corridor: list[Point] | None = None
    takes_followups: bool = False  # the signals step: pair nets a pair step left single-ended join its --nets


@dataclass
class StepRun:
    step: str
    script: str
    seconds: float
    returncode: int
    routed: int
    failed: list[str]
    note: str
    folder: str = ""

    def to_json(self) -> dict:
        d = asdict(self)
        d["seconds"] = round(self.seconds, 3)
        return d

    @staticmethod
    def from_json(d: dict) -> "StepRun":
        return StepRun(d["step"], d["script"], float(d["seconds"]), int(d["returncode"]), int(d["routed"]),
                       list(d["failed"]), d["note"], d.get("folder", ""))


@dataclass
class ChainResult:
    board_text: str
    steps: list[StepRun]
    seconds: float
    stopped: str | None  # None | cancelled | timed_out


def _n(v: float) -> str:
    return str(num(v))


def _rule_flags(plan: RoutePlan) -> list[str]:
    r = plan.rules
    return ["--via-size", _n(r.via_diameter), "--via-drill", _n(r.via_drill), "--clearance", _n(r.clearance),
            "--board-edge-clearance", _n(r.edge_clearance), "--grid-step", _n(plan.grid_step)]


def _opt(krt: Krt, script: str, *words: str) -> list[str]:
    """The flag (and its values) when the installed script lists it in its --help."""
    return list(words) if words[0] in krt.flags.get(script, frozenset()) else []


def _fn(krt: Krt, script: str) -> list[str]:
    return _opt(krt, script, "--fab-overrides", "{FAB}") + _opt(krt, script, "--no-fix-drc-settings")


def chain_steps(plan: RoutePlan, krt: Krt) -> list[ChainStep]:
    r = plan.rules
    R = _rule_flags(plan)
    steps = []
    for p in plan.planes:
        s = "route_planes.py"
        steps.append(ChainStep(f"planes {p.net}", s, ["{IN}", "{OUT}", "--nets", p.net, "--plane-layers", *p.layers,
                                                      "--track-width", _n(r.track_width), "--hole-to-hole-clearance",
                                                      _n(r.hole_to_hole), *R, *_fn(krt, s)]))
    for f in plan.fanout:
        s = "qfn_fanout.py"
        steps.append(ChainStep(f"fanout {f.ref}", s, ["{IN}", "-o", "{OUT}", "-c", f.ref, "--width", _n(f.width),
                                                      "--clearance", _n(f.clearance), "--via-size", _n(r.via_diameter),
                                                      "--via-drill", _n(r.via_drill), "--board-edge-clearance",
                                                      _n(r.edge_clearance), "--grid-step", _n(plan.grid_step),
                                                      *_opt(krt, s, "--fab-overrides", "{FAB}")]))
    for p in plan.pairs:
        s = "route_diff.py"
        steps.append(ChainStep(f"pair {p.name}", s, ["{IN}", "{OUT}", "--nets", p.positive, p.negative,
                                                     "--track-width", _n(p.width), "--diff-pair-gap", _n(p.gap),
                                                     "--no-gnd-vias", *R, *_fn(krt, s)]))
    if plan.signals or plan.pairs:
        s = "route.py"
        power = []
        if plan.power:
            power = ["--power-nets", *[p.net for p in plan.power], "--power-nets-widths",
                     *[_n(p.width) for p in plan.power]]
        steps.append(ChainStep("signals", s, ["{IN}", "{OUT}", "--nets", *plan.signals, "--track-width",
                                              _n(r.track_width), "--hole-to-hole-clearance", _n(r.hole_to_hole),
                                              *power, *R, *_fn(krt, s)], takes_followups=True))
    if plan.planes:
        s = "route_disconnected_planes.py"
        layers = [n for n in plan.layers if any(n in p.layers for p in plan.planes)]
        steps.append(ChainStep("planes repair", s, ["{IN}", "{OUT}", "--nets", *[p.net for p in plan.planes],
                                                    "--plane-layers", *layers, *R, *_fn(krt, s)]))
    return steps


def hint_steps(plan: RoutePlan, krt: Krt, board_box) -> list[ChainStep]:
    widths = {p.net: p.width for p in plan.power}
    R = _rule_flags(plan)
    s = "route.py"
    out = []
    for h in plan.hints:
        args = ["{IN}", "{OUT}", "--nets", h.net, "--track-width", _n(widths.get(h.net, plan.rules.track_width))]
        if h.layers:
            args += ["--layers", *h.layers]
        if h.rip:
            args += ["--rip-existing-nets", *h.rip]
        if h.corridor:
            args += ["--guide-corridor"]
        args += [*R, *_fn(krt, s)]
        keep = region_keepouts(h.region, board_box, plan.layers) if h.region else []
        where = f" (board.py line {h.line})" if h.line else ""
        out.append(ChainStep(f"hint {h.net}{where}", s, args, keep, h.corridor))
    return out


def _nets_of(args: Sequence[str]) -> list[str]:
    i = args.index("--nets") + 1
    out = []
    while i < len(args) and not args[i].startswith("--"):
        out.append(args[i])
        i += 1
    return out


def _with_nets(args: Sequence[str], extra: Sequence[str]) -> list[str]:
    """`args` with --nets holding its nets and `extra`, sorted, each once."""
    i = list(args).index("--nets") + 1
    j = i
    while j < len(args) and not args[j].startswith("--"):
        j += 1
    nets = sorted(set(args[i:j]) | set(extra))
    return [*args[:i], *nets, *args[j:]]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "step"


def run_steps(krt: Krt, steps: Sequence[ChainStep], board_text: str, pro_text: str, work: Path, *, plan: RoutePlan,
              env: Mapping[str, str], step_timeout: float, deadline: float, cancel: threading.Event, events: Events,
              index0: int = 0, total: int | None = None) -> ChainResult:
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    fab = work / "fab-overrides.txt"
    fab.write_text(fab_overrides_text(plan.rules), encoding="utf-8")
    start = time.monotonic()
    current = add_router_items(board_text, plan.keepouts)
    runs: list[StepRun] = []
    stopped = None
    of = total if total is not None else index0 + len(steps)
    followups: list[str] = []  # pair nets a pair step left for single-ended routing
    for i, step in enumerate(steps):
        if step.takes_followups and followups:
            step = ChainStep(step.name, step.script, _with_nets(step.args, followups), step.keepouts, step.corridor,
                             True)
        if step.takes_followups and not _nets_of(step.args):
            runs.append(StepRun(step.name, step.script, 0.0, 0, 0, [], "nothing left to route, skipped", ""))
            continue
        index = index0 + i + 1
        folder = f"{index:02d}-{_slug(step.name)}"
        d = work / folder
        d.mkdir(parents=True, exist_ok=True)
        src, out = d / "in.kicad_pcb", d / "out.kicad_pcb"
        src.write_text(add_router_items(current, step.keepouts, step.corridor) if (step.keepouts or step.corridor)
                       else current, encoding="utf-8")
        (d / "in.kicad_pro").write_text(pro_text, encoding="utf-8")
        if out.exists():
            out.unlink()
        left = deadline - time.monotonic()
        if cancel.is_set():
            stopped = "cancelled"
            break
        if left <= 0:
            stopped = "timed_out"
            break
        events({"event": "step", "step": step.name, "index": index, "of": of})
        last_log = [0.0]
        log_file = open(d / "log.txt", "w", encoding="utf-8")

        def on_line(line: str, _name=step.name) -> None:
            log_file.write(line + "\n")
            m = NET_LINE.match(line.strip())
            if m:
                events({"event": "net", "step": _name, "index": int(m.group(1)), "of": int(m.group(2)),
                        "net": m.group(3)})
            now = time.monotonic()
            if line.strip() and now - last_log[0] >= LOG_EVERY:
                last_log[0] = now
                events({"event": "log", "step": _name, "line": line[:LOG_CHARS]})

        args = [a.replace("{IN}", str(src)).replace("{OUT}", str(out)).replace("{FAB}", str(fab)) for a in step.args]
        try:
            r = run(krt, step.name, step.script, args, cwd=d, env=env, timeout=min(step_timeout, left),
                    on_line=on_line, cancel=cancel)
        finally:
            log_file.close()
        summary = r.summary or {}
        note = ""
        if r.returncode == -15:
            note, stopped = "cancelled", "cancelled"
        elif r.returncode == -9:
            note, stopped = f"timed out after {min(step_timeout, left):g} s", "timed_out"
        elif r.returncode != 0 or not out.exists():
            why = r.last_line() or f"exit code {r.returncode}"
            note = f"failed, skipped: {why[:200]}" if r.returncode != 0 else f"no output, skipped: {why[:200]}"
        else:
            current = strip_router_items(out.read_text(encoding="utf-8"), prefix=ROUTER_PREFIX + "region:")
        if note:
            with open(d / "log.txt", "a", encoding="utf-8") as fh:
                fh.write(f"pino: {step.script} {note}\n")
        if step.script == "route_diff.py" and r.returncode not in (-9, -15):
            if note:
                followups += _nets_of(step.args)
            else:
                followups += [str(n) for n in summary.get("single_ended_followup_nets", []) or []]
        run_ = StepRun(step.name, step.script, r.seconds, r.returncode, int(summary.get("successful", 0) or 0),
                       [str(n) for n in summary.get("failed_single", []) or []], note, folder)
        runs.append(run_)
        events({"event": "step_done", "step": step.name, "seconds": round(r.seconds, 3), "returncode": r.returncode,
                "routed": run_.routed, "failed": run_.failed})
        if stopped:
            break
    return ChainResult(strip_router_items(current), runs, time.monotonic() - start, stopped)
