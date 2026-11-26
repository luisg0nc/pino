"""The schematic spike's base circuit and its seven harder cases, on the pino API (KiCad's own libraries).

LCSC fields are empty: no real part numbers in the repo.
"""

from __future__ import annotations

from pino import Board

R, C = "Device:R", "Device:C"
R0402 = "Resistor_SMD:R_0402_1005Metric"
C0402 = "Capacitor_SMD:C_0402_1005Metric"
C0805 = "Capacitor_SMD:C_0805_2012Metric"
LED0603 = "LED_SMD:LED_0603_1608Metric"
HDR = "Connector_PinHeader_2.54mm:PinHeader_1x{n:02d}_P2.54mm_Vertical"


def base(case=None) -> Board:
    b = Board("spike", outline=(56, 44))
    usb = b.block("usb", "USB power in")
    j1 = usb.path("J1", "Connector:USB_C_Receptacle_USB2.0_16P", "USB-C",
                  footprint="Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12")
    f1 = usb.path("F1", "Device:Polyfuse_Small", "500mA", footprint="Fuse:Fuse_0805_2012Metric")
    r9 = usb.across("R9", R, "0R DNP", footprint=R0402, dnp=True)
    c1 = usb.shunt("C1", C, "10uF", footprint=C0805)
    r1 = usb.shunt("R1", R, "5.1k", footprint=R0402)
    r2 = usb.shunt("R2", R, "5.1k", footprint=R0402)
    r3 = usb.shunt("R3", R, "1M", footprint=R0402)
    c2 = usb.shunt("C2", C, "4.7nF", footprint=C0402)

    reg = b.block("reg", "3V3 regulator")
    c3 = reg.shunt("C3", C, "1uF", footprint=C0402)
    u2 = reg.path("U2", "Regulator_Linear:AP2112K-3.3")
    c4 = reg.shunt("C4", C, "1uF", footprint=C0402)

    mcu = b.block("mcu", "MCU")
    u1 = mcu.path("U1", "RF_Module:ESP32-C6-MINI-1")
    c5 = mcu.shunt("C5", C, "100nF", footprint=C0402)
    c6 = mcu.shunt("C6", C, "10uF", footprint=C0805)
    r4 = mcu.tap("R4", R, "10k", footprint=R0402)
    c7 = mcu.shunt("C7", C, "1uF", footprint=C0402)
    r5 = mcu.tap("R5", R, "10k", footprint=R0402)
    sw1 = mcu.shunt("SW1", "Switch:SW_Push", "BOOT", footprint="Button_Switch_SMD:SW_SPST_TL3342")
    r6 = mcu.path("R6", R, "1k", footprint=R0402)
    d1 = mcu.shunt("D1", "Device:LED", "green", footprint=LED0603)

    ctx = {"b": b, "usb": usb, "reg": reg, "mcu": mcu, "j1": j1, "u1": u1, "u2": u2, "series": False}
    if case:
        case(ctx)
    b.net("VBUS_IN", j1["VBUS"], f1[1], r9[1])
    b.supply("VBUS", f1[2], r9[2], c1[1], c3[1], u2["VIN"], u2["EN"], external=True)
    b.supply("+3V3", u2["VOUT"], c4[1], u1["3V3"], c5[1], c6[1], r4[1], r5[1])
    b.net("CC1", j1["CC1"], r1[1])
    b.net("CC2", j1["CC2"], r2[1])
    b.net("SHIELD", j1["SHIELD"], r3[1], c2[1])
    if not ctx["series"]:
        b.net("USB_DN", j1["D-"], u1["IO12"])
        b.net("USB_DP", j1["D+"], u1["IO13"])
    b.net("EN", u1["EN"], r4[2], c7[1])
    b.net("BOOT", u1["IO9"], r5[2], sw1[1])
    b.net("LED", u1["IO8"], r6[1])
    b.net("LED_A", r6[2], d1["A"])
    b.gnd(j1["GND"], c1[2], r1[2], r2[2], r3[2], c2[2], c3[2], u2["GND"], c4[2],
          u1["GND"], c5[2], c6[2], c7[2], sw1[2], d1["K"], external=True)
    b.nc(j1["SBU1"], j1["SBU2"])
    b.nc_rest(u2)
    b.nc_rest(u1)
    return b


def plain() -> Board:
    return base()


