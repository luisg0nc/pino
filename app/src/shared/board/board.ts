// Ported from the board-view spike: a .kicad_pcb read into what pino draws, hit-tests and measures. Everything here
// is in the board file's own frame (KiCad's page millimetres, y down); `coords.ts` converts to pino's board frame.
import { parseSexpr, kid, kids, str, num, type Node } from './sexpr';
import { type Pt, type BBox, type Arc, rotate, add, arcFrom3, arcPoints, boxOf, convexHull, dist, emptyBox, grow } from './geom';

// A drawable primitive in board mm.
export type Shape =
  | { k: 'line'; a: Pt; b: Pt; w: number }
  | { k: 'arc'; arc: Arc; s: Pt; e: Pt; w: number }
  | { k: 'circle'; c: Pt; r: number; w: number; fill: boolean }
  | { k: 'poly'; pts: Pt[]; w: number; fill: boolean };

export type Pad = {
  type: 'pad'; fp: Footprint; number: string; kind: string; shape: string;
  pos: Pt; // pad anchor (the hole, if any)
  center: Pt; // copper shape centre (anchor + drill offset)
  angle: number; w: number; h: number; rratio: number; chamfer: number; chamferCorners: string[]; delta: Pt;
  prims: Shape[]; anchor: string; // custom pads only, already in board coordinates
  drill: { w: number; h: number } | null;
  layers: string[]; copper: string[]; net: string; pinName: string; pinType: string; uuid: string; box: BBox;
};
export type Footprint = {
  type: 'footprint'; ref: string; value: string; lib: string; pos: Pt; angle: number; side: 'F' | 'B';
  uuid: string; pads: Pad[]; graphics: { layer: string; shape: Shape }[];
  // the courtyard as a polygon; without one, the box of the fab drawing or of the pads, turned with the part
  outline: Pt[];
  outlineFrom: 'courtyard' | 'fab' | 'pads' | ''; box: BBox;
};
export type Track = {
  type: 'track'; a: Pt; b: Pt; mid: Pt | null; arc: Arc | null; w: number; layer: string; net: string; uuid: string; box: BBox;
};
export type Via = {
  type: 'via'; pos: Pt; size: number; drill: number; layers: [string, string]; span: string[]; kind: string; net: string; uuid: string; box: BBox;
};
export type Zone = {
  type: 'zone'; name: string; net: string; uuid: string; layers: string[]; priority: number; teardrop: boolean;
  keepout: boolean; outline: Pt[]; fills: { layer: string; pts: Pt[]; box: BBox }[]; box: BBox;
};
export type Board = {
  copper: string[]; footprints: Footprint[]; tracks: Track[]; vias: Via[]; zones: Zone[];
  graphics: { layer: string; shape: Shape }[]; // board-level, includes Edge.Cuts
  box: BBox; nets: string[]; warnings: string[];
  thickness: number; // mm
  copperUm: number; // the top copper's thickness, micrometres (35 is 1 oz)
};

// KiCad escapes characters in names ("/SDA_IN{slash}PUSH"); people and Claude see them plain.
const ESCAPES: Record<string, string> = { slash: '/', backslash: '\\', lt: '<', gt: '>', colon: ':', dblquote: '"', brace: '{' };
const plain = (s: string) => s.replace(/\{(\w+)\}/g, (m, k) => ESCAPES[k] ?? m);

const pt = (n: Node | undefined): Pt => ({ x: Number(n?.[1] ?? 0), y: Number(n?.[2] ?? 0) });

// (pts (xy ..) (arc (start)(mid)(end)) ..) -> flat polygon
function ptsOf(n: Node): Pt[] {
  const list = kid(n, 'pts');
  const out: Pt[] = [];
  if (!list) return out;
  for (let i = 1; i < list.length; i++) {
    const c = list[i] as Node;
    if (c[0] === 'xy') out.push({ x: Number(c[1]), y: Number(c[2]) });
    else if (c[0] === 'arc') {
      const s = pt(kid(c, 'start')), m = pt(kid(c, 'mid')), e = pt(kid(c, 'end'));
      const a = arcFrom3(s, m, e);
      out.push(...(a ? arcPoints(a) : [s, e]));
    }
  }
  return out;
}

const strokeWidth = (n: Node) => {
  const s = kid(n, 'stroke');
  return s ? num(s, 'width') : num(n, 'width');
};
const isFilled = (n: Node) => {
  const f = str(n, 'fill');
  return f === 'yes' || f === 'solid';
};

