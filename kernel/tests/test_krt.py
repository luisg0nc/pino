import json
import os
import subprocess
import sys
import threading
from pathlib import Path

import pytest

from copper_boards import two_net_board
from pino_kernel.routing.krt import (KRT_COMMIT, Krt, RouterMissing, cache_root, check, ensure, install, krt_env,
                                     locate, run)

FAKE_CLI = Path(__file__).resolve().parent / "fake_kicad_cli.py"


def clean_env() -> dict[str, str]:
    return {"PATH": os.environ["PATH"], "PYTHONHASHSEED": "0", "PYTHONDONTWRITEBYTECODE": "1"}


def args(tmp_path):
    return [str(two_net_board(tmp_path)), str(tmp_path / "out.kicad_pcb"), "--nets", "A"]


def fake_kicad(tmp_path):
    from pino_kernel.kicad_cli import KicadCli
    from pino_kernel.libraries import Libraries

    libs = Libraries(tmp_path / "sym", tmp_path / "fp", tmp_path / "3d")
    return KicadCli(libs, tmp_path / "kicad-home", [sys.executable, str(FAKE_CLI)])


def gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


def test_cache_root_order(tmp_path):
    assert cache_root({"PINO_CACHE_DIR": str(tmp_path / "c"), "XDG_CACHE_HOME": "/x", "HOME": "/h"}) == tmp_path / "c"
    assert cache_root({"XDG_CACHE_HOME": str(tmp_path), "HOME": "/h"}) == tmp_path / "pino"
    assert cache_root({"HOME": str(tmp_path)}) == tmp_path / ".cache" / "pino"


def test_override_dir_is_used_and_checked(fake_krt):
    krt = locate()
    assert krt.version == "0.17.7" and check(krt) == []
    assert krt.root == fake_krt.root and krt.commit is None
    assert "--fab-overrides" in krt.flags["route.py"] and "--no-gnd-vias" in krt.flags["route_diff.py"]


def test_other_version_is_refused(fake_krt):
    (fake_krt.root / "VERSION").write_text("0.18.0\n")
    with pytest.raises(RouterMissing) as e:
        locate()
    assert e.value.finding.code == "router_version"
    assert "0.18.0" in e.value.finding.message and "0.17.7" in e.value.finding.message


def test_missing_router_says_how_to_fix(tmp_path):
    with pytest.raises(RouterMissing) as e:
        ensure({"PINO_CACHE_DIR": str(tmp_path)}, allow_install=False)
    assert e.value.finding.code == "router_missing" and "pino-kernel router install" in e.value.finding.message
    assert e.value.finding.source == "router" and e.value.finding.severity == "error"


def test_interrupted_install_is_not_used(tmp_path):
    half = tmp_path / "krt" / (KRT_COMMIT[:12] + ".tmp-999")
    half.mkdir(parents=True)
    (half / "VERSION").write_text("0.17.7")
    nostamp = tmp_path / "krt" / KRT_COMMIT[:12]
    nostamp.mkdir()
    (nostamp / "VERSION").write_text("0.17.7")
    with pytest.raises(RouterMissing):
        locate({"PINO_CACHE_DIR": str(tmp_path)})


def test_stamp_of_another_commit_is_not_used(tmp_path):
    d = tmp_path / "krt" / KRT_COMMIT[:12]
    (d / "src").mkdir(parents=True)
    (d / "src" / "VERSION").write_text("0.17.7")
    (d / "stamp.json").write_text(json.dumps({"commit": "0" * 40, "version": "0.17.7", "deps": [], "flags": {}}))
    with pytest.raises(RouterMissing):
        locate({"PINO_CACHE_DIR": str(tmp_path)})


def test_offline_install_fails_in_plain_words(tmp_path):
    env = {"PINO_CACHE_DIR": str(tmp_path), "PINO_KRT_REPO": str(tmp_path / "no-such-repo"),
           "PATH": os.environ["PATH"], "HOME": str(tmp_path)}
    with pytest.raises(RouterMissing) as e:
        install(env)
    assert e.value.finding.code == "router_missing" and "could not fetch" in e.value.finding.message
    assert "pino-kernel router install" in e.value.finding.message
    assert not list((tmp_path / "krt").glob("*.tmp-*"))
    assert not (tmp_path / "krt" / KRT_COMMIT[:12]).exists()


def test_run_parses_summary_and_streams_lines(fake_krt, tmp_path):
    lines = []
    r = run(locate(), "signals", "route.py", args(tmp_path), cwd=tmp_path, env=clean_env(), timeout=30,
            on_line=lines.append, cancel=threading.Event())
    assert r.returncode == 0 and r.summary["successful"] == 1 and "[1/1] Routing A (id=1)" in lines
    assert r.step == "signals" and (tmp_path / "out.kicad_pcb").exists() and "JSON_SUMMARY" in r.log


