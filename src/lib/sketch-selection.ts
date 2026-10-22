import type { Pt, Shape } from '../types';
import { shapeBounds } from './shapes';

export type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Handle =
  | 'nw'
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w';

export const HANDLES: Handle[] = [
  'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
];

export const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

export function boxBetween(a: Pt, b: Pt): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function selectionBox(shapes: Shape[]): Box | null {
  if (!shapes.length) return null;

  const boxes = shapes.map(shapeBounds);
  const x = Math.min(...boxes.map(b => b.x));
  const y = Math.min(...boxes.map(b => b.y));

  return {
    x,
    y,
    w: Math.max(...boxes.map(b => b.x + b.w)) - x,
    h: Math.max(...boxes.map(b => b.y + b.h)) - y,
  };
}

export function contained(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function handlePoint(box: Box, handle: Handle): Pt {
  return {
    x: handle.includes('w')
      ? box.x
      : handle.includes('e')
        ? box.x + box.w
        : box.x + box.w / 2,
    y: handle.includes('n')
      ? box.y
      : handle.includes('s')
        ? box.y + box.h
        : box.y + box.h / 2,
  };
}

export function handleAt(
  box: Box,
  p: Pt,
  tolerance: number,
): Handle | null {
  for (const handle of HANDLES) {
    const q = handlePoint(box, handle);

    if (Math.hypot(q.x - p.x, q.y - p.y) <= tolerance) {
      return handle;
    }
  }

  if (
    p.x >= box.x - tolerance &&
    p.x <= box.x + box.w + tolerance
  ) {
    if (Math.abs(p.y - box.y) <= tolerance) return 'n';
    if (Math.abs(p.y - box.y - box.h) <= tolerance) return 's';
  }

  if (
    p.y >= box.y - tolerance &&
    p.y <= box.y + box.h + tolerance
  ) {
    if (Math.abs(p.x - box.x) <= tolerance) return 'w';
    if (Math.abs(p.x - box.x - box.w) <= tolerance) return 'e';
  }

  return null;
}

export function resizedBox(
  box: Box,
  handle: Handle,
  delta: Pt,
  lockAspect = false,
): Box {
  const minimum = 4;

  let w = Math.max(
    minimum,
    box.w + (
      handle.includes('e')
        ? delta.x
        : handle.includes('w')
          ? -delta.x
          : 0
    ),
  );

  let h = Math.max(
    minimum,
    box.h + (
      handle.includes('s')
        ? delta.y
        : handle.includes('n')
          ? -delta.y
          : 0
    ),
  );

  if (lockAspect && box.w > 0 && box.h > 0) {
    let factor =
      handle === 'n' || handle === 's'
        ? h / box.h
        : handle === 'e' || handle === 'w'
          ? w / box.w
          : Math.abs(w / box.w - 1) >= Math.abs(h / box.h - 1)
            ? w / box.w
            : h / box.h;

    factor = Math.max(
      factor,
      minimum / box.w,
      minimum / box.h,
    );

    w = box.w * factor;
    h = box.h * factor;
  }

  return {
    x: handle.includes('w')
      ? box.x + box.w - w
      : lockAspect && (handle === 'n' || handle === 's')
        ? box.x + (box.w - w) / 2
        : box.x,

    y: handle.includes('n')
      ? box.y + box.h - h
      : lockAspect && (handle === 'e' || handle === 'w')
        ? box.y + (box.h - h) / 2
        : box.y,

    w,
    h,
  };
}

export function scaleShape(
  shape: Shape,
  from: Box,
  to: Box,
): Shape {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;

  const point = (p: Pt): Pt => ({
    x: to.x + (p.x - from.x) * sx,
    y: to.y + (p.y - from.y) * sy,
  });

  switch (shape.kind) {
    case 'path':
    case 'polygon':
      return {
        ...shape,
        points: shape.points.map(point),
      };

    case 'line':
    case 'arrow':
      return {
        ...shape,
        a: point(shape.a),
        b: point(shape.b),
      };

    case 'rect':
    case 'ellipse':
      return {
        ...shape,
        ...point(shape),
        w: shape.w * sx,
        h: shape.h * sy,
      };

    case 'text':
      return {
        ...shape,
        ...point(shape),
        size: shape.size * sx,
      };
  }
}