// gr_* / fp_* graphic -> Shape, mapped through `tf` (footprint or pad frame to board).
function graphic(n: Node, kind: string, tf: (p: Pt) => Pt): Shape | null {
  const w = strokeWidth(n);
  switch (kind) {
    case 'line': return { k: 'line', a: tf(pt(kid(n, 'start'))), b: tf(pt(kid(n, 'end'))), w };
    case 'arc': {
      const s = tf(pt(kid(n, 'start'))), m = tf(pt(kid(n, 'mid'))), e = tf(pt(kid(n, 'end')));
      const arc = arcFrom3(s, m, e);
      return arc ? { k: 'arc', arc, s, e, w } : { k: 'line', a: s, b: e, w };
    }
    case 'circle': {
      const c = pt(kid(n, 'center')), e = pt(kid(n, 'end'));
      return { k: 'circle', c: tf(c), r: Math.hypot(e.x - c.x, e.y - c.y), w, fill: isFilled(n) };
    }
    case 'rect': {
      const s = pt(kid(n, 'start')), e = pt(kid(n, 'end'));
      return { k: 'poly', pts: [s, { x: e.x, y: s.y }, e, { x: s.x, y: e.y }].map(tf), w, fill: isFilled(n) };
    }
    case 'poly': return { k: 'poly', pts: ptsOf(n).map(tf), w, fill: isFilled(n) };
    default: return null;
  }
}

export function shapePoints(s: Shape): Pt[] {
  if (s.k === 'line') return [s.a, s.b];
  if (s.k === 'arc') return arcPoints(s.arc);
  if (s.k === 'poly') return s.pts;
  return [{ x: s.c.x - s.r, y: s.c.y - s.r }, { x: s.c.x + s.r, y: s.c.y + s.r }];
}

function copperLayers(layers: string[], copper: string[]): string[] {
  const out = new Set<string>();
  for (const l of layers) {
    if (l === '*.Cu') copper.forEach((c) => out.add(c));
    else if (l === 'F&B.Cu') { out.add('F.Cu'); out.add('B.Cu'); }
    else if (l.endsWith('.Cu')) out.add(l);
  }
  return [...out];
}

function parsePad(n: Node, fp: Footprint, copper: string[], warnings: string[]): Pad {
  const at = kid(n, 'at')!;
  const pos = add(fp.pos, rotate(pt(at), fp.angle));
  const angle = Number(at[3] ?? 0); // already includes the footprint's rotation
  const size = kid(n, 'size')!;
  const shape = n[3] as string;
  const d = kid(n, 'drill');
  let drill: Pad['drill'] = null;
  let offset: Pt = { x: 0, y: 0 };
  if (d) {
    const vals = d.slice(1).filter((v): v is string => typeof v === 'string' && v !== 'oval').map(Number);
    if (vals.length) drill = { w: vals[0], h: vals[1] ?? vals[0] };
    if (kid(d, 'offset')) offset = pt(kid(d, 'offset'));
  }
  const center = add(pos, rotate(offset, angle));
  const layers = (kid(n, 'layers')?.slice(1) ?? []) as string[];
  const padTf = (p: Pt) => add(center, rotate(p, angle));
  const prims: Shape[] = [];
  let anchor = '';
  if (shape === 'custom') {
    anchor = str(kid(n, 'options') ?? [], 'anchor') ?? 'circle';
    for (const g of (kid(n, 'primitives') ?? []).slice(1) as Node[]) {
      const kind = String(g[0]).replace('gr_', '');
      const s = graphic(g, kind, padTf);
      if (s) prims.push(s);
      else warnings.push(`custom pad primitive ${g[0]} ignored`);
    }
  }
  if (!['rect', 'roundrect', 'circle', 'oval', 'custom', 'trapezoid'].includes(shape)) warnings.push(`unknown pad shape ${shape}`);
  const w = Number(size[1]), h = Number(size[2]);
  const reach = Math.hypot(w, h) / 2;
  const box = boxOf([center], reach);
  for (const s of prims) for (const p of shapePoints(s)) grow(box, p, s.w / 2);
  return {
    type: 'pad', fp, number: n[1] as string, kind: n[2] as string, shape, pos, center, angle, w, h,
    rratio: num(n, 'roundrect_rratio'), chamfer: num(n, 'chamfer_ratio'),
    chamferCorners: (kid(n, 'chamfer')?.slice(1) ?? []) as string[],
    delta: pt(kid(n, 'rect_delta')), prims, anchor, drill, layers, copper: copperLayers(layers, copper),
    net: netOf(n), pinName: str(n, 'pinfunction') ?? '', pinType: str(n, 'pintype') ?? '',
    uuid: str(n, 'uuid') ?? '', box,
  };
}