def test_timeout_kills_only_the_router_group(fake_krt, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_KRT_MODE", "sleep")
    monkeypatch.setenv("FAKE_KRT_PIDFILE", str(tmp_path / "pid"))
    env = {**clean_env(), "FAKE_KRT_MODE": "sleep", "FAKE_KRT_PIDFILE": str(tmp_path / "pid")}
    r = run(locate(), "signals", "route.py", args(tmp_path), cwd=tmp_path, env=env, timeout=1.0, on_line=print,
            cancel=threading.Event())
    assert r.returncode == -9 and "timed out after 1 s" in r.log and r.seconds < 5
    assert gone(int((tmp_path / "pid").read_text()))


def test_cancel_stops_the_step(fake_krt, tmp_path):
    env = {**clean_env(), "FAKE_KRT_MODE": "sleep", "FAKE_KRT_PIDFILE": str(tmp_path / "pid")}
    cancel = threading.Event()
    threading.Timer(0.5, cancel.set).start()
    r = run(locate(), "signals", "route.py", args(tmp_path), cwd=tmp_path, env=env, timeout=30, on_line=print,
            cancel=cancel)
    assert r.returncode == -15 and "cancelled" in r.log and r.seconds < 5
    assert gone(int((tmp_path / "pid").read_text()))


def test_no_display_and_no_window_flags(fake_krt, tmp_path, monkeypatch):
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.setenv("WAYLAND_DISPLAY", "wayland-0")
    monkeypatch.setenv("FAKE_KRT_MODE", "env")
    lines = []
    run(locate(), "s", "route.py", args(tmp_path), cwd=tmp_path, env=krt_env(fake_kicad(tmp_path)), timeout=30,
        on_line=lines.append, cancel=threading.Event())
    seen = json.loads(lines[0])
    assert "DISPLAY" not in seen and "WAYLAND_DISPLAY" not in seen
    assert (seen["SDL_VIDEODRIVER"], seen["MPLBACKEND"], seen["PYTHONHASHSEED"]) == ("dummy", "Agg", "0")
    for flag in ("--visualize", "-V", "--auto", "--display-time"):
        with pytest.raises(ValueError):
            run(locate(), "s", "route.py", [*args(tmp_path), flag], cwd=tmp_path, env={}, timeout=1, on_line=print,
                cancel=threading.Event())


def test_kicad_cli_folder_first_on_path(tmp_path):
    from pino_kernel.kicad_cli import KicadCli
    from pino_kernel.libraries import Libraries

    bindir = tmp_path / "kicad bin"
    bindir.mkdir()
    cli = bindir / "kicad-cli"
    cli.write_text("#!/bin/sh\n")
    cli.chmod(0o755)
    libs = Libraries(tmp_path / "sym", tmp_path / "fp", tmp_path / "3d")
    env = krt_env(KicadCli(libs, tmp_path / "home", [str(cli)]))
    assert env["PATH"].split(os.pathsep)[0] == str(bindir)


def run_cli(*argv, env=None):
    return subprocess.run([sys.executable, "-m", "pino_kernel.cli", *argv], capture_output=True, text=True,
                          env=env, timeout=60)


def test_cli_status(fake_krt):
    p = run_cli("router", "status")
    out = json.loads(p.stdout)
    assert p.returncode == 0 and out["installed"] is True and out["version"] == "0.17.7"
    assert out["router"] == "KiCadRoutingTools" and out["commit"] == KRT_COMMIT and out["problems"] == []


def test_cli_status_when_missing(tmp_path, monkeypatch):
    p = run_cli("router", "status")
    out = json.loads(p.stdout)
    assert p.returncode == 1 and out["installed"] is False and out["root"] is None
    assert out["problems"][0]["code"] == "router_missing"


@pytest.mark.network
def test_real_install_into_a_temp_cache(tmp_path):
    env = {**os.environ, "PINO_CACHE_DIR": str(tmp_path)}
    env.pop("PINO_KRT_DIR", None)
    env.pop("PINO_KRT_PYTHON", None)
    krt = install(env)
    assert isinstance(krt, Krt)
    assert krt.version == "0.17.7" and check(krt) == [] and "--no-fix-drc-settings" in krt.flags["route.py"]
    stamp = (tmp_path / "krt" / KRT_COMMIT[:12] / "stamp.json").stat().st_mtime_ns
    ensure(env)
    assert (tmp_path / "krt" / KRT_COMMIT[:12] / "stamp.json").stat().st_mtime_ns == stamp
    assert not list((tmp_path / "krt").glob("*.tmp-*"))
