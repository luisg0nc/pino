// Ported from the board-view spike. Hit testing on exact geometry, in the board file's frame, behind a uniform grid.
import type { Board, Footprint, Pad, Shape, Track, Via, Zone } from './board';
import { type Pt, type BBox, rotate, sub, dist, distToSeg, distToArc, distToPoly, inPoly, grow, emptyBox } from './geom';

/** What can be hit. */
export type HitItem = Pad | Track | Via | Zone | Footprint;
export type Hit = { target: HitItem; layer: string; d: number; fill?: number };

// Signed distance to a rounded box (negative inside).
function sdRoundBox(p: Pt, hw: number, hh: number, r: number) {
  const qx = Math.abs(p.x) - hw + r, qy = Math.abs(p.y) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

export function shapeDistance(p: Pt, s: Shape): number {
  if (s.k === 'line') return distToSeg(p, s.a, s.b) - s.w / 2;
  if (s.k === 'arc') return distToArc(p, s.arc, s.s, s.e) - s.w / 2;
  if (s.k === 'circle') {
    const d = dist(p, s.c);
    return s.fill ? d - s.r - s.w / 2 : Math.abs(d - s.r) - s.w / 2;
  }
  const edge = distToPoly(p, s.pts);
  return s.fill && inPoly(p, s.pts) ? -edge : edge - s.w / 2;
}

// <= 0 means the point is on the pad's copper; positive is the distance to it.
export function padDistance(pad: Pad, p: Pt): number {
  const q = rotate(sub(p, pad.center), -pad.angle);
  const { w, h } = pad;
  const shape = pad.shape === 'custom' ? pad.anchor : pad.shape;
  let d: number;
  if (shape === 'circle') d = Math.hypot(q.x, q.y) - w / 2;
  else if (shape === 'oval') d = sdRoundBox(q, w / 2, h / 2, Math.min(w, h) / 2);
  else if (shape === 'roundrect') {
    d = sdRoundBox(q, w / 2, h / 2, pad.rratio * Math.min(w, h));
    // A listed corner is chamfered instead of rounded; a ratio of 0 leaves it square.
    const c = pad.chamfer * Math.min(w, h);
    for (const name of pad.chamferCorners) {
      const sx = name.endsWith('left') ? -1 : 1, sy = name.startsWith('top') ? -1 : 1;
      if (q.x * sx <= 0 || q.y * sy <= 0) continue;
      const cut = (q.x * sx - w / 2 + (q.y * sy - h / 2) + c) / Math.SQRT2;
      d = Math.max(sdRoundBox(q, w / 2, h / 2, 0), c > 0 ? cut : -Infinity);
    }
  } else if (shape === 'trapezoid') {
    const dx = pad.delta.y / 2, dy = pad.delta.x / 2;
    const poly = [
      { x: -w / 2 - dx, y: h / 2 + dy }, { x: -w / 2 + dx, y: -h / 2 - dy },
      { x: w / 2 - dx, y: -h / 2 + dy }, { x: w / 2 + dx, y: h / 2 - dy },
    ];
    d = (inPoly(q, poly) ? -1 : 1) * distToPoly(q, poly);
  } else d = sdRoundBox(q, w / 2, h / 2, 0);
  for (const s of pad.prims) d = Math.min(d, shapeDistance(p, s));
  return d;
}

export const trackDistance = (t: Track, p: Pt) =>
  (t.arc ? distToArc(p, t.arc, t.a, t.b) : distToSeg(p, t.a, t.b)) - t.w / 2;

const CELL = 1; // mm
type Entry = { box: BBox; target: HitItem; fill?: number };

export class Index {
  private cells = new Map<number, Entry[]>();
  private big: Entry[] = []; // zones and anything spanning many cells
  constructor(board: Board) {
    for (const f of board.footprints) {
      this.insert({ box: f.box, target: f });
      for (const p of f.pads) if (p.copper.length && p.kind !== 'np_thru_hole') this.insert({ box: p.box, target: p });
    }
    for (const t of board.tracks) this.insert({ box: t.box, target: t });
    for (const v of board.vias) this.insert({ box: v.box, target: v });
    // A teardrop is never hit: a click there is its pad or its track.
    for (const z of board.zones) if (!z.teardrop) z.fills.forEach((f, i) => this.insert({ box: f.box, target: z, fill: i }));
  }
  private key = (i: number, j: number) => (i + 20000) * 100000 + (j + 20000);
  private insert(e: Entry) {
    const b = e.box;
    const i0 = Math.floor(b.x0 / CELL), i1 = Math.floor(b.x1 / CELL), j0 = Math.floor(b.y0 / CELL), j1 = Math.floor(b.y1 / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) { this.big.push(e); return; }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      const list = this.cells.get(k);
      if (list) list.push(e); else this.cells.set(k, [e]);
    }
  }
  query(box: BBox): Entry[] {
    const out = new Set<Entry>();
    for (let i = Math.floor(box.x0 / CELL); i <= Math.floor(box.x1 / CELL); i++)
      for (let j = Math.floor(box.y0 / CELL); j <= Math.floor(box.y1 / CELL); j++)
        for (const e of this.cells.get(this.key(i, j)) ?? []) out.add(e);
    for (const e of this.big) out.add(e);
    return [...out].filter((e) => e.box.x0 <= box.x1 && e.box.x1 >= box.x0 && e.box.y0 <= box.y1 && e.box.y1 >= box.y0);
  }
}

