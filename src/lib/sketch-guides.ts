import type { Pt } from '../types';
import type { Box, Handle } from './sketch-selection';

/**
 * Smart guides: snap a moving box to other shapes' edges and centres,
 * and to equal spacing between neighbours. Pure functions; the editor
 * renders the returned guide segments.
 */

export type Guide =
  | { type: 'align'; axis: 'x' | 'y'; at: number; from: number; to: number }
  | { type: 'gap'; axis: 'x' | 'y'; at: number; from: number; to: number };

type Axis = 'x' | 'y';

const span = (b: Box, axis: Axis) =>
  axis === 'x' ? { s: b.x, z: b.w, cs: b.y, cz: b.h } : { s: b.y, z: b.h, cs: b.x, cz: b.w };

const linesOf = (b: Box, axis: Axis) => {
  const { s, z } = span(b, axis);
  return [s, s + z / 2, s + z];
};

const EPS = 0.5;

/** Best offset that brings one of `values` onto a target line, within threshold. */
function nearestLine(values: number[], targets: Box[], axis: Axis, threshold: number) {
  let best: number | null = null;

  for (const t of targets) {
    for (const line of linesOf(t, axis)) {
      for (const v of values) {
        const d = line - v;
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
    }
  }

  return best;
}

/** Guide segments for every moving line that now sits on a target line. */
function alignGuides(box: Box, targets: Box[], axis: Axis, values: number[]): Guide[] {
  const guides: Guide[] = [];
  const me = span(box, axis);

  for (const v of values) {
    let from = me.cs;
    let to = me.cs + me.cz;
    let hit = false;

    for (const t of targets) {
      if (!linesOf(t, axis).some(line => Math.abs(line - v) < EPS)) continue;
      const o = span(t, axis);
      from = Math.min(from, o.cs);
      to = Math.max(to, o.cs + o.cz);
      hit = true;
    }

    if (hit) guides.push({ type: 'align', axis, at: v, from, to });
  }

  return guides;
}

/** Targets that overlap the box on the cross axis (same row / column). */
const inBand = (box: Box, targets: Box[], axis: Axis) => {
  const me = span(box, axis);
  return targets.filter(t => {
    const o = span(t, axis);
    return o.cs < me.cs + me.cz && o.cs + o.cz > me.cs;
  });
};

/** Offset along `axis` that makes the gaps to neighbours equal, or match an existing gap. */
function spacingSnap(box: Box, targets: Box[], axis: Axis, threshold: number) {
  const me = span(box, axis);
  const row = inBand(box, targets, axis).map(t => span(t, axis));
  const before = row.filter(o => o.s + o.z <= me.s + me.z / 2).sort((a, b) => b.s + b.z - (a.s + a.z))[0];
  const after = row.filter(o => o.s >= me.s + me.z / 2).sort((a, b) => a.s - b.s)[0];

  const candidates: number[] = [];

  if (before && after) {
    candidates.push((before.s + before.z + after.s - me.z) / 2 - me.s);
  }

  // Gaps already used between consecutive neighbours in this band.
  const sorted = row.slice().sort((a, b) => a.s - b.s);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i].s - (sorted[i - 1].s + sorted[i - 1].z);
    if (g > 0) gaps.push(g);
  }

  for (const g of gaps) {
    if (before) candidates.push(before.s + before.z + g - me.s);
    if (after) candidates.push(after.s - g - me.z - me.s);
  }

  let best: number | null = null;
  for (const d of candidates) {
    if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }

  return best;
}

