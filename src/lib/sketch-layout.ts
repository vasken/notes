import type { Binding, Pt, Shape } from '../types';
import { anchorsOf, dist, hitTest, outline, shapeBounds, translate } from './shapes';
import { uid } from './util';

/**
 * Relationships between shapes: labels that belong to a host shape and
 * connector ends bound to a host. Stored shapes always hold resolved
 * coordinates; resolveLayout() recomputes them after every change.
 */

export type TextShape = Extract<Shape, { kind: 'text' }>;
export type Connector = Extract<Shape, { kind: 'line' | 'arrow' }>;
export type HostShape = Extract<Shape, { kind: 'rect' | 'ellipse' | 'polygon' }>;

/** Shapes connector ends can attach to. */
export const isHost = (s: Shape): s is HostShape =>
  s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'polygon';

export const isConnector = (s: Shape): s is Connector =>
  s.kind === 'line' || s.kind === 'arrow';

/** Shapes that can carry a label. */
export const canHaveLabel = (s: Shape) => isHost(s) || isConnector(s);

export const isLabel = (s: Shape): s is TextShape & { labelFor: string } =>
  s.kind === 'text' && Boolean(s.labelFor);

export const isFloating = (b: Binding) => b.fx === 0.5 && b.fy === 0.5;

const GAP = 3;

const centerOf = (s: Shape): Pt => {
  const b = shapeBounds(s);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
};

function fixedPoint(host: Shape, b: Binding): Pt {
  const box = shapeBounds(host);
  return { x: box.x + b.fx * box.w, y: box.y + b.fy * box.h };
}

/** Where the ray from c towards `toward` leaves the host's outline. */
function edgePoint(host: Shape, toward: Pt, gap: number): Pt {
  const c = centerOf(host);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return c;

  const ring = outline(host);
  let best = Infinity;

  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;

    const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / den;
    const u = ((a.x - c.x) * dy - (a.y - c.y) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }

  if (!Number.isFinite(best)) return c;

  const ux = dx / len;
  const uy = dy / len;
  const edge = { x: c.x + dx * best, y: c.y + dy * best };
  return { x: edge.x + ux * gap, y: edge.y + uy * gap };
}

/** Where a label sits on its host (top-left y, centre x). */
export function labelPlacement(host: Shape, size: number): Pt {
  if (isConnector(host)) {
    const mid = { x: (host.a.x + host.b.x) / 2, y: (host.a.y + host.b.y) / 2 };
    return { x: mid.x, y: mid.y - (size * 0.8 + 8) - (size * 1.1) / 2 };
  }

  const c = centerOf(host);
  return { x: c.x, y: c.y - (size * 1.1) / 2 };
}

function resolveConnector(s: Connector, byId: Map<string, Shape>): Connector {
  let from = s.from;
  let to = s.to;

  const hostOf = (b?: Binding) => {
    if (!b) return undefined;
    const host = byId.get(b.id);
    return host && isHost(host) ? host : undefined;
  };

  let fromHost = hostOf(from);
  let toHost = hostOf(to);
  if (!fromHost) from = undefined;
  if (!toHost) to = undefined;

  // Both ends floating on one shape would collapse to its centre.
  if (from && to && from.id === to.id && isFloating(from) && isFloating(to)) {
    to = undefined;
    toHost = undefined;
  }

  if (!from && !to) {
    if (!s.from && !s.to) return s;
    const { from: _f, to: _t, ...rest } = s;
    return rest;
  }

  // Aim points: what each floating end points towards.
  const aimFrom = to && toHost
    ? isFloating(to) ? centerOf(toHost) : fixedPoint(toHost, to)
    : s.b;
  const aimTo = from && fromHost
    ? isFloating(from) ? centerOf(fromHost) : fixedPoint(fromHost, from)
    : s.a;

  const gap = GAP + s.width / 2;

  const a = from && fromHost
    ? isFloating(from) ? edgePoint(fromHost, aimFrom, gap) : fixedPoint(fromHost, from)
    : s.a;
  const b = to && toHost
    ? isFloating(to) ? edgePoint(toHost, aimTo, gap) : fixedPoint(toHost, to)
    : s.b;

  const next: Connector = { ...s, a, b };
  if (from) next.from = from; else delete next.from;
  if (to) next.to = to; else delete next.to;
  return next;
}

