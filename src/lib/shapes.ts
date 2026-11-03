import type { Pt, Shape } from '../types';

// ---------- basic geometry ----------
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);

export function pathLength(pts: Pt[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

export function bounds(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker simplification. */
export function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

/** Resample a stroke to n evenly spaced points (removes drawing-speed bias). */
export function resample(pts: Pt[], n: number): Pt[] {
  const L = pathLength(pts);
  if (L === 0 || pts.length < 2) return pts.slice();
  const step = L / (n - 1);
  const out: Pt[] = [pts[0]];
  let acc = 0;
  const src = pts.slice();
  for (let i = 1; i < src.length; i++) {
    const d = dist(src[i - 1], src[i]);
    if (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = { x: src[i - 1].x + t * (src[i].x - src[i - 1].x), y: src[i - 1].y + t * (src[i].y - src[i - 1].y) };
      out.push(q);
      src.splice(i, 0, q);
      acc = 0;
    } else acc += d;
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out.slice(0, n);
}

/** Angle in degrees by which the path turns at c (0 = straight on). */
function turnAngle(p: Pt, c: Pt, n: Pt) {
  const a1 = Math.atan2(c.y - p.y, c.x - p.x);
  const a2 = Math.atan2(n.y - c.y, n.x - c.x);
  let d = Math.abs(a2 - a1) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

// ---------- angle snapping ----------
/** Snap b around a. `step` in degrees; `tolerance` = only snap if within that many degrees. */
export function snapAngle(a: Pt, b: Pt, step = 15, tolerance = 360): Pt {
  const len = dist(a, b);
  const ang = Math.atan2(b.y - a.y, b.x - a.x) * (180 / Math.PI);
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(snapped - ang) > tolerance) return b;
  const r = (snapped * Math.PI) / 180;
  return { x: a.x + Math.cos(r) * len, y: a.y + Math.sin(r) * len };
}

/** Gentle assist: snap to 0/45/90… only when the user is already close. */
export const softSnap = (a: Pt, b: Pt) => snapAngle(a, b, 45, 6);

// ---------- shape recognition ----------
export type Geometry =
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'rect' | 'ellipse'; x: number; y: number; w: number; h: number }
  | { kind: 'polygon'; points: Pt[] };

function closedCorners(pts: Pt[], diag: number): Pt[] {
  const eps = 0.07 * diag;
  // split the ring at the point farthest from the start so RDP works on two open halves
  let far = 0, fd = 0;
  pts.forEach((p, i) => { const d = dist(p, pts[0]); if (d > fd) { fd = d; far = i; } });
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp([...pts.slice(far), pts[0]], eps);
  const poly = [...a.slice(0, -1), ...b.slice(0, -1)];
  // drop near-collinear and crowded vertices (with wrap-around)
  let changed = true;
  while (changed && poly.length > 3) {
    changed = false;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[(i - 1 + n) % n], c = poly[i], nx = poly[(i + 1) % n];
      if (turnAngle(p, c, nx) < 28 || dist(p, c) < 0.12 * diag) {
        poly.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return poly;
}

/** Four detected corners that each sit close to a distinct bounding-box corner → wobbly rectangle. */
function nearBoxCorners(corners: Pt[], b: { x: number; y: number; w: number; h: number }, diag: number) {
  if (corners.length !== 4) return false;
  const box = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
  return box.every((c) => corners.some((k) => dist(k, c) < 0.15 * diag));
}

/**
 * Turn a freehand stroke into a clean shape when it is confidently a
 * line, rectangle, ellipse/circle, triangle or simple polygon.
 */
export function recognize(raw: Pt[]): { geom: Geometry; label: string } | null {
  if (raw.length < 4) return null;
  const L0 = pathLength(raw);
  const b = bounds(raw);
  const diag = Math.hypot(b.w, b.h);
  if (diag < 12 || L0 < 12) return null;
  const pts = resample(raw, 72);
  const first = pts[0], last = pts[pts.length - 1];
  const gap = dist(first, last);

  // straight line
  if (gap / L0 > 0.93) return { geom: { kind: 'line', a: first, b: softSnap(first, last) }, label: 'Line' };

  const closed = gap < Math.max(0.22 * diag, 14) && L0 > 1.6 * diag;
  if (!closed) return null;
  if (Math.min(b.w, b.h) < 0.12 * Math.max(b.w, b.h)) return null; // too thin to judge

  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2;
  const ellErr = mean(pts.map((p) => Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1)));
  const m = Math.min(b.w, b.h) / 2;
  const rectErr = mean(
    pts.map((p) => Math.min(Math.abs(p.x - b.x), Math.abs(p.x - b.x - b.w), Math.abs(p.y - b.y), Math.abs(p.y - b.y - b.h)) / m),
  );
  const corners = closedCorners(pts, diag);

  if (corners.length === 3 && ellErr > 0.08) return { geom: { kind: 'polygon', points: corners }, label: 'Triangle' };

  if (ellErr < 0.11 && ellErr <= rectErr) {
    const aspect = Math.min(b.w, b.h) / Math.max(b.w, b.h);
    if (aspect > 0.85) {
      const r = (b.w + b.h) / 4;
      return { geom: { kind: 'ellipse', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, label: 'Circle' };
    }
    return { geom: { kind: 'ellipse', ...b }, label: 'Ellipse' };
  }
  if (rectErr < 0.09 || nearBoxCorners(corners, b, diag)) return { geom: { kind: 'rect', ...b }, label: 'Rectangle' };
  if (corners.length >= 3 && corners.length <= 6) return { geom: { kind: 'polygon', points: corners }, label: 'Polygon' };
  return null;
}

// ---------- rendering helpers ----------
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Smooth polyline through midpoints with quadratic curves. */
export function smoothPath(pts: Pt[]): string {
  if (pts.length === 0) return '';
  if (pts.length < 3) {
    const a = pts[0], b = pts[pts.length - 1];
    return `M${r1(a.x)} ${r1(a.y)}L${r1(b.x + 0.01)} ${r1(b.y)}`;
  }
  let d = `M${r1(pts[0].x)} ${r1(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i], n = pts[i + 1];
    d += `Q${r1(c.x)} ${r1(c.y)} ${r1((c.x + n.x) / 2)} ${r1((c.y + n.y) / 2)}`;
  }
  const l = pts[pts.length - 1];
  return d + `L${r1(l.x)} ${r1(l.y)}`;
}

export function arrowHead(a: Pt, b: Pt, width: number): string {
  const len = Math.max(12, width * 4);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const spread = (28 * Math.PI) / 180;
  const p1 = { x: b.x - len * Math.cos(ang - spread), y: b.y - len * Math.sin(ang - spread) };
  const p2 = { x: b.x - len * Math.cos(ang + spread), y: b.y - len * Math.sin(ang + spread) };
  return `M${r1(p1.x)} ${r1(p1.y)}L${r1(b.x)} ${r1(b.y)}L${r1(p2.x)} ${r1(p2.y)}`;
}

/** Light simplification + rounding for storage. */
export const compactStroke = (pts: Pt[]) => rdp(pts, 0.6).map((p) => ({ x: r1(p.x), y: r1(p.y) }));

// ---------- shape utilities ----------
export function textWidth(text: string, size: number) {
  return Math.max(8, text.length * size * 0.56);
}

export function textBox(s: Extract<Shape, { kind: 'text' }>) {
  const w = textWidth(s.text, s.size);
  return { x: s.align === 'center' ? s.x - w / 2 : s.x, y: s.y, w, h: s.size * 1.1 };
}

export function outline(s: Shape): Pt[] {
  switch (s.kind) {
    case 'path': return s.points;
    case 'line':
    case 'arrow': return [s.a, s.b];
    case 'polygon': return [...s.points, s.points[0]];
    case 'rect': return [
      { x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }, { x: s.x, y: s.y },
    ];
    case 'ellipse': {
      const out: Pt[] = [];
      for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        out.push({ x: s.x + s.w / 2 + (Math.cos(t) * s.w) / 2, y: s.y + s.h / 2 + (Math.sin(t) * s.h) / 2 });
      }
      return out;
    }
    case 'text': {
      const b = textBox(s);
      return [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }, { x: b.x, y: b.y }];
    }
  }
}

export function shapeBounds(s: Shape) {
  return bounds(outline(s));
}

/** Points other shapes' endpoints can snap to. */
export function anchorsOf(s: Shape): Pt[] {
  switch (s.kind) {
    case 'line':
    case 'arrow': return [s.a, s.b];
    case 'polygon': return s.points;
    case 'path': return [s.points[0], s.points[s.points.length - 1]];
    case 'text': return [];
    case 'rect':
    case 'ellipse': {
      const { x, y, w, h } = s;
      const mids = [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }, { x: x + w / 2, y: y + h / 2 }];
      return s.kind === 'rect' ? [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, ...mids] : mids;
    }
  }
}

export function hitTest(s: Shape, p: Pt, tol: number, inside = false): boolean {
  if (inside && s.kind !== 'line' && s.kind !== 'arrow' && s.kind !== 'path') {
    const b = shapeBounds(s);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return true;
  }
  if (s.kind === 'text') {
    const b = textBox(s);
    return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  }
  const o = outline(s);
  const t = tol + s.width / 2;
  if (o.length === 1) return dist(p, o[0]) <= t;
  for (let i = 1; i < o.length; i++) if (segDist(p, o[i - 1], o[i]) <= t) return true;
  return false;
}

export function translate(s: Shape, dx: number, dy: number): Shape {
  const mv = (q: Pt) => ({ x: q.x + dx, y: q.y + dy });
  switch (s.kind) {
    case 'path':
    case 'polygon': return { ...s, points: s.points.map(mv) };
    case 'line':
    case 'arrow': return { ...s, a: mv(s.a), b: mv(s.b) };
    default: return { ...s, x: s.x + dx, y: s.y + dy };
  }
}

export function contentBounds(shapes: Shape[]) {
  if (!shapes.length) return null;
  const bs = shapes.map((s) => {
    const b = shapeBounds(s);
    const pad = s.width + (s.kind === 'arrow' ? s.width * 4 + 12 : 0);
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  });
  return bounds(bs.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }]));
}
