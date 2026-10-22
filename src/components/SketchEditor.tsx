import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as PE,
} from 'react';

import {
  ArrowUpRight,
  Circle,
  Eraser,
  Grid3x3,
  MousePointer2,
  Pencil,
  Redo2,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
  Wand2,
} from 'lucide-react';

import { SKETCH_H, SKETCH_W, useStore } from '../store';
import type { Pt, Shape } from '../types';

import {
  anchorsOf,
  compactStroke,
  dist,
  hitTest,
  recognize,
  shapeBounds,
  snapAngle,
  softSnap,
  translate,
} from '../lib/shapes';

import {
  boxBetween,
  contained,
  CURSORS,
  HANDLES,
  handleAt,
  handlePoint,
  resizedBox,
  scaleShape,
  selectionBox,
  type Box,
  type Handle,
} from '../lib/sketch-selection';

import { cn, uid } from '../lib/util';
import { ShapeEl } from './SketchView';
import { Button, Separator } from './ui';

type Tool =
  | 'select'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'eraser';

const TOOLS = [
  ['select', MousePointer2, 'Select / box select (V)', 'v'],
  ['pen', Pencil, 'Pen (P)', 'p'],
  ['line', Slash, 'Line (L)', 'l'],
  ['arrow', ArrowUpRight, 'Arrow (A)', 'a'],
  ['rect', Square, 'Rectangle (R)', 'r'],
  ['ellipse', Circle, 'Ellipse (O)', 'o'],
  ['text', Type, 'Text (T)', 't'],
  ['eraser', Eraser, 'Eraser (E)', 'e'],
] as const;

const COLORS = [
  '#18181b',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
];

const FILL_COLORS = [
  '#e3e3e4',
  '#fde9e9',
  '#fef3e2',
  '#e2f5ee',
  '#e7effe',
  '#f0e9fe',
];

const COLOR_NAMES = [
  'Gray', 'Red', 'Amber', 'Green', 'Blue', 'Purple',
];

const WIDTHS = [2, 4, 8];
const GRID = 20;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 200;

type TextShape = Extract<Shape, { kind: 'text' }>;
type Connector = Extract<Shape, { kind: 'line' | 'arrow' }>;

type Transaction = {
  before: Shape[];
  start: Pt;
};

type Gesture =
  | (Transaction & {
      kind: 'draw';
      draft: Shape;
      points: Pt[];
    })
  | (Transaction & {
      kind: 'move';
      ids: Set<string>;
    })
  | (Transaction & {
      kind: 'resize';
      original: Shape;
      box: Box;
      handle: Handle;
    })
  | (Transaction & {
      kind: 'endpoint';
      original: Connector;
      end: 'a' | 'b';
    })
  | (Transaction & {
      kind: 'erase';
    })
  | (Transaction & {
      kind: 'marquee';
      base: Set<string>;
    });

type TextDraft = {
  shape: TextShape;
  existing: boolean;
  labelFor?: string;
  center?: Pt;
};

function isFillable(shape: Shape) {
  return (
    shape.kind === 'rect' ||
    shape.kind === 'ellipse' ||
    shape.kind === 'polygon'
  );
}

function orderedShapes(shapes: Shape[]) {
  return [
    ...shapes.filter(s => s.kind !== 'text'),
    ...shapes.filter(s => s.kind === 'text'),
  ];
}