/** Recompute bound connector ends and label positions; drop dangling references. */
export function resolveLayout(shapes: Shape[]): Shape[] {
  const byId = new Map(shapes.map(s => [s.id, s] as const));
  let changed = false;

  for (const s of shapes) {
    if (isConnector(s) && (s.from || s.to)) {
      const next = resolveConnector(s, byId);
      if (next !== s) {
        byId.set(s.id, next);
        changed = true;
      }
    }
  }

  for (const s of shapes) {
    if (s.kind !== 'text' || !s.labelFor) continue;

    const host = byId.get(s.labelFor);

    if (!host || !canHaveLabel(host)) {
      const { labelFor: _l, ...rest } = s;
      byId.set(s.id, rest);
      changed = true;
      continue;
    }

    const p = labelPlacement(host, s.size);

    if (s.x !== p.x || s.y !== p.y || s.align !== 'center') {
      byId.set(s.id, { ...s, x: p.x, y: p.y, align: 'center' });
      changed = true;
    }
  }

  return changed ? shapes.map(s => byId.get(s.id)!) : shapes;
}

/** Ids plus the labels that belong to them. */
export function withLabels(shapes: Shape[], ids: Set<string>): Set<string> {
  const out = new Set(ids);
  for (const s of shapes) if (isLabel(s) && ids.has(s.labelFor)) out.add(s.id);
  return out;
}

/** Remove shapes and their labels; connectors bound to removed shapes stay where they are. */
export function removeShapes(shapes: Shape[], ids: Iterable<string>): Shape[] {
  const removed = withLabels(shapes, new Set(ids));

  return shapes
    .filter(s => !removed.has(s.id))
    .map(s => {
      if (!isConnector(s)) return s;
      const dropFrom = s.from && removed.has(s.from.id);
      const dropTo = s.to && removed.has(s.to.id);
      if (!dropFrom && !dropTo) return s;
      const next = { ...s };
      if (dropFrom) delete next.from;
      if (dropTo) delete next.to;
      return next;
    });
}

/** Drop references to shapes outside `keep`: used when moving part of a group. */
export function detachFrom(s: Shape, keep: Set<string>): Shape {
  if (isConnector(s)) {
    const dropFrom = s.from && !keep.has(s.from.id);
    const dropTo = s.to && !keep.has(s.to.id);
    if (!dropFrom && !dropTo) return s;
    const next = { ...s };
    if (dropFrom) delete next.from;
    if (dropTo) delete next.to;
    return next;
  }

  if (s.kind === 'text' && s.labelFor && !keep.has(s.labelFor)) {
    const { labelFor: _l, ...rest } = s;
    return rest;
  }

  return s;
}

/** Copy shapes with fresh ids; references inside the set are remapped, others dropped. */
export function cloneShapes(shapes: Shape[], offset: Pt = { x: 0, y: 0 }): Shape[] {
  const ids = new Map(shapes.map(s => [s.id, uid()] as const));

  const remap = (b?: Binding): Binding | undefined => {
    const id = b && ids.get(b.id);
    return b && id ? { ...b, id } : undefined;
  };

  return shapes.map(s => {
    const moved = translate(structuredClone(s), offset.x, offset.y);
    const next = { ...moved, id: ids.get(s.id)! } as Shape;

    if (isConnector(next)) {
      const from = remap(next.from);
      const to = remap(next.to);
      if (from) next.from = from; else delete next.from;
      if (to) next.to = to; else delete next.to;
    }

    if (next.kind === 'text' && next.labelFor) {
      const host = ids.get(next.labelFor);
      if (host) next.labelFor = host; else delete next.labelFor;
    }

    return next;
  });
}

