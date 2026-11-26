"""pino's reference board: an ESP32-C6 module on USB-C power, a 3V3 LDO, a boot button and two LEDs.

Symbols and footprints come from KiCad's own libraries. The LCSC numbers are JLC's parts, chosen with jlcsearch
on 2026-11-26: basic parts where one fits, and each extended part says why. R9 is not fitted, so it has none.
"""

from pino import Board

R, C = "Device:R", "Device:C"
R0402 = "Resistor_SMD:R_0402_1005Metric"
C0402 = "Capacitor_SMD:C_0402_1005Metric"
C0805 = "Capacitor_SMD:C_0805_2012Metric"
LED0603 = "LED_SMD:LED_0603_1608Metric"

b = Board("pino-reference", layers=2, outline="outline.json")

usb = b.block("usb", "USB power in")
j1 = usb.path("J1", "Connector:USB_C_Receptacle_USB2.0_16P", "USB-C",
              footprint="Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12", lcsc="C165948",
              why="the USB-C receptacle this footprint is drawn for, the HRO TYPE-C-31-M-12")
f1 = usb.path("F1", "Device:Polyfuse_Small", "500mA", footprint="Fuse:Fuse_0805_2012Metric",
              lcsc="C910822", why="an 0805 resettable fuse holding 500 mA at 24 V; jlcsearch listed no basic one")
r9 = usb.across("R9", R, "0R DNP", footprint=R0402, dnp=True)
c1 = usb.shunt("C1", C, "10uF", footprint=C0805, lcsc="C15850")
r1 = usb.shunt("R1", R, "5.1k", footprint=R0402, lcsc="C25905")
r2 = usb.shunt("R2", R, "5.1k", footprint=R0402, lcsc="C25905")
r3 = usb.shunt("R3", R, "1M", footprint=R0402, lcsc="C26083")
c2 = usb.shunt("C2", C, "4.7nF", footprint=C0402, lcsc="C1538")

reg = b.block("reg", "3V3 regulator")
c3 = reg.shunt("C3", C, "1uF", footprint=C0402, lcsc="C52923")
u2 = reg.path("U2", "Regulator_Linear:AP2112K-3.3", lcsc="C51118",
              why="the AP2112K-3.3 the design uses: 600 mA from a SOT-23-5")
c4 = reg.shunt("C4", C, "1uF", footprint=C0402, lcsc="C52923")

mcu = b.block("mcu", "MCU")
u1 = mcu.path("U1", "RF_Module:ESP32-C6-MINI-1", lcsc="C5736265",
              why="the ESP32-C6 module itself, with 4 MB of flash")
c5 = mcu.shunt("C5", C, "100nF", footprint=C0402, lcsc="C1525")
c6 = mcu.shunt("C6", C, "10uF", footprint=C0805, lcsc="C15850")
r4 = mcu.tap("R4", R, "10k", footprint=R0402, lcsc="C25744")
c7 = mcu.shunt("C7", C, "1uF", footprint=C0402, lcsc="C52923")
r5 = mcu.tap("R5", R, "10k", footprint=R0402, lcsc="C25744")
sw1 = mcu.shunt("SW1", "Switch:SW_Push", "BOOT", footprint="Button_Switch_SMD:SW_SPST_TL3342", lcsc="C2886894",
                why="the TL3342 button this footprint is drawn for")
r6 = mcu.path("R6", R, "1k", footprint=R0402, lcsc="C11702")
d1 = mcu.shunt("D1", "Device:LED", "green", footprint=LED0603, lcsc="C72043",
               why="a green 0603 LED; jlcsearch listed no basic one")
r7 = mcu.tap("R7", R, "1k", footprint=R0402, lcsc="C11702")
d2 = mcu.shunt("D2", "Device:LED", "red", footprint=LED0603, id="power-led", lcsc="C2286")

b.net("VBUS_IN", j1["VBUS"], f1[1], r9[1])
b.supply("VBUS", f1[2], r9[2], c1[1], c3[1], u2["VIN"], u2["EN"], external=True)
b.supply("+3V3", u2["VOUT"], c4[1], u1["3V3"], c5[1], c6[1], r4[1], r5[1], r7[1])
b.net("CC1", j1["CC1"], r1[1])
b.net("CC2", j1["CC2"], r2[1])
b.net("SHIELD", j1["SHIELD"], r3[1], c2[1])
b.net("USB_D-", j1["D-"], u1["IO12"])
b.net("USB_D+", j1["D+"], u1["IO13"])
b.diff_pair("USB_D+", "USB_D-")
b.net("EN", u1["EN"], r4[2], c7[1])
b.net("BOOT", u1["IO9"], r5[2], sw1[1])
b.net("LED", u1["IO8"], r6[1])
b.net("LED_A", r6[2], d1["A"])
b.net("PWR_LED", r7[2], d2["A"])
b.gnd(j1["GND"], c1[2], r1[2], r2[2], r3[2], c2[2], c3[2], u2["GND"], c4[2],
      u1["GND"], c5[2], c6[2], c7[2], sw1[2], d1["K"], d2["K"], external=True)
b.nc(j1["SBU1"], j1["SBU2"])
b.nc_rest(u2)
b.nc_rest(u1)

b.place(u1, edge="top", center=True)
b.place(j1, edge="bottom", center=True)
b.place(u2, near=j1, side="top")
b.place(sw1, edge="left")
leds = b.group("leds", d1, r6, d2, r7)
b.place(leds, near=u1, side="right")

b.zone("GND", layer="B.Cu")
b.net_class("power", ["VBUS", "+3V3"], width=0.5)
b.expect_path(j1["VBUS"], u2["VIN"], through=[f1])
b.expect_path(j1["D+"], u1["IO13"])
b.expect_path(j1["D-"], u1["IO12"])
b.expect_path(u2["VOUT"], u1["3V3"])
b.expect_apart(j1["D+"], j1["D-"])
