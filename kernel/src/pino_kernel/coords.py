"""The one place that converts between pino's board frame and KiCad's.

pino's frame (board.py, findings, placement, results): millimetres, origin at the outline
centre, x right, y up. KiCad's frame: origin top left of the page, y down. pino puts the
outline centre at (100, 100) on KiCad's page. Angles are the same number in both frames
(counter-clockwise as seen from the top).
"""

from __future__ import annotations

ORIGIN = (100.0, 100.0)


def to_kicad(x: float, y: float) -> tuple[float, float]:
    return (ORIGIN[0] + x, ORIGIN[1] - y)


def from_kicad(X: float, Y: float) -> tuple[float, float]:
    return (X - ORIGIN[0], ORIGIN[1] - Y)