def i2c_header() -> Board:
    def case(x):
        b, u1 = x["b"], x["u1"]
        sec = b.block("i2c", "I2C header")
        j = sec.path("J2", "Connector_Generic:Conn_01x04", "I2C", footprint=HDR.format(n=4))
        ra = sec.tap("R20", R, "4.7k", footprint=R0402)
        rb = sec.tap("R21", R, "4.7k", footprint=R0402)
        b.net("SDA", j["3"], ra["2"], u1["IO4"])
        b.net("SCL", j["4"], rb["2"], u1["IO5"])
        b.supply("+3V3", j["2"], ra["1"], rb["1"])
        b.gnd(j["1"])
    return base(case)


def series_resistors() -> Board:
    """22R in series with D+ and D-: two parallel signal lines."""
    def case(x):
        b, u1, j1, mcu = x["b"], x["u1"], x["j1"], x["mcu"]
        x["series"] = True
        r1 = mcu.path("R30", R, "22R", footprint=R0402)
        r2 = mcu.path("R31", R, "22R", footprint=R0402)
        b.net("USB_DN", j1["D-"], r1["1"]); b.net("USB_DN_R", r1["2"], u1["IO12"])
        b.net("USB_DP", j1["D+"], r2["1"]); b.net("USB_DP_R", r2["2"], u1["IO13"])
    return base(case)


def rc_filter_chain() -> Board:
    def case(x):
        b, u1 = x["b"], x["u1"]
        sec = b.block("flt", "Filter")
        ra = sec.path("R40", R, "1k", footprint=R0402)
        ca = sec.shunt("C40", C, "10nF", footprint=C0402)
        rb = sec.path("R41", R, "1k", footprint=R0402)
        cb = sec.shunt("C41", C, "10nF", footprint=C0402)
        b.net("PWM", u1["IO6"], ra["1"])
        b.net("MID", ra["2"], ca["1"], rb["1"])
        b.net("FILT", rb["2"], cb["1"], u1["IO7"])
        b.gnd(ca["2"], cb["2"])
    return base(case)


def divider() -> Board:
    def case(x):
        b, u1, mcu = x["b"], x["u1"], x["mcu"]
        top = mcu.tap("R50", R, "100k", footprint=R0402)
        bottom = mcu.shunt("R51", R, "100k", footprint=R0402)
        b.supply("VBUS", top["1"])
        b.net("VSENSE", top["2"], bottom["1"], u1["IO0"])
        b.gnd(bottom["2"])
    return base(case)


def mosfet_in_path() -> Board:
    """A 3-pin P-MOSFET on the power line: its pins do not face left and right."""
    def case(x):
        b, u1 = x["b"], x["u1"]
        sec = b.block("sw", "Load switch")
        q = sec.path("Q1", "Transistor_FET:AO3401A", "AO3401A")
        pull = sec.shunt("R60", R, "100k", footprint=R0402)
        j = sec.path("J3", "Connector_Generic:Conn_01x02", "OUT", footprint=HDR.format(n=2))
        b.supply("VBUS", q["S"])
        b.net("GATE", q["G"], pull["1"], u1["IO14"])
        b.net("VSW", q["D"], j["1"])
        b.gnd(pull["2"], j["2"])
    return base(case)


def esd_array() -> Board:
    def case(x):
        b, usb = x["b"], x["usb"]
        d = usb.path("D2", "Power_Protection:USBLC6-2SC6", "USBLC6-2SC6")
        b.net("USB_DP", d["1"], d["6"])
        b.net("USB_DN", d["3"], d["4"])
        b.supply("VBUS", d["5"])
        b.gnd(d["2"])
    return base(case)


def twelve_leds() -> Board:
    def case(x):
        b, u1 = x["b"], x["u1"]
        sec = b.block("leds", "LED bank")
        pins = ["IO0", "IO1", "IO2", "IO3", "IO4", "IO5", "IO6", "IO7", "IO14", "IO15", "IO18", "IO19"]
        for i, pin in enumerate(pins):
            r = sec.path(f"R7{i:02d}", R, "1k", footprint=R0402)
            d = sec.shunt(f"D7{i:02d}", "Device:LED", "red", footprint=LED0603)
            b.net(f"L{i}", u1[pin], r["1"])
            b.net(f"L{i}_A", r["2"], d["A"])
            b.gnd(d["K"])
    return base(case)


ALL = [plain, i2c_header, series_resistors, rc_filter_chain, divider, mosfet_in_path, esd_array, twelve_leds]