export function SketchEditor({ id }: { id: string }) {
  const initial = useStore(s => s.sketches[id]);
  const saveSketch = useStore(s => s.saveSketch);
  const openSketch = useStore(s => s.openSketch);

  const [shapes, setShapes] = useState<Shape[]>(
    () => initial?.shapes ?? [],
  );
  const shapesRef = useRef(shapes);

  const undoRef = useRef<Shape[][]>([]);
  const redoRef = useRef<Shape[][]>([]);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });

  // Every diagram opens in Select mode.
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(4);

  const [assist, setAssist] = useState(
    () => localStorage.getItem('notes.assist') !== 'off',
  );
  const [grid, setGrid] = useState(false);

  const [fill, setFill] = useState(() => {
    const saved = localStorage.getItem('notes.fill');
    return saved && FILL_COLORS.includes(saved) ? saved : 'none';
  });

  const [fontSize, setFontSize] = useState(() => {
    const saved = Number(localStorage.getItem('notes.fontSize'));

    return (
      Number.isFinite(saved) &&
      saved >= MIN_FONT_SIZE &&
      saved <= MAX_FONT_SIZE
    ) ? saved : 28;
  });

  const [fontInput, setFontInput] = useState(String(fontSize));

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedRef = useRef(selected);

  const [draft, setDraft] = useState<Shape | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [snapHint, setSnapHint] = useState<Pt | null>(null);

  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const textRef = useRef<TextDraft | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [hoverCursor, setHoverCursor] = useState('default');

  const svgRef = useRef<SVGSVGElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pointerRef = useRef<number | null>(null);

  const canvasW = initial?.w ?? SKETCH_W;
  const canvasH = initial?.h ?? SKETCH_H;

  useEffect(() => {
    localStorage.setItem('notes.assist', assist ? 'on' : 'off');
  }, [assist]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (textDraft) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [textDraft?.shape.id]);

  const preview = (next: Shape[]) => {
    shapesRef.current = next;
    setShapes(next);
  };

  const select = (next: Set<string>) => {
    selectedRef.current = next;
    setSelected(next);
  };

  const syncHistory = () => {
    setHistory({
      undo: undoRef.current.length,
      redo: redoRef.current.length,
    });
  };

  const commit = (
    next: Shape[],
    before = shapesRef.current,
  ) => {
    preview(next);

    if (JSON.stringify(next) === JSON.stringify(before)) return;

    undoRef.current = [...undoRef.current.slice(-99), before];
    redoRef.current = [];
    syncHistory();

    // Save completed operations, not intermediate drag positions.
    saveSketch(id, next);
  };

  const undo = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;

    redoRef.current.push(shapesRef.current);
    preview(previous);
    saveSketch(id, previous);
    select(new Set());
    syncHistory();
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;

    undoRef.current.push(shapesRef.current);
    preview(next);
    saveSketch(id, next);
    select(new Set());
    syncHistory();
  };

  const deleteSelected = () => {
    if (!selectedRef.current.size) return;

    commit(
      shapesRef.current.filter(s => !selectedRef.current.has(s.id)),
    );
    select(new Set());
  };

  const screenScale = () =>
    Math.max(
      0.001,
      Math.abs(svgRef.current?.getScreenCTM()?.a ?? 1),
    );

  const local = (
    event: { clientX: number; clientY: number },
  ): Pt => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };

    const p = new DOMPoint(
      event.clientX,
      event.clientY,
    ).matrixTransform(matrix.inverse());

    return { x: p.x, y: p.y };
  };

  const gridSnap = (p: Pt): Pt => grid
    ? {
        x: Math.round(p.x / GRID) * GRID,
        y: Math.round(p.y / GRID) * GRID,
      }
    : p;

  const snapToAnchor = (
    p: Pt,
    exclude?: string,
  ): Pt | null => {
    if (!assist) return null;

    let best: Pt | null = null;
    let nearest = 12 / screenScale();

    for (const shape of shapesRef.current) {
      if (shape.id === exclude) continue;

      for (const anchor of anchorsOf(shape)) {
        if (!anchor) continue;

        const distance = dist(anchor, p);

        if (distance < nearest) {
          nearest = distance;
          best = anchor;
        }
      }
    }

    return best;
  };

  const endpoint = (
    from: Pt | null,
    p: Pt,
    shift: boolean,
    exclude?: string,
  ): Pt => {
    if (from && shift) {
      setSnapHint(null);
      return snapAngle(from, p, 15);
    }

    const anchor = snapToAnchor(p, exclude);
    setSnapHint(anchor);

    if (anchor) return anchor;

    const q = gridSnap(p);
    return from && assist && !grid ? softSnap(from, q) : q;
  };

  const topmostAt = (p: Pt) => {
    const ordered = orderedShapes(shapesRef.current);

    for (let i = ordered.length - 1; i >= 0; i--) {
      if (hitTest(ordered[i], p, 6 / screenScale(), true)) {
        return ordered[i];
      }
    }

    return null;
  };

  const singleSelected = () => {
    if (selectedRef.current.size !== 1) return null;

    return shapesRef.current.find(
      s => selectedRef.current.has(s.id),
    ) ?? null;
  };

  const controlAt = (
    p: Pt,
  ): { end: 'a' | 'b' } | { handle: Handle } | null => {
    const shape = singleSelected();
    if (!shape) return null;

    if (shape.kind === 'line' || shape.kind === 'arrow') {
      if (dist(shape.a, p) <= 9 / screenScale()) return { end: 'a' };
      if (dist(shape.b, p) <= 9 / screenScale()) return { end: 'b' };
      return null;
    }

    const handle = handleAt(
      shapeBounds(shape),
      p,
      7 / screenScale(),
    );

    return handle ? { handle } : null;
  };

  const startText = (next: TextDraft) => {
    textRef.current = next;
    setTextDraft(next);

    select(new Set([
      next.labelFor ?? next.shape.id,
    ]));
  };

  const cancelText = () => {
    const previous = textRef.current;

    textRef.current = null;
    setTextDraft(null);

    if (previous?.labelFor) {
      select(new Set([previous.labelFor]));
    }
  };

  const commitText = () => {
    const currentDraft = textRef.current;
    if (!currentDraft) return;

    // Clear first so Enter, blur and Done cannot duplicate the label.
    cancelText();

    const text = currentDraft.shape.text.trim();
    if (!text) return;

    const next: TextShape = {
      ...currentDraft.shape,
      text,
      ...(currentDraft.center
        ? {
            x: currentDraft.center.x -
              text.length * currentDraft.shape.size * 0.56 / 2,
            y: currentDraft.center.y -
              currentDraft.shape.size * 1.1 / 2,
          }
        : {}),
    };

    const current = shapesRef.current;

    commit(
      currentDraft.existing
        ? current.map(s => s.id === next.id ? next : s)
        : [...current, next],
    );

    if (currentDraft.labelFor) {
      select(new Set([currentDraft.labelFor, next.id]));
    }
  };

  const promptForLabel = (shape: Shape) => {
    if (shape.kind === 'path' || shape.kind === 'text') return;

    const box = shapeBounds(shape);
    const connector =
      shape.kind === 'line' || shape.kind === 'arrow';

    const center = {
      x: box.x + box.w / 2,
      y: box.y + box.h / 2 -
        (connector ? fontSize * 0.8 + 8 : 0),
    };

    startText({
      existing: false,
      labelFor: shape.id,
      center,
      shape: {
        id: uid(),
        kind: 'text',
        x: center.x,
        y: center.y - fontSize * 1.1 / 2,
        text: '',
        size: fontSize,
        color: '#18181b',
        width,
      },
    });
  };

  const releasePointer = () => {
    const pointer = pointerRef.current;
    pointerRef.current = null;

    if (
      pointer !== null &&
      svgRef.current?.hasPointerCapture(pointer)
    ) {
      svgRef.current.releasePointerCapture(pointer);
    }
  };

  const cancelGesture = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;

    if (gesture) {
      preview(gesture.before);

      if (gesture.kind === 'marquee') {
        select(gesture.base);
      }
    }

    setDraft(null);
    setMarquee(null);
    setSnapHint(null);
    releasePointer();
  };

  const onDown = (event: PE<SVGSVGElement>) => {
    if (
      event.button !== 0 ||
      gestureRef.current ||
      (event.target as Element).closest('[data-text-editor]')
    ) {
      return;
    }

    if (textRef.current) {
      commitText();
      return;
    }

    event.preventDefault();

    const p = local(event);
    const before = shapesRef.current;

    if (tool === 'text') {
      const hit = topmostAt(p);

      if (hit?.kind === 'text') {
        startText({
          shape: { ...hit },
          existing: true,
        });
      } else {
        startText({
          existing: false,
          shape: {
            id: uid(),
            kind: 'text',
            ...gridSnap(p),
            text: '',
            size: fontSize,
            color,
            width,
          },
        });
      }

      return;
    }

    svgRef.current!.setPointerCapture(event.pointerId);
    pointerRef.current = event.pointerId;

    if (tool === 'select') {
      const shape = singleSelected();
      const control = controlAt(p);

      if (
        shape &&
        control &&
        'end' in control &&
        (shape.kind === 'line' || shape.kind === 'arrow')
      ) {
        gestureRef.current = {
          kind: 'endpoint',
          before,
          start: p,
          original: shape,
          end: control.end,
        };
        return;
      }

      if (shape && control && 'handle' in control) {
        gestureRef.current = {
          kind: 'resize',
          before,
          start: p,
          original: shape,
          box: shapeBounds(shape),
          handle: control.handle,
        };
        return;
      }

      const hit = topmostAt(p);

      if (hit) {
        const ids = new Set(selectedRef.current);

        if (event.shiftKey) {
          if (ids.has(hit.id)) {
            ids.delete(hit.id);
            select(ids);
            releasePointer();
            return;
          }

          ids.add(hit.id);
        } else if (!ids.has(hit.id)) {
          ids.clear();
          ids.add(hit.id);
        }

        select(ids);

        gestureRef.current = {
          kind: 'move',
          before,
          start: p,
          ids,
        };
        return;
      }

      const base = event.shiftKey
        ? new Set(selectedRef.current)
        : new Set<string>();

      select(base);

      gestureRef.current = {
        kind: 'marquee',
        before,
        start: p,
        base,
      };

      setMarquee(boxBetween(p, p));
      return;
    }

    select(new Set());

    if (tool === 'eraser') {
      gestureRef.current = {
        kind: 'erase',
        before,
        start: p,
      };

      preview(
        before.filter(s => !hitTest(s, p, 8 / screenScale())),
      );
      return;
    }

    const base = { id: uid(), color, width };
    let next: Shape;

    if (tool === 'pen') {
      next = { ...base, kind: 'path', points: [p] };
    } else if (tool === 'line' || tool === 'arrow') {
      const a = endpoint(null, p, false);
      next = { ...base, kind: tool, a, b: a };
    } else {
      const a = gridSnap(p);

      next = {
        ...base,
        kind: tool,
        x: a.x,
        y: a.y,
        w: 0,
        h: 0,
        fill,
      };
    }

    gestureRef.current = {
      kind: 'draw',
      before,
      start: p,
      draft: next,
      points: [p],
    };

    setDraft(next);
  };

  const updateGesture = (p: Pt, shift: boolean) => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    const delta = {
      x: p.x - gesture.start.x,
      y: p.y - gesture.start.y,
    };

    switch (gesture.kind) {
      case 'marquee': {
        const box = boxBetween(gesture.start, p);
        const ids = new Set(gesture.base);

        for (const shape of gesture.before) {
          if (contained(box, shapeBounds(shape))) {
            ids.add(shape.id);
          }
        }

        setMarquee(box);
        select(ids);
        break;
      }

      case 'move': {
        if (Math.hypot(delta.x, delta.y) * screenScale() < 2) {
          preview(gesture.before);
          return;
        }

        const snapped = gridSnap(delta);

        preview(
          gesture.before.map(s =>
            gesture.ids.has(s.id)
              ? translate(s, snapped.x, snapped.y)
              : s,
          ),
        );
        break;
      }

      case 'resize': {
        if (Math.hypot(delta.x, delta.y) * screenScale() < 2) {
          preview(gesture.before);
          return;
        }

        const box = resizedBox(
          gesture.box,
          gesture.handle,
          gridSnap(delta),
          shift || gesture.original.kind === 'text',
        );

        const resized = scaleShape(
          gesture.original,
          gesture.box,
          box,
        );

        preview(
          gesture.before.map(s => s.id === resized.id ? resized : s),
        );
        break;
      }

      case 'endpoint': {
        if (Math.hypot(delta.x, delta.y) * screenScale() < 2) {
          preview(gesture.before);
          return;
        }

        const fixed = gesture.end === 'a'
          ? gesture.original.b
          : gesture.original.a;

        const q = endpoint(
          fixed,
          p,
          shift,
          gesture.original.id,
        );

        if (dist(q, fixed) < 2) return;

        const changed: Shape = {
          ...gesture.original,
          [gesture.end]: q,
        };

        preview(
          gesture.before.map(s => s.id === changed.id ? changed : s),
        );
        break;
      }

      case 'erase':
        preview(
          shapesRef.current.filter(
            s => !hitTest(s, p, 8 / screenScale()),
          ),
        );
        break;

      case 'draw': {
        const current = gesture.draft;

        if (current.kind === 'path') {
          if (
            dist(gesture.points[gesture.points.length - 1], p) < 1
          ) {
            return;
          }

          gesture.points.push(p);

          gesture.draft = {
            ...current,
            points: gesture.points.slice(),
          };
        } else if (
          current.kind === 'line' ||
          current.kind === 'arrow'
        ) {
          gesture.draft = {
            ...current,
            b: endpoint(current.a, p, shift),
          };
        } else if (
          current.kind === 'rect' ||
          current.kind === 'ellipse'
        ) {
          const a = gridSnap(gesture.start);
          let q = gridSnap(p);

          if (shift) {
            const side = Math.max(
              Math.abs(q.x - a.x),
              Math.abs(q.y - a.y),
            );

            q = {
              x: a.x + Math.sign(q.x - a.x || 1) * side,
              y: a.y + Math.sign(q.y - a.y || 1) * side,
            };
          }

          gesture.draft = {
            ...current,
            ...boxBetween(a, q),
          };
        }

        setDraft(gesture.draft);
        break;
      }
    }
  };

  const onMove = (event: PE<SVGSVGElement>) => {
    if (
      (event.target as Element).closest('[data-text-editor]')
    ) {
      return;
    }

    if (
      pointerRef.current !== null &&
      event.pointerId !== pointerRef.current
    ) {
      return;
    }

    const p = local(event);

    if (gestureRef.current) {
      updateGesture(p, event.shiftKey);
      return;
    }

    if (tool === 'select') {
      const control = controlAt(p);

      setHoverCursor(
        control
          ? 'end' in control
            ? 'crosshair'
            : CURSORS[control.handle]
          : topmostAt(p)
            ? 'move'
            : 'default',
      );
    } else if (tool === 'line' || tool === 'arrow') {
      setSnapHint(snapToAnchor(p));
    }
  };

  const finishGesture = (event?: PE<SVGSVGElement>) => {
    if (
      event &&
      event.pointerId !== pointerRef.current
    ) {
      return;
    }

    if (event && gestureRef.current) {
      updateGesture(local(event), event.shiftKey);
    }

    const gesture = gestureRef.current;
    gestureRef.current = null;

    setDraft(null);
    setMarquee(null);
    setSnapHint(null);
    releasePointer();

    if (!gesture || gesture.kind === 'marquee') return;

    if (gesture.kind !== 'draw') {
      commit(shapesRef.current, gesture.before);
      return;
    }

    let next = gesture.draft;

    if (next.kind === 'path') {
      const recognized = assist
        ? recognize(gesture.points)
        : null;

      if (recognized) {
        next = {
          id: next.id,
          color: next.color,
          width: next.width,
          ...recognized.geom,
        };

        if (isFillable(next)) {
          next = { ...next, fill };
        }

        setToast(recognized.label);
      } else {
        const points = compactStroke(gesture.points);

        if (points.length === 1) {
          points.push({
            x: points[0].x + 0.1,
            y: points[0].y,
          });
        }

        next = { ...next, points };
      }

      if (next.kind === 'line') {
        next = {
          ...next,
          a: snapToAnchor(next.a) ?? next.a,
          b: snapToAnchor(next.b) ?? next.b,
        };
      }
    }

    if (
      (next.kind === 'line' || next.kind === 'arrow') &&
      dist(next.a, next.b) < 3
    ) {
      return;
    }

    if (
      (next.kind === 'rect' || next.kind === 'ellipse') &&
      (next.w < 3 || next.h < 3)
    ) {
      return;
    }

    commit([...gesture.before, next], gesture.before);
    promptForLabel(next);
  };

  const close = () => {
    if (gestureRef.current) finishGesture();
    commitText();
    openSketch(null);
  };

  const changeTool = (next: Tool) => {
    commitText();
    setTool(next);

    if (next !== 'select') {
      select(new Set());
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;

      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (event.key === 'Escape') {
        event.preventDefault();

        if (gestureRef.current) cancelGesture();
        else if (selectedRef.current.size) select(new Set());
        else close();

        return;
      }

      if (gestureRef.current) return;

      if (mod && key === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }

      if (mod && key === 'y') {
        event.preventDefault();
        redo();
        return;
      }

      if (mod && key === 'a') {
        event.preventDefault();
        setTool('select');
        select(new Set(shapesRef.current.map(s => s.id)));
        return;
      }

      if (
        event.key === 'Delete' ||
        event.key === 'Backspace'
      ) {
        event.preventDefault();
        deleteSelected();
        return;
      }

      if (mod || event.altKey) return;

      const next = TOOLS.find(t => t[3] === key);
      if (next) changeTool(next[0]);

      if (key === 'g') setGrid(value => !value);
      if (key === 's') setAssist(value => !value);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selectedShapes = shapes.filter(s => selected.has(s.id));
  const selectedBox = selectionBox(selectedShapes);
  const single = selectedShapes.length === 1
    ? selectedShapes[0]
    : null;

  const connector = single &&
    (single.kind === 'line' || single.kind === 'arrow')
      ? single
      : null;

  const selectedFillables = selectedShapes.filter(isFillable);

  const mixedFills = selectedFillables.length > 1 &&
    selectedFillables.some(
      s => (s.fill ?? 'none') !==
        (selectedFillables[0].fill ?? 'none'),
    );

  const displayedFill = selectedFillables.length
    ? selectedFillables[0].fill ?? 'none'
    : fill;

  const applyFill = (value: string) => {
    setFill(value);
    localStorage.setItem('notes.fill', value);

    if (selectedFillables.length) {
      commit(
        shapesRef.current.map(s =>
          selectedRef.current.has(s.id) && isFillable(s)
            ? { ...s, fill: value }
            : s,
        ),
      );
    }
  };

  const selectedTexts = selectedShapes.filter(
    (s): s is TextShape => s.kind === 'text',
  );

  const mixedFontSizes = !textDraft &&
    selectedTexts.length > 1 &&
    selectedTexts.some(s => s.size !== selectedTexts[0].size);

  const displayedFontSize =
    textDraft?.shape.size ??
    selectedTexts[0]?.size ??
    fontSize;

  useEffect(() => {
    setFontInput(
      mixedFontSizes
        ? ''
        : String(Math.round(displayedFontSize * 10) / 10),
    );
  }, [displayedFontSize, mixedFontSizes]);

  const applyFontSize = (raw: string) => {
    if (!raw.trim()) return;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;

    const size = Math.min(
      MAX_FONT_SIZE,
      Math.max(MIN_FONT_SIZE, Math.round(parsed)),
    );

    setFontSize(size);
    setFontInput(String(size));
    localStorage.setItem('notes.fontSize', String(size));

    const currentDraft = textRef.current;

    if (currentDraft) {
      const next: TextDraft = {
        ...currentDraft,
        shape: {
          ...currentDraft.shape,
          size,
        },
      };

      textRef.current = next;
      setTextDraft(next);
    } else if (selectedTexts.length) {
      commit(
        shapesRef.current.map(s =>
          s.kind === 'text' && selectedRef.current.has(s.id)
            ? { ...s, size }
            : s,
        ),
      );
    }
  };

  const input = textDraft?.shape;

  const cursor = tool === 'select'
    ? hoverCursor
    : tool === 'text'
      ? 'text'
      : tool === 'eraser'
        ? 'cell'
        : 'crosshair';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm"
      onPointerDown={event => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sketch editor"
        className="flex max-h-full w-[min(1100px,100%)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-3 py-2">
          {TOOLS.map(([value, Icon, label]) => (
            <Button
              key={value}
              size="icon"
              title={label}
              active={tool === value}
              onClick={() => changeTool(value)}
            >
              <Icon className="h-4 w-4" />
            </Button>
          ))}

          <Separator vertical />

          <span className="px-1 text-xs text-zinc-500">
            Stroke
          </span>

          {COLORS.map((value, index) => (
            <button
              key={value}
              type="button"
              title={`Stroke ${COLOR_NAMES[index]}`}
              aria-label={`Stroke ${COLOR_NAMES[index]}`}
              aria-pressed={color === value}
              onClick={() => setColor(value)}
              className={cn(
                'h-6 w-6 rounded-full border-2',
                color === value
                  ? 'border-zinc-400 ring-1 ring-zinc-400'
                  : 'border-transparent',
              )}
              style={{ background: value }}
            />
          ))}

          {WIDTHS.map(value => (
            <Button
              key={value}
              size="icon"
              title={`Stroke ${value}px`}
              active={width === value}
              onClick={() => setWidth(value)}
            >
              <span
                className="rounded-full bg-current"
                style={{
                  width: value + 4,
                  height: value + 4,
                }}
              />
            </Button>
          ))}

          <Separator vertical />

          <div
            role="group"
            aria-label="Shape fill"
            className="flex items-center gap-1 px-1"
          >
            <span className="mr-1 text-xs text-zinc-500">
              Fill
            </span>

            <button
              type="button"
              title="No fill"
              aria-label="No fill"
              aria-pressed={!mixedFills && displayedFill === 'none'}
              onClick={() => applyFill('none')}
              className={cn(
                'h-6 w-6 rounded-full border border-zinc-300 bg-white text-xs text-zinc-600',
                !mixedFills &&
                  displayedFill === 'none' &&
                  'ring-2 ring-blue-400 ring-offset-1',
              )}
            >
              ∅
            </button>

            {FILL_COLORS.map((value, index) => (
              <button
                key={value}
                type="button"
                title={`Fill ${COLOR_NAMES[index]}`}
                aria-label={`Fill ${COLOR_NAMES[index]}`}
                aria-pressed={!mixedFills && displayedFill === value}
                onClick={() => applyFill(value)}
                className={cn(
                  'h-6 w-6 rounded-full border border-zinc-300',
                  !mixedFills &&
                    displayedFill === value &&
                    'ring-2 ring-blue-400 ring-offset-1',
                )}
                style={{ background: value }}
              />
            ))}

            {mixedFills && (
              <span className="text-xs text-zinc-400">
                Mixed
              </span>
            )}
          </div>

          <Separator vertical />

          <label
            data-font-size="true"
            className="flex items-center gap-1 px-1 text-xs text-zinc-600"
          >
            <span>Font</span>

            <input
              aria-label="Font size"
              type="number"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              step={1}
              value={fontInput}
              placeholder={mixedFontSizes ? 'Mixed' : undefined}
              className="h-8 w-16 rounded-md border border-zinc-200 bg-white px-2 text-sm outline-none focus:border-blue-400"
              onChange={event => setFontInput(event.target.value)}
              onBlur={() => {
                applyFontSize(fontInput);

                if (!fontInput.trim()) {
                  setFontInput(
                    mixedFontSizes ? '' : String(displayedFontSize),
                  );
                }
              }}
              onKeyDown={event => {
                event.stopPropagation();

                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }

                if (event.key === 'Escape') {
                  setFontInput(
                    mixedFontSizes ? '' : String(displayedFontSize),
                  );
                }
              }}
            />

            <span>px</span>
          </label>

          <Separator vertical />

          <Button
            active={assist}
            title="Shape assist (S)"
            onClick={() => setAssist(value => !value)}
          >
            <Wand2 className="h-4 w-4" />
            Assist
          </Button>

          <Button
            size="icon"
            active={grid}
            title="Snap to grid (G)"
            onClick={() => setGrid(value => !value)}
          >
            <Grid3x3 className="h-4 w-4" />
          </Button>

          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon"
              title="Undo (Ctrl/Cmd+Z)"
              disabled={!history.undo}
              onClick={undo}
            >
              <Undo2 className="h-4 w-4" />
            </Button>

            <Button
              size="icon"
              title="Redo (Ctrl/Cmd+Shift+Z)"
              disabled={!history.redo}
              onClick={redo}
            >
              <Redo2 className="h-4 w-4" />
            </Button>

            <Button
              size="icon"
              variant="danger"
              title={selected.size ? 'Delete selection' : 'Clear sketch'}
              onClick={() => {
                if (selectedRef.current.size) {
                  deleteSelected();
                } else if (
                  shapesRef.current.length &&
                  confirm('Clear the whole sketch?')
                ) {
                  commit([]);
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>

            <Button variant="default" onClick={close}>
              Done
            </Button>
          </div>
        </div>

        <div className="relative min-h-0 bg-zinc-50 p-3">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${canvasW} ${canvasH}`}
            className="mx-auto block max-h-[calc(100vh-12rem)] w-full touch-none select-none rounded-lg bg-white shadow-inner ring-1 ring-zinc-200"
            style={{
              cursor,
              aspectRatio: `${canvasW} / ${canvasH}`,
            }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={finishGesture}
            onPointerCancel={cancelGesture}
            onLostPointerCapture={() => {
              if (gestureRef.current) cancelGesture();
            }}
            onPointerLeave={() => {
              if (!gestureRef.current) setSnapHint(null);
            }}
            onDoubleClick={event => {
              if (tool !== 'select' && tool !== 'text') return;

              if (
                (event.target as Element).closest('[data-text-editor]')
              ) {
                return;
              }

              const hit = topmostAt(local(event));

              if (hit?.kind === 'text') {
                event.preventDefault();

                startText({
                  existing: true,
                  shape: { ...hit },
                });
              }
            }}
          >
            <defs>
              <pattern
                id="sketch-dots"
                width={GRID}
                height={GRID}
                patternUnits="userSpaceOnUse"
              >
                <circle
                  cx={1}
                  cy={1}
                  r={1}
                  fill={grid ? '#a1a1aa' : '#e4e4e7'}
                />
              </pattern>
            </defs>

            <rect
              width={canvasW}
              height={canvasH}
              fill="url(#sketch-dots)"
            />

            {shapes
              .filter(s => s.kind !== 'text')
              .map(s => <ShapeEl key={s.id} s={s} />)}

            {draft && (
              <g opacity={0.85}>
                <ShapeEl s={draft} />
              </g>
            )}

            {shapes
              .filter(s =>
                s.kind === 'text' &&
                !(textDraft?.existing && s.id === input?.id),
              )
              .map(s => <ShapeEl key={s.id} s={s} />)}

            {tool === 'select' && !textDraft && (
              <g
                pointerEvents="none"
                fill="none"
                stroke="#3b82f6"
                strokeWidth={1.3}
              >
                {selectedShapes.length > 1 &&
                  selectedShapes.map(s => {
                    const box = shapeBounds(s);

                    return (
                      <rect
                        key={s.id}
                        x={box.x - 3}
                        y={box.y - 3}
                        width={box.w + 6}
                        height={box.h + 6}
                        strokeDasharray="3 3"
                      />
                    );
                  })}

                {selectedBox && !connector && (
                  <rect
                    x={selectedBox.x}
                    y={selectedBox.y}
                    width={selectedBox.w}
                    height={selectedBox.h}
                    strokeDasharray={single ? undefined : '6 4'}
                  />
                )}

                {single && !connector && selectedBox &&
                  HANDLES.map(handle => {
                    const p = handlePoint(selectedBox, handle);

                    return (
                      <rect
                        key={handle}
                        x={p.x - 4}
                        y={p.y - 4}
                        width={8}
                        height={8}
                        rx={1}
                        fill="white"
                      />
                    );
                  })}

                {connector &&
                  [connector.a, connector.b].map((p, index) => (
                    <circle
                      key={index}
                      cx={p.x}
                      cy={p.y}
                      r={6}
                      fill="white"
                      strokeWidth={2}
                    />
                  ))}
              </g>
            )}

            {marquee && (
              <rect
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
                fill="#3b82f61a"
                stroke="#3b82f6"
                strokeWidth={1}
                strokeDasharray="5 3"
                pointerEvents="none"
              />
            )}

            {snapHint && (
              <circle
                cx={snapHint.x}
                cy={snapHint.y}
                r={7}
                fill="#3b82f633"
                stroke="#3b82f6"
                pointerEvents="none"
              />
            )}

            {input && (
              <foreignObject
                data-text-editor="true"
                x={input.x - 2}
                y={input.y - 2}
                width={Math.max(
                  textDraft?.labelFor ? 280 : 180,
                  input.text.length * input.size * 0.75 + 40,
                )}
                height={input.size * 1.5 + 8}
                style={{ overflow: 'visible' }}
              >
                <input
                  ref={inputRef}
                  aria-label={
                    textDraft?.labelFor
                      ? 'Shape label'
                      : textDraft?.existing
                        ? 'Edit text'
                        : 'New text'
                  }
                  value={input.text}
                  placeholder={
                    textDraft?.labelFor
                      ? 'Label (Enter to save, Esc to skip)'
                      : 'Type...'
                  }
                  onPointerDown={event => event.stopPropagation()}
                  onDoubleClick={event => event.stopPropagation()}
                  onChange={event => {
                    const current = textRef.current;
                    if (!current) return;

                    const next: TextDraft = {
                      ...current,
                      shape: {
                        ...current.shape,
                        text: event.target.value,
                      },
                    };

                    textRef.current = next;
                    setTextDraft(next);
                  }}
                  onKeyDown={event => {
                    event.stopPropagation();

                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitText();
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelText();
                    }
                  }}
                  onBlur={event => {
                    if (
                      (event.relatedTarget as Element | null)
                        ?.closest('[data-font-size]')
                    ) {
                      return;
                    }

                    commitText();
                  }}
                  style={{
                    width: '100%',
                    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                    fontWeight: 500,
                    fontSize: input.size,
                    lineHeight: 1.1,
                    color: input.color,
                    padding: 2,
                    background: 'white',
                    border: '1px dashed #3b82f6',
                    outline: 'none',
                    userSelect: 'text',
                  }}
                />
              </foreignObject>
            )}
          </svg>

          {toast && (
            <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900 px-3 py-1 text-xs text-white shadow">
              {toast}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-100 px-4 py-1.5 text-xs text-zinc-500">
          {textDraft?.labelFor
            ? 'Type a label. Enter saves; Escape skips. Font size can be changed above.'
            : tool === 'select'
              ? `${selected.size} selected | Drag empty space to box-select. Shift adds/toggles. Drag selected items to move together. Drag borders to resize or arrow endpoints to redirect. Double-click text to edit.`
              : 'V: select | Shift: constrain proportions/angles | S: assist | G: grid | Ctrl/Cmd+Z: undo'}
        </div>
      </div>
    </div>
  );
}
