import type { Shape, Sketch } from '../types';
import {
  arrowHead,
  contentBounds,
  smoothPath,
} from '../lib/shapes';

export function ShapeEl({ s }: { s: Shape }) {
  const stroke = {
    stroke: s.color,
    strokeWidth: s.width,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const closed = {
    ...stroke,
    fill: s.fill ?? 'none',
  };

  switch (s.kind) {
    case 'path':
      return <path d={smoothPath(s.points)} {...stroke} />;

    case 'line':
      return (
        <line
          x1={s.a.x}
          y1={s.a.y}
          x2={s.b.x}
          y2={s.b.y}
          {...stroke}
        />
      );

    case 'arrow':
      return (
        <g>
          <line
            x1={s.a.x}
            y1={s.a.y}
            x2={s.b.x}
            y2={s.b.y}
            {...stroke}
          />
          <path
            d={arrowHead(s.a, s.b, s.width)}
            {...stroke}
          />
        </g>
      );

    case 'rect':
      return (
        <rect
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={6}
          {...closed}
        />
      );

    case 'ellipse':
      return (
        <ellipse
          cx={s.x + s.w / 2}
          cy={s.y + s.h / 2}
          rx={s.w / 2}
          ry={s.h / 2}
          {...closed}
        />
      );

    case 'polygon':
      return (
        <polygon
          points={s.points.map(p => `${p.x},${p.y}`).join(' ')}
          {...closed}
        />
      );

    case 'text':
      return (
        <text
          x={s.x}
          y={s.y + s.size * 0.82}
          fill={s.color}
          fontSize={s.size}
          fontWeight={500}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {s.text}
        </text>
      );
  }
}

export function SketchView({
  sketch,
  fit = true,
  className,
}: {
  sketch: Sketch;
  fit?: boolean;
  className?: string;
}) {
  const box = fit ? contentBounds(sketch.shapes) : null;
  const pad = 16;

  const viewBox = box
    ? `${box.x - pad} ${box.y - pad} ${Math.max(40, box.w + pad * 2)} ${Math.max(40, box.h + pad * 2)}`
    : `0 0 ${sketch.w} ${sketch.h}`;

  // Labels stay above filled shapes regardless of creation order.
  const ordered = [
    ...sketch.shapes.filter(s => s.kind !== 'text'),
    ...sketch.shapes.filter(s => s.kind === 'text'),
  ];

  return (
    <svg
      viewBox={viewBox}
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      {ordered.map(s => <ShapeEl key={s.id} s={s} />)}
    </svg>
  );
}
