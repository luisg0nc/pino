// Ported from the board-view spike, with what pino adds: where two things meet, and hulls.
// Geometry in the board file's own frame (KiCad's page millimetres): x right, y DOWN: x right, y DOWN, angles in degrees that turn
// counter-clockwise as seen on screen (top view).
export type Pt = { x: number; y: number };
export type BBox = { x0: number; y0: number; x1: number; y1: number };

export function rotate(p: Pt, deg: number): Pt {
  if (!deg) return { x: p.x, y: p.y };
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c };
}

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export const emptyBox = (): BBox => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
export function grow(b: BBox, p: Pt, r = 0) {
  if (p.x - r < b.x0) b.x0 = p.x - r;
  if (p.y - r < b.y0) b.y0 = p.y - r;
  if (p.x + r > b.x1) b.x1 = p.x + r;
  if (p.y + r > b.y1) b.y1 = p.y + r;
}
export const boxOf = (pts: Pt[], r = 0) => {
  const b = emptyBox();
  for (const p of pts) grow(b, p, r);
  return b;
};

export type Arc = { c: Pt; r: number; a0: number; sweep: number }; // radians, atan2 in file coordinates

export function arcFrom3(s: Pt, m: Pt, e: Pt): Arc | null {
  const d = 2 * (s.x * (m.y - e.y) + m.x * (e.y - s.y) + e.x * (s.y - m.y));
  if (Math.abs(d) < 1e-12) return null; // collinear
  const s2 = s.x * s.x + s.y * s.y, m2 = m.x * m.x + m.y * m.y, e2 = e.x * e.x + e.y * e.y;
  const c = {
    x: (s2 * (m.y - e.y) + m2 * (e.y - s.y) + e2 * (s.y - m.y)) / d,
    y: (s2 * (e.x - m.x) + m2 * (s.x - e.x) + e2 * (m.x - s.x)) / d,
  };
  const ang = (p: Pt) => Math.atan2(p.y - c.y, p.x - c.x);
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a0 = ang(s);
  const toE = norm(ang(e) - a0), toM = norm(ang(m) - a0);
  const sweep = toM <= toE ? toE : toE - 2 * Math.PI;
  return { c, r: dist(c, s), a0, sweep };
}

export function arcPoints(a: Arc, maxErr = 0.002): Pt[] {
  const step = 2 * Math.acos(Math.max(-1, 1 - maxErr / Math.max(a.r, maxErr)));
  const n = Math.max(2, Math.ceil(Math.abs(a.sweep) / Math.max(step, 0.01)));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a.a0 + (a.sweep * i) / n;
    out.push({ x: a.c.x + a.r * Math.cos(t), y: a.c.y + a.r * Math.sin(t) });
  }
  return out;
}

export function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function distToArc(p: Pt, arc: Arc, s: Pt, e: Pt): number {
  const a = Math.atan2(p.y - arc.c.y, p.x - arc.c.x);
  let d = a - arc.a0;
  const tau = 2 * Math.PI;
  d = ((d % tau) + tau) % tau;
  const inside = arc.sweep >= 0 ? d <= arc.sweep : d - tau >= arc.sweep || d === 0;
  return inside ? Math.abs(dist(p, arc.c) - arc.r) : Math.min(dist(p, s), dist(p, e));
}

// Even-odd rule. KiCad's filled polygons express holes as zero-width slits, which this handles.
export function inPoly(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToPoly(p: Pt, pts: Pt[], closed = true): number {
  let best = Infinity;
  for (let i = closed ? 0 : 1; i < pts.length; i++) {
    const d = distToSeg(p, pts[(i + pts.length - 1) % pts.length], pts[i]);
    if (d < best) best = d;
  }
  return best;
}

export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

// Ramer-Douglas-Peucker, for turning a mouse stroke into a short mm path.
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSeg(pts[i], pts[0], pts[pts.length - 1]);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

const TAU = 2 * Math.PI;
const turn = (a: number) => ((a % TAU) + TAU) % TAU;

/** Whether the angle (radians, in the file's atan2) lies on the arc. */
export function onArc(arc: Arc, angle: number): boolean {
  const eps = 1e-9;
  const from = turn(angle - arc.a0);
  return arc.sweep >= 0 ? from <= arc.sweep + eps || from >= TAU - eps : from - TAU >= arc.sweep - eps || from <= eps;
}

/** Where along ab (0 to 1) it first meets cd, or null; touching counts. */
export function meetSegment(a: Pt, b: Pt, c: Pt, d: Pt): number | null {
  const r = sub(b, a), s = sub(d, c), w = sub(c, a);
  const cross = (p: Pt, q: Pt) => p.x * q.y - p.y * q.x;
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) {
    if (Math.abs(cross(w, r)) > 1e-9) return null; // parallel, apart
    const len = r.x * r.x + r.y * r.y;
    if (!len) return distToSeg(a, c, d) < 1e-9 ? 0 : null;
    const t0 = (w.x * r.x + w.y * r.y) / len, t1 = t0 + (s.x * r.x + s.y * r.y) / len;
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
    return lo <= hi ? lo : null;
  }
  const t = cross(w, s) / den, u = cross(w, r) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? Math.min(1, Math.max(0, t)) : null;
}

/** Where along ab (0 to 1) it meets the circle's line, in order. */
export function meetCircle(a: Pt, b: Pt, c: Pt, r: number): number[] {
  const d = sub(b, a), f = sub(a, c);
  const qa = d.x * d.x + d.y * d.y, qb = 2 * (f.x * d.x + f.y * d.y), qc = f.x * f.x + f.y * f.y - r * r;
  const disc = qb * qb - 4 * qa * qc;
  if (!qa || disc < 0) return [];
  const root = Math.sqrt(disc);
  return [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)].filter((t) => t >= 0 && t <= 1);
}

/** Where along ab it first meets the arc itself (not its chord), or null. */
export function meetArc(a: Pt, b: Pt, arc: Arc): number | null {
  for (const t of meetCircle(a, b, arc.c, arc.r)) {
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (onArc(arc, Math.atan2(y - arc.c.y, x - arc.c.x))) return t;
  }
  return null;
}

/** Where along ab it first is on a filled polygon: 0 when it starts inside. */
export function meetPoly(a: Pt, b: Pt, pts: Pt[]): number | null {
  if (inPoly(a, pts)) return 0;
  let first: number | null = null;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const t = meetSegment(a, b, pts[j], pts[i]);
    if (t !== null && (first === null || t < first)) first = t;
  }
  return first;
}

export function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (meetSegment(a, b, c, d) !== null) return 0;
  return Math.min(distToSeg(a, c, d), distToSeg(b, c, d), distToSeg(c, a, b), distToSeg(d, a, b));
}

/** The convex hull of the points, in order round it. */
export function convexHull(points: Pt[]): Pt[] {
  const sorted = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const half = (list: Pt[]) => {
    const out: Pt[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}