/** Gap markers for equal spacing after the box has been placed. */
function gapGuides(box: Box, targets: Box[], axis: Axis): Guide[] {
  const me = span(box, axis);
  const row = inBand(box, targets, axis).map(t => span(t, axis)).sort((a, b) => a.s - b.s);
  const before = row.filter(o => o.s + o.z <= me.s + EPS).at(-1);
  const after = row.find(o => o.s >= me.s + me.z - EPS);

  const gapBefore = before ? me.s - (before.s + before.z) : null;
  const gapAfter = after ? after.s - (me.s + me.z) : null;
  const gap = gapBefore ?? gapAfter;
  if (gap === null || gap <= 0) return [];

  const at = me.cs + me.cz / 2;
  const guides: Guide[] = [];
  const mark = (from: number, to: number, cross: number) =>
    guides.push({ type: 'gap', axis, at: cross, from, to });

  // Mark every gap in the band equal to the box's gap.
  const all = [...row, me].sort((a, b) => a.s - b.s);
  for (let i = 1; i < all.length; i++) {
    const g = all[i].s - (all[i - 1].s + all[i - 1].z);
    if (Math.abs(g - gap) < EPS) {
      const crossTop = Math.max(all[i].cs, all[i - 1].cs);
      const crossBottom = Math.min(all[i].cs + all[i].cz, all[i - 1].cs + all[i - 1].cz);
      mark(all[i - 1].s + all[i - 1].z, all[i].s, crossTop < crossBottom ? (crossTop + crossBottom) / 2 : at);
    }
  }

  return guides.length >= 2 ? guides : [];
}

const shift = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy });

/** Snap a moving box. Returns the extra offset to apply and the guides to draw. */
export function snapMove(box: Box, targets: Box[], threshold: number) {
  let dx = nearestLine(linesOf(box, 'x'), targets, 'x', threshold);
  let dy = nearestLine(linesOf(box, 'y'), targets, 'y', threshold);

  // Equal spacing only when no edge/centre alignment applies on that axis.
  const spaceX = dx === null ? spacingSnap(shift(box, 0, dy ?? 0), targets, 'x', threshold) : null;
  const spaceY = dy === null ? spacingSnap(shift(box, dx ?? 0, 0), targets, 'y', threshold) : null;

  dx = dx ?? spaceX ?? 0;
  dy = dy ?? spaceY ?? 0;

  const placed = shift(box, dx, dy);
  const guides = [
    ...alignGuides(placed, targets, 'x', linesOf(placed, 'x')),
    ...alignGuides(placed, targets, 'y', linesOf(placed, 'y')),
    ...(spaceX !== null ? gapGuides(placed, targets, 'x') : []),
    ...(spaceY !== null ? gapGuides(placed, targets, 'y') : []),
  ];

  return { dx, dy, guides };
}

/** Snap only the edges a resize handle moves. */
export function snapResize(box: Box, handle: Handle, targets: Box[], threshold: number) {
  const out = { ...box };
  const movedX: number[] = [];
  const movedY: number[] = [];

  if (handle.includes('e')) {
    const d = nearestLine([box.x + box.w], targets, 'x', threshold);
    if (d !== null) out.w = Math.max(4, box.w + d);
    movedX.push(out.x + out.w);
  } else if (handle.includes('w')) {
    const d = nearestLine([box.x], targets, 'x', threshold);
    if (d !== null && box.w - d >= 4) {
      out.x = box.x + d;
      out.w = box.w - d;
    }
    movedX.push(out.x);
  }

  if (handle.includes('s')) {
    const d = nearestLine([box.y + box.h], targets, 'y', threshold);
    if (d !== null) out.h = Math.max(4, box.h + d);
    movedY.push(out.y + out.h);
  } else if (handle.includes('n')) {
    const d = nearestLine([box.y], targets, 'y', threshold);
    if (d !== null && box.h - d >= 4) {
      out.y = box.y + d;
      out.h = box.h - d;
    }
    movedY.push(out.y);
  }

  return {
    box: out,
    guides: [
      ...alignGuides(out, targets, 'x', movedX),
      ...alignGuides(out, targets, 'y', movedY),
    ],
  };
}

/** Snap a single point (e.g. the corner of a rectangle being drawn). */
export function snapPoint(p: Pt, targets: Box[], threshold: number) {
  const dx = nearestLine([p.x], targets, 'x', threshold) ?? 0;
  const dy = nearestLine([p.y], targets, 'y', threshold) ?? 0;
  const q = { x: p.x + dx, y: p.y + dy };
  const dot: Box = { x: q.x, y: q.y, w: 0, h: 0 };

  return {
    point: q,
    guides: [
      ...alignGuides(dot, targets, 'x', [q.x]),
      ...alignGuides(dot, targets, 'y', [q.y]),
    ],
  };
}
