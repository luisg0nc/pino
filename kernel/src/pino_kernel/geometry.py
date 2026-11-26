"""Plane geometry in board millimetres: polygons, arcs, containment and overlap."""

from __future__ import annotations

import math

Point = tuple[float, float]
Polygon = list[Point]


def bbox(poly) -> tuple[float, float, float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return (min(xs), min(ys), max(xs), max(ys))


def point_in_polygon(p: Point, poly: Polygon) -> bool:
    """Even-odd rule; points on an edge count as inside."""
    x, y = p
    if _on_boundary(p, poly):
        return True
    inside = False
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xc = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if xc > x:
                inside = not inside
    return inside


def _on_boundary(p: Point, poly: Polygon, eps: float = 1e-9) -> bool:
    n = len(poly)
    return any(_seg_dist(p, poly[i], poly[(i + 1) % n]) <= eps for i in range(n))


def _seg_dist(p: Point, a: Point, b: Point) -> float:
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _cross(o: Point, a: Point, b: Point) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _proper_cross(a: Point, b: Point, c: Point, d: Point, eps: float = 1e-9) -> bool:
    """Segments ab and cd cross at a point inside both (touching or collinear does not count)."""
    d1, d2 = _cross(c, d, a), _cross(c, d, b)
    d3, d4 = _cross(a, b, c), _cross(a, b, d)
    return ((d1 > eps and d2 < -eps) or (d1 < -eps and d2 > eps)) and ((d3 > eps and d4 < -eps) or (d3 < -eps and d4 > eps))


def _strictly_inside(p: Point, poly: Polygon) -> bool:
    return not _on_boundary(p, poly, 1e-7) and point_in_polygon(p, poly)


def polygons_overlap(a: Polygon, b: Polygon) -> bool:
    """True when the interiors meet; polygons that only touch along an edge or at a corner do not overlap."""
    ax0, ay0, ax1, ay1 = bbox(a)
    bx0, by0, bx1, by1 = bbox(b)
    if ax1 <= bx0 or bx1 <= ax0 or ay1 <= by0 or by1 <= ay0:
        return False
    na, nb = len(a), len(b)
    for i in range(na):
        for j in range(nb):
            if _proper_cross(a[i], a[(i + 1) % na], b[j], b[(j + 1) % nb]):
                return True
    if any(_strictly_inside(p, b) for p in a) or any(_strictly_inside(p, a) for p in b):
        return True
    # identical or edge-sharing shapes: test edge midpoints and the centroid
    for poly, other in ((a, b), (b, a)):
        n = len(poly)
        for i in range(n):
            m = ((poly[i][0] + poly[(i + 1) % n][0]) / 2, (poly[i][1] + poly[(i + 1) % n][1]) / 2)
            if _strictly_inside(m, other):
                return True
        c = (sum(p[0] for p in poly) / n, sum(p[1] for p in poly) / n)
        if _strictly_inside(c, other) and point_in_polygon(c, poly) and not _on_boundary(c, poly, 1e-7):
            return True
    return False


def inside(poly: Polygon, container: Polygon) -> bool:
    """Every point of poly lies in container and no edge of poly crosses container's boundary."""
    if not all(point_in_polygon(p, container) for p in poly):
        return False
    n, m = len(poly), len(container)
    for i in range(n):
        for j in range(m):
            if _proper_cross(poly[i], poly[(i + 1) % n], container[j], container[(j + 1) % m]):
                return False
    # an edge between two boundary points can still leave a concave container: test edge midpoints
    for i in range(n):
        mid = ((poly[i][0] + poly[(i + 1) % n][0]) / 2, (poly[i][1] + poly[(i + 1) % n][1]) / 2)
        if not point_in_polygon(mid, container):
            return False
    return True


def distance_to_edges(p: Point, poly: Polygon) -> float:
    n = len(poly)
    return min(_seg_dist(p, poly[i], poly[(i + 1) % n]) for i in range(n))


def arc_points(start: Point, mid: Point, end: Point, chord: float = 0.1) -> list[Point]:
    """Points along the arc through start, mid and end, from start to end (end included), at most `chord` apart."""
    (x1, y1), (x2, y2), (x3, y3) = start, mid, end
    d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
    if abs(d) < 1e-12:
        return [start, end]
    ux = ((x1 * x1 + y1 * y1) * (y2 - y3) + (x2 * x2 + y2 * y2) * (y3 - y1) + (x3 * x3 + y3 * y3) * (y1 - y2)) / d
    uy = ((x1 * x1 + y1 * y1) * (x3 - x2) + (x2 * x2 + y2 * y2) * (x1 - x3) + (x3 * x3 + y3 * y3) * (x2 - x1)) / d
    r = math.hypot(x1 - ux, y1 - uy)
    a1 = math.atan2(y1 - uy, x1 - ux)
    a2 = math.atan2(y2 - uy, x2 - ux)
    a3 = math.atan2(y3 - uy, x3 - ux)
    ccw = (_cross(start, mid, end) > 0)
    def sweep(a, b):
        s = (b - a) % (2 * math.pi)
        return s if ccw else s - 2 * math.pi
    total = sweep(a1, a3)
    n = max(2, math.ceil(abs(total) * r / max(chord, 1e-6)))
    pts = [(ux + r * math.cos(a1 + total * k / n), uy + r * math.sin(a1 + total * k / n)) for k in range(n)]
    pts.append(end)
    return pts


def circle_polygon(cx: float, cy: float, r: float, n: int = 48) -> Polygon:
    return [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
