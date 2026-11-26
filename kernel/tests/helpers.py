"""Small boards on the hand-written fixture libraries, shared by the tests."""

from __future__ import annotations

from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures"

SMALL_BOARD_TEMPLATE = '''from pino import Board

b = Board("small", layers=@LAYERS@, outline=@OUTLINE@)
usb = b.block("usb", "USB power in")
reg = b.block("reg", "3V3 regulator")
mcu = b.block("mcu", "Controller")

j1 = usb.path("J1", "pino_test:CONN_VBUS", footprint="pino_test:USB_Edge")
c1 = usb.shunt("C1", "pino_test:C", "@CAP@")
u1 = reg.path("U1", "pino_test:LDO3")
c2 = reg.shunt("C2", "pino_test:C", "1uF")
u2 = mcu.path("U2", "pino_test:IC6")
c3 = mcu.shunt("C3", "pino_test:C", "100nF")
r1 = mcu.path("R1", "pino_test:R", "10k")
d1 = mcu.path("@LED_REF@", "pino_test:LED", "green"@LED_ID@)

b.supply("VBUS", j1.VBUS, c1[1], u1.VIN, external=True)
b.supply("+3V3", u1.VOUT, c2[1], u2.VDD, u2.EN, c3[1])
b.gnd(j1.GND, c1[2], u1.GND, c2[2], u2.GND, c3[2]@LED_GND@)
b.net("STATUS", u2.IO1, r1[1])
@LED_NET@
b.nc(u2.IO2)
b.nc_rest(u2)
'''


def small_board_py(*, layers: int = 2, outline="(30, 20)", led_ref: str = "D1", led_id: str | None = None,
                   cap_value: str = "10uF", led_nets: bool = True) -> str:
    text = SMALL_BOARD_TEMPLATE
    for k, v in {
        "@LAYERS@": str(layers),
        "@OUTLINE@": outline if isinstance(outline, str) else repr(str(outline)),
        "@CAP@": cap_value,
        "@LED_REF@": led_ref,
        "@LED_ID@": f", id={led_id!r}" if led_id else "",
        "@LED_GND@": ", d1.K" if led_nets else "",
        "@LED_NET@": 'b.net("LED_A", r1[2], d1.A)' if led_nets else "b.nc(r1[2])",
    }.items():
        text = text.replace(k, v)
    return text


SMALL_BOARD_PY = small_board_py()


def small_board(**kw):
    """The small board as a live pino.Board (fixture libraries must be active)."""
    import pino.board

    scope: dict = {"__name__": "__main__"}
    exec(compile(small_board_py(**kw), "board.py", "exec"), scope)
    return scope["b"]


def small_board_without_led_nets():
    return small_board(led_nets=False)