/** Fixed binding at a snapped anchor, floating when the point is the centre. */
export function bindingFor(host: HostShape, p: Pt): Binding {
  const b = shapeBounds(host);
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const isAnchor = anchorsOf(host).some(q => dist(q, p) < 0.5);

  if (!isAnchor || dist(c, p) < 0.5 || b.w <= 0 || b.h <= 0) {
    return { id: host.id, fx: 0.5, fy: 0.5 };
  }

  return { id: host.id, fx: (p.x - b.x) / b.w, fy: (p.y - b.y) / b.h };
}

/**
 * Host a free connector end dropped at p should float-attach to.
 * Picks the smallest containing shape; a container that holds other
 * shapes only binds when the point is close to its edge.
 */
export function hostAt(shapes: Shape[], p: Pt, edgeTolerance: number): HostShape | null {
  const hosts = shapes.filter(isHost);
  const containing = hosts
    .filter(s => hitTest(s, p, 0, true))
    .map(s => ({ s, b: shapeBounds(s) }))
    .sort((x, y) => x.b.w * x.b.h - y.b.w * y.b.h);

  const smallest = containing[0];
  if (!smallest) return null;

  if (hitTest(smallest.s, p, edgeTolerance)) return smallest.s;

  const { b } = smallest;
  const holdsOthers = hosts.some(o => {
    if (o.id === smallest.s.id) return false;
    const ob = shapeBounds(o);
    return ob.x >= b.x && ob.y >= b.y && ob.x + ob.w <= b.x + b.w && ob.y + ob.h <= b.y + b.h;
  });

  return holdsOthers ? null : smallest.s;
}

/**
 * Attach free texts in the selection to selected shapes: each text goes to the
 * smallest selected shape containing its centre, or to the only shape when the
 * selection is one shape plus one text. Replaced labels become free text.
 */
export function attachTexts(shapes: Shape[], selected: Set<string>): { shapes: Shape[]; count: number } {
  const chosen = shapes.filter(s => selected.has(s.id));
  const texts = chosen.filter((s): s is TextShape => s.kind === 'text' && !s.labelFor);
  const hosts = chosen.filter(canHaveLabel);
  const pairs = new Map<string, string>(); // text id -> host id
  const taken = new Set<string>();

  for (const t of texts) {
    const c = centerOf(t);
    const host = hosts
      .filter(h => !taken.has(h.id) && isHost(h) && hitTest(h, c, 0, true))
      .sort((x, y) => {
        const a = shapeBounds(x), b = shapeBounds(y);
        return a.w * a.h - b.w * b.h;
      })[0];

    if (host) {
      pairs.set(t.id, host.id);
      taken.add(host.id);
    }
  }

  if (!pairs.size && texts.length === 1 && hosts.length === 1) {
    pairs.set(texts[0].id, hosts[0].id);
    taken.add(hosts[0].id);
  }

  if (!pairs.size) return { shapes, count: 0 };

  const next = shapes.map(s => {
    if (s.kind !== 'text') return s;
    const host = pairs.get(s.id);
    if (host) return { ...s, labelFor: host, align: 'center' as const };
    if (s.labelFor && taken.has(s.labelFor)) {
      const { labelFor: _l, ...rest } = s;
      return rest;
    }
    return s;
  });

  return { shapes: resolveLayout(next), count: pairs.size };
}

/** Turn labels of `ids` (or labels in `ids`) back into free text, leaving them in place. */
export function detachLabels(shapes: Shape[], ids: Set<string>): Shape[] {
  return shapes.map(s => {
    if (s.kind !== 'text' || !s.labelFor) return s;
    if (!ids.has(s.id) && !ids.has(s.labelFor)) return s;
    const { labelFor: _l, ...rest } = s;
    return rest;
  });
}