const KIND_RANK = { pad: 0, via: 1, track: 2, footprint: 3, zone: 4 } as const;

export type HitOpts = { visible: Set<string>; active: string; tol: number };

// All candidates under the point, best first. Exact hits beat near misses; then the active layer beats other
// layers; then pad, via, track, part, zone.
export function hitTest(index: Index, p: Pt, o: HitOpts): Hit[] {
  const box = emptyBox();
  grow(box, p, o.tol);
  const pick = (layers: string[]) =>
    layers.includes(o.active) && o.visible.has(o.active) ? o.active : layers.find((l) => o.visible.has(l));
  const hits: Hit[] = [];
  for (const e of index.query(box)) {
    const t = e.target;
    if (t.type === 'pad') {
      const layer = pick(t.copper);
      if (!layer) continue;
      const d = padDistance(t, p);
      if (d <= o.tol) hits.push({ target: t, layer, d });
    } else if (t.type === 'via') {
      const layer = pick(t.span);
      if (!layer) continue;
      const d = dist(p, t.pos) - t.size / 2;
      if (d <= o.tol) hits.push({ target: t, layer, d });
    } else if (t.type === 'track') {
      if (!o.visible.has(t.layer)) continue;
      const d = trackDistance(t, p);
      if (d <= o.tol) hits.push({ target: t, layer: t.layer, d });
    } else if (t.type === 'zone') {
      const f = t.fills[e.fill!];
      if (o.visible.has(f.layer) && inPoly(p, f.pts)) hits.push({ target: t, layer: f.layer, d: 0, fill: e.fill });
    } else if (t.outline.length && o.visible.has(`${t.side}.Cu`) && inPoly(p, t.outline)) {
      hits.push({ target: t, layer: `${t.side}.Cu`, d: 0 });
    }
  }
  const rank = (h: Hit) => KIND_RANK[h.target.type];
  const area = (h: Hit) => (h.target.box.x1 - h.target.box.x0) * (h.target.box.y1 - h.target.box.y0);
  return hits.sort((a, b) =>
    Number(a.d > 0) - Number(b.d > 0) ||
    // copper on the layer being looked at wins over copper hidden beneath it
    Number(a.layer !== o.active && a.target.type !== 'footprint') - Number(b.layer !== o.active && b.target.type !== 'footprint') ||
    rank(a) - rank(b) || a.d - b.d || area(a) - area(b));
}

/** What a click takes: the best hit, or, when the same place is clicked again, the one after what is in hand. */
export function nextHit(hits: Hit[], previous: HitItem | null): Hit | null {
  const i = previous ? hits.findIndex((h) => h.target === previous) : -1;
  return hits[(i + 1) % hits.length] ?? null;
}