// KiCad 10 writes (net "name"); older files wrote (net 3 "name").
function netOf(n: Node): string {
  const k = kid(n, 'net');
  if (!k) return '';
  const name = plain((k.length > 2 ? k[2] : k[1]) as string);
  // KiCad names a net of its own for each pin left open: such a pin is on no net.
  return name.startsWith('unconnected-(') ? '' : name;
}

// The courtyard's lines as one closed polygon, when they chain into one: an L-shaped courtyard stays L-shaped.
function closedLoop(shapes: Shape[]): Pt[] | null {
  if (shapes.length === 1) {
    const only = shapes[0];
    if (only.k === 'poly') return only.pts;
    if (only.k === 'circle') return Array.from({ length: 48 }, (_, i) => ({
      x: only.c.x + only.r * Math.cos((i * Math.PI) / 24), y: only.c.y + only.r * Math.sin((i * Math.PI) / 24),
    }));
    return null;
  }
  if (!shapes.every((s) => s.k === 'line' || s.k === 'arc')) return null;
  const runs = shapes.map((s) => (s.k === 'line' ? [s.a, s.b] : arcPoints((s as Extract<Shape, { k: 'arc' }>).arc, 0.01)));
  const near = (p: Pt, q: Pt) => dist(p, q) < 0.002;
  const loop = [...runs.shift()!];
  while (runs.length) {
    const end = loop[loop.length - 1];
    const i = runs.findIndex((r) => near(r[0], end) || near(r[r.length - 1], end));
    if (i < 0) return null;
    const [run] = runs.splice(i, 1);
    loop.push(...(near(run[0], end) ? run : [...run].reverse()).slice(1));
  }
  if (loop.length < 4 || !near(loop[0], loop[loop.length - 1])) return null;
  return loop.slice(0, -1);
}

function parseFootprint(n: Node, copper: string[], board: Board): Footprint {
  const at = kid(n, 'at')!;
  const fp: Footprint = {
    type: 'footprint', ref: '', value: '', lib: n[1] as string, pos: pt(at), angle: Number(at[3] ?? 0),
    side: str(n, 'layer') === 'B.Cu' ? 'B' : 'F', uuid: str(n, 'uuid') ?? '', pads: [], graphics: [],
    outline: [], outlineFrom: '', box: emptyBox(),
  };
  for (const p of kids(n, 'property')) {
    if (p[1] === 'Reference') fp.ref = p[2] as string;
    if (p[1] === 'Value') fp.value = p[2] as string;
  }
  const tf = (p: Pt) => add(fp.pos, rotate(p, fp.angle));
  // fab and pad extents in the footprint's own frame, so the box turns with the part
  const local: Record<string, BBox> = { Fab: emptyBox(), pads: emptyBox() };
  const courtyard: Shape[] = [];
  const toLocal = (p: Pt) => rotate({ x: p.x - fp.pos.x, y: p.y - fp.pos.y }, -fp.angle);
  for (let i = 2; i < n.length; i++) {
    const c = n[i] as Node;
    if (typeof c === 'string') continue;
    const head = c[0] as string;
    if (head === 'pad') {
      const pad = parsePad(c, fp, copper, board.warnings);
      fp.pads.push(pad);
      for (const p of [{ x: pad.box.x0, y: pad.box.y0 }, { x: pad.box.x1, y: pad.box.y1 }]) grow(local.pads, toLocal(p));
    } else if (head.startsWith('fp_') && head !== 'fp_text') {
      const kind = head.slice(3);
      const layer = str(c, 'layer') ?? '';
      const s = graphic(c, kind, tf);
      if (!s) { board.warnings.push(`${head} ignored`); continue; }
      fp.graphics.push({ layer, shape: s });
      if (layer.endsWith('.CrtYd')) courtyard.push(s);
      if (layer.endsWith('.Fab')) for (const p of shapePoints(s)) grow(local.Fab, toLocal(p));
    }
  }
  if (courtyard.length) {
    fp.outline = closedLoop(courtyard) ?? convexHull(courtyard.flatMap(shapePoints));
    fp.outlineFrom = 'courtyard';
  } else {
    const from = (['Fab', 'pads'] as const).find((g) => Number.isFinite(local[g].x0));
    if (from) {
      const b = local[from];
      fp.outline = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }].map(tf);
      fp.outlineFrom = from === 'Fab' ? 'fab' : 'pads';
    }
  }
  if (!fp.ref || fp.ref.includes('*')) fp.ref = `footprint ${fp.uuid.slice(0, 8)}`;
  fp.box = boxOf(fp.outline.length ? fp.outline : [fp.pos]);
  return fp;
}

export function readBoard(src: string): Board {
  const root = parseSexpr(src);
  if (root?.[0] !== 'kicad_pcb') throw new Error('not a kicad_pcb file');
  // copper layers in stack order: F, In1.., B
  const rank = (l: string) => (l === 'F.Cu' ? 0 : l === 'B.Cu' ? 99 : Number(l.match(/In(\d+)/)?.[1] ?? 50));
  const copper = (kid(root, 'layers')!.slice(1) as Node[])
    .map((l) => l[1] as string).filter((l) => l.endsWith('.Cu')).sort((a, b) => rank(a) - rank(b));
  const stack = (kid(kid(root, 'setup') ?? [], 'stackup') ?? []) as Node;
  const topCopper = kids(stack, 'layer').find((l) => l[1] === 'F.Cu');
  const board: Board = {
    copper, footprints: [], tracks: [], vias: [], zones: [], graphics: [], box: emptyBox(), nets: [], warnings: [],
    thickness: num(kid(root, 'general') ?? [], 'thickness', 1.6), copperUm: Math.round(num(topCopper ?? [], 'thickness', 0.035) * 1000),
  };
  const nets = new Set<string>();
  for (let i = 1; i < root.length; i++) {
    const n = root[i] as Node;
    const head = n[0] as string;
    if (head === 'footprint') {
      board.footprints.push(parseFootprint(n, copper, board));
    } else if (head === 'segment' || head === 'arc') {
      const a = pt(kid(n, 'start')), b = pt(kid(n, 'end'));
      const mid = head === 'arc' ? pt(kid(n, 'mid')) : null;
      const arc = mid ? arcFrom3(a, mid, b) : null;
      const w = num(n, 'width');
      board.tracks.push({
        type: 'track', a, b, mid, arc, w, layer: str(n, 'layer')!, net: netOf(n), uuid: str(n, 'uuid') ?? '',
        box: boxOf(arc ? arcPoints(arc) : [a, b], w / 2),
      });
    } else if (head === 'via') {
      const pos = pt(kid(n, 'at'));
      const size = num(n, 'size');
      const ls = kid(n, 'layers')!.slice(1) as string[];
      const i0 = copper.indexOf(ls[0]), i1 = copper.indexOf(ls[1]);
      board.vias.push({
        type: 'via', pos, size, drill: num(n, 'drill'), layers: [ls[0], ls[1]],
        span: copper.slice(Math.min(i0, i1), Math.max(i0, i1) + 1),
        kind: typeof n[1] === 'string' ? n[1] : 'through', net: netOf(n), uuid: str(n, 'uuid') ?? '', box: boxOf([pos], size / 2),
      });
    } else if (head === 'zone') {
      const single = str(n, 'layer');
      const layers = single ? [single] : ((kid(n, 'layers')?.slice(1) ?? []) as string[]);
      const poly = kid(n, 'polygon');
      const outline = poly ? ptsOf(poly) : [];
      const fills = kids(n, 'filled_polygon').map((f) => {
        const pts = ptsOf(f);
        return { layer: str(f, 'layer')!, pts, box: boxOf(pts) };
      });
      board.zones.push({
        type: 'zone', name: str(n, 'name') ?? '', net: netOf(n), uuid: str(n, 'uuid') ?? '', layers: copperLayers(layers, copper),
        priority: num(n, 'priority'), teardrop: !!kid(kid(n, 'attr') ?? [], 'teardrop'), keepout: !!kid(n, 'keepout'),
        outline, fills, box: boxOf(outline),
      });
    } else if (head.startsWith('gr_') && head !== 'gr_text') {
      const s = graphic(n, head.slice(3), (p) => p);
      if (s) board.graphics.push({ layer: str(n, 'layer') ?? '', shape: s });
      else board.warnings.push(`${head} ignored`);
    }
  }
  for (const fp of board.footprints) for (const p of fp.pads) if (p.net) nets.add(p.net);
  for (const t of board.tracks) if (t.net) nets.add(t.net);
  board.nets = [...nets].sort();
  // Edge.Cuts can live on the board or inside footprints.
  const edges = [...board.graphics, ...board.footprints.flatMap((f) => f.graphics)].filter((g) => g.layer === 'Edge.Cuts');
  for (const g of edges) for (const p of shapePoints(g.shape)) grow(board.box, p);
  if (!Number.isFinite(board.box.x0)) {
    for (const f of board.footprints) { grow(board.box, { x: f.box.x0, y: f.box.y0 }); grow(board.box, { x: f.box.x1, y: f.box.y1 }); }
    board.warnings.push('no Edge.Cuts outline');
  }
  return board;
}
