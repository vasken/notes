import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as PE,
} from 'react';

import {
  ArrowUpRight,
  BringToFront,
  Circle,
  CopyPlus,
  Eraser,
  Grid3x3,
  Link2,
  MousePointer2,
  Pencil,
  Redo2,
  SendToBack,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlink2,
  Wand2,
} from 'lucide-react';

import { SKETCH_H, SKETCH_W, useStore } from '../store';
import type { Binding, Pt, Shape } from '../types';

import {
  anchorsOf,
  compactStroke,
  dist,
  hitTest,
  outline,
  recognize,
  shapeBounds,
  snapAngle,
  softSnap,
  translate,
} from '../lib/shapes';

import {
  attachTexts,
  bindingFor,
  canHaveLabel,
  cloneShapes,
  detachFrom,
  detachLabels,
  hostAt,
  isConnector,
  isHost,
  isLabel,
  removeShapes,
  resolveLayout,
  withLabels,
  type Connector,
  type TextShape,
} from '../lib/sketch-layout';

import {
  snapMove,
  snapPoint,
  snapResize,
  type Guide,
} from '../lib/sketch-guides';

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

type Mods = { shiftKey: boolean; altKey: boolean };
const NO_MODS: Mods = { shiftKey: false, altKey: false };

type End = { point: Pt; binding?: Binding };

// Shared across sketches for the session, so shapes can be pasted into another sketch.
let clipboard: Shape[] = [];
let pasteCount = 0;

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
      box: Box | null;
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
    () => resolveLayout(initial?.shapes ?? []),
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
  const [bindHint, setBindHint] = useState<string | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);

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

  // Every change goes through resolveLayout so labels and bound
  // connector ends follow their host shapes, live during drags too.
  const preview = (next: Shape[]) => {
    const resolved = resolveLayout(next);
    shapesRef.current = resolved;
    setShapes(resolved);
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

    const resolved = shapesRef.current;
    if (JSON.stringify(resolved) === JSON.stringify(before)) return;

    undoRef.current = [...undoRef.current.slice(-99), before];
    redoRef.current = [];
    syncHistory();

    // Save completed operations, not intermediate drag positions.
    saveSketch(id, resolved);
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

    commit(removeShapes(shapesRef.current, selectedRef.current));
    select(new Set());
  };

  /** Selected shapes plus their labels, in z-order. */
  const selectionWithLabels = () => {
    const ids = withLabels(shapesRef.current, selectedRef.current);
    return shapesRef.current.filter(s => ids.has(s.id));
  };

  const selectInserted = (inserted: Shape[]) => {
    setTool('select');
    select(new Set(inserted.filter(s => !isLabel(s)).map(s => s.id)));
  };

  const copySelection = () => {
    if (!selectedRef.current.size) return false;
    clipboard = structuredClone(selectionWithLabels());
    pasteCount = 0;
    return true;
  };

  const paste = () => {
    if (!clipboard.length) return;
    pasteCount += 1;
    const clones = cloneShapes(clipboard, { x: 20 * pasteCount, y: 20 * pasteCount });
    commit([...shapesRef.current, ...clones]);
    selectInserted(clones);
  };

  const duplicate = () => {
    if (!selectedRef.current.size) return;
    const clones = cloneShapes(selectionWithLabels(), { x: 20, y: 20 });
    commit([...shapesRef.current, ...clones]);
    selectInserted(clones);
  };

  const nudge = (dx: number, dy: number) => {
    const ids = selectedRef.current;
    if (!ids.size) return;

    commit(
      shapesRef.current.map(s =>
        ids.has(s.id) ? detachFrom(translate(s, dx, dy), ids) : s,
      ),
    );
  };

  /** Z-order among drawn shapes; text always renders on top. */
  const reorder = (mode: 'front' | 'back' | 'forward' | 'backward') => {
    const ids = selectedRef.current;
    if (!ids.size) return;

    const current = shapesRef.current;
    const texts = current.filter(s => s.kind === 'text');
    let items = current.filter(s => s.kind !== 'text');
    const picked = (s: Shape) => ids.has(s.id);

    if (mode === 'front') {
      items = [...items.filter(s => !picked(s)), ...items.filter(picked)];
    } else if (mode === 'back') {
      items = [...items.filter(picked), ...items.filter(s => !picked(s))];
    } else if (mode === 'forward') {
      for (let i = items.length - 2; i >= 0; i--) {
        if (picked(items[i]) && !picked(items[i + 1])) {
          [items[i], items[i + 1]] = [items[i + 1], items[i]];
        }
      }
    } else {
      for (let i = 1; i < items.length; i++) {
        if (picked(items[i]) && !picked(items[i - 1])) {
          [items[i], items[i - 1]] = [items[i - 1], items[i]];
        }
      }
    }

    commit([...items, ...texts]);
  };

  const clearAll = () => {
    if (!shapesRef.current.length) return;
    commit([]);
    select(new Set());
    setToast('Cleared. Ctrl/⌘+Z to undo');
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
  ): { point: Pt; shape: Shape } | null => {
    if (!assist) return null;

    let best: { point: Pt; shape: Shape } | null = null;
    let nearest = 12 / screenScale();

    for (const shape of shapesRef.current) {
      if (shape.id === exclude) continue;

      for (const anchor of anchorsOf(shape)) {
        if (!anchor) continue;

        const distance = dist(anchor, p);

        if (distance < nearest) {
          nearest = distance;
          best = { point: anchor, shape };
        }
      }
    }

    return best;
  };

  /**
   * Resolve a connector end: snap to anchors (binding to that shape),
   * float-attach when dropped on a shape, otherwise grid / angle snap.
   * Alt turns every assist off; Shift gives exact 15° steps.
   */
  const endpoint = (
    from: Pt | null,
    p: Pt,
    mods: Mods,
    exclude?: string,
  ): End => {
    if (mods.altKey) {
      setSnapHint(null);
      setBindHint(null);
      return { point: p };
    }

    if (from && mods.shiftKey) {
      setSnapHint(null);
      setBindHint(null);
      return { point: snapAngle(from, p, 15) };
    }

    const anchor = snapToAnchor(p, exclude);

    if (anchor) {
      setSnapHint(anchor.point);
      const binding = isHost(anchor.shape)
        ? bindingFor(anchor.shape, anchor.point)
        : undefined;
      setBindHint(binding ? anchor.shape.id : null);
      return { point: anchor.point, binding };
    }

    setSnapHint(null);

    const host = assist
      ? hostAt(
          shapesRef.current.filter(s => s.id !== exclude),
          p,
          10 / screenScale(),
        )
      : null;

    setBindHint(host?.id ?? null);

    if (host) {
      return { point: p, binding: { id: host.id, fx: 0.5, fy: 0.5 } };
    }

    const q = gridSnap(p);
    return { point: from && assist && !grid ? softSnap(from, q) : q };
  };

  /** A draft connector with its bound ends resolved, for display and final checks. */
  const resolveDraft = (shape: Shape): Shape =>
    isConnector(shape) && (shape.from || shape.to)
      ? resolveLayout([...shapesRef.current, shape]).at(-1)!
      : shape;

  /** Snapping targets for smart guides: other shapes and the canvas, not labels or connectors. */
  const guideTargets = (exclude: Set<string>): Box[] => [
    { x: 0, y: 0, w: canvasW, h: canvasH },
    ...shapesRef.current
      .filter(s =>
        !exclude.has(s.id) &&
        !isLabel(s) &&
        !isConnector(s),
      )
      .map(shapeBounds),
  ];

  const guidesOn = (mods: Mods) => assist && !grid && !mods.altKey;

  /**
   * Topmost shape under p. A label stands in for its host, so clicking
   * a label grabs the shape it belongs to; pass raw to get the label itself.
   */
  const topmostAt = (p: Pt, raw = false) => {
    const ordered = orderedShapes(shapesRef.current);

    for (let i = ordered.length - 1; i >= 0; i--) {
      const shape = ordered[i];
      if (!hitTest(shape, p, 6 / screenScale(), true)) continue;

      if (!raw && isLabel(shape)) {
        const host = shapesRef.current.find(s => s.id === shape.labelFor);
        if (host) return host;
      }

      return shape;
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

  /** Labels take their position from the host; free text keeps its own. */
  const placeText = (shape: TextShape): TextShape =>
    shape.labelFor
      ? resolveLayout([
          ...shapesRef.current.filter(s => s.id !== shape.id),
          shape,
        ]).at(-1) as TextShape
      : shape;

  const setText = (next: TextDraft) => {
    textRef.current = next;
    setTextDraft(next);
  };

  const startText = (next: TextDraft) => {
    setText({ ...next, shape: placeText(next.shape) });
    select(new Set([next.shape.labelFor ?? next.shape.id]));
  };

  const cancelText = () => {
    const previous = textRef.current;

    textRef.current = null;
    setTextDraft(null);

    if (previous?.shape.labelFor) {
      select(new Set([previous.shape.labelFor]));
    }
  };

  const commitText = () => {
    const currentDraft = textRef.current;
    if (!currentDraft) return;

    // Clear first so Enter, blur and Done cannot duplicate the label.
    cancelText();

    const text = currentDraft.shape.text.trim();
    const current = shapesRef.current;

    if (!text) {
      // Emptying existing text deletes it.
      if (currentDraft.existing) {
        commit(removeShapes(current, [currentDraft.shape.id]));
      }
      return;
    }

    const next: TextShape = { ...currentDraft.shape, text };

    commit(
      currentDraft.existing
        ? current.map(s => s.id === next.id ? next : s)
        : [...current, next],
    );
  };

  /** Edit a shape's label, creating one if it has none. */
  const editLabel = (host: Shape) => {
    if (!canHaveLabel(host)) return;

    const label = shapesRef.current.find(
      (s): s is TextShape => s.kind === 'text' && s.labelFor === host.id,
    );

    if (label) {
      startText({ existing: true, shape: { ...label } });
      return;
    }

    startText({
      existing: false,
      shape: {
        id: uid(),
        kind: 'text',
        x: 0,
        y: 0,
        text: '',
        size: fontSize,
        color: '#18181b',
        width,
        labelFor: host.id,
        align: 'center',
      },
    });
  };

  /** Edit any text under the pointer, or the label of the shape there. */
  const editAt = (p: Pt) => {
    const raw = topmostAt(p, true);

    if (raw?.kind === 'text') {
      startText({ existing: true, shape: { ...raw } });
      return true;
    }

    const hit = topmostAt(p);

    if (hit && canHaveLabel(hit)) {
      editLabel(hit);
      return true;
    }

    return false;
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
    setBindHint(null);
    setGuides([]);
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

    // Finish any open text or label, then handle this click as usual,
    // so the click after drawing a shape is not lost.
    if (textRef.current) {
      commitText();
    }

    event.preventDefault();

    const p = local(event);
    const before = shapesRef.current;

    if (tool === 'text') {
      const hit = topmostAt(p, true);

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

      // Alt-click picks a label itself rather than its shape.
      const hit = topmostAt(p, event.altKey);

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

        // Labels follow their hosts, so they don't count towards the moving box.
        const movingBox = selectionBox(
          before.filter(s =>
            ids.has(s.id) &&
            !(isLabel(s) && ids.has(s.labelFor)),
          ),
        );

        gestureRef.current = {
          kind: 'move',
          before,
          start: p,
          ids,
          box: movingBox,
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
        removeShapes(
          before,
          before.filter(s => hitTest(s, p, 8 / screenScale())).map(s => s.id),
        ),
      );
      return;
    }

    const base = { id: uid(), color, width };
    let next: Shape;

    if (tool === 'pen') {
      next = { ...base, kind: 'path', points: [p] };
    } else if (tool === 'line' || tool === 'arrow') {
      const a = endpoint(null, p, event);
      next = {
        ...base,
        kind: tool,
        a: a.point,
        b: a.point,
        ...(a.binding ? { from: a.binding } : {}),
      };
    } else {
      let a = gridSnap(p);

      if (guidesOn(event)) {
        const snapped = snapPoint(a, guideTargets(new Set()), 6 / screenScale());
        a = snapped.point;
      }

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
      // Rectangles and ellipses grow from their snapped first corner.
      start: next.kind === 'rect' || next.kind === 'ellipse'
        ? { x: next.x, y: next.y }
        : p,
      draft: next,
      points: [p],
    };

    setDraft(resolveDraft(next));
  };

  const updateGesture = (p: Pt, mods: Mods) => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    const delta = {
      x: p.x - gesture.start.x,
      y: p.y - gesture.start.y,
    };

    const threshold = 6 / screenScale();

    switch (gesture.kind) {
      case 'marquee': {
        const box = boxBetween(gesture.start, p);
        const ids = new Set(gesture.base);

        for (const shape of gesture.before) {
          // Labels come along with their shapes; selecting them alone would detach them.
          if (isLabel(shape)) continue;

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
          setGuides([]);
          return;
        }

        let d = gridSnap(delta);
        let lines: Guide[] = [];

        if (gesture.box && guidesOn(mods)) {
          const moved = {
            ...gesture.box,
            x: gesture.box.x + d.x,
            y: gesture.box.y + d.y,
          };
          const snap = snapMove(moved, guideTargets(withLabels(gesture.before, gesture.ids)), threshold);
          d = { x: d.x + snap.dx, y: d.y + snap.dy };
          lines = snap.guides;
        }

        setGuides(lines);

        // Moving part of a group detaches it: connectors whose host stays put
        // let go of it, and a label dragged without its shape becomes free text.
        preview(
          gesture.before.map(s =>
            gesture.ids.has(s.id)
              ? detachFrom(translate(s, d.x, d.y), gesture.ids)
              : s,
          ),
        );
        break;
      }

      case 'resize': {
        if (Math.hypot(delta.x, delta.y) * screenScale() < 2) {
          preview(gesture.before);
          setGuides([]);
          return;
        }

        const lockAspect = mods.shiftKey || gesture.original.kind === 'text';

        let box = resizedBox(
          gesture.box,
          gesture.handle,
          gridSnap(delta),
          lockAspect,
        );

        let lines: Guide[] = [];

        if (!lockAspect && guidesOn(mods)) {
          const snap = snapResize(
            box,
            gesture.handle,
            guideTargets(withLabels(gesture.before, new Set([gesture.original.id]))),
            threshold,
          );
          box = snap.box;
          lines = snap.guides;
        }

        setGuides(lines);

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
          mods,
          gesture.original.id,
        );

        if (dist(q.point, fixed) < 2) return;

        const key = gesture.end === 'a' ? 'from' : 'to';
        const changed: Connector = {
          ...gesture.original,
          [gesture.end]: q.point,
        };

        // Dropping the end on empty space lets go of the old shape.
        if (q.binding) changed[key] = q.binding;
        else delete changed[key];

        preview(
          gesture.before.map(s => s.id === changed.id ? changed : s),
        );
        break;
      }

      case 'erase':
        preview(
          removeShapes(
            shapesRef.current,
            shapesRef.current
              .filter(s => hitTest(s, p, 8 / screenScale()))
              .map(s => s.id),
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
        } else if (isConnector(current)) {
          const end = endpoint(current.a, p, mods);
          const next: Connector = { ...current, b: end.point };

          if (end.binding) next.to = end.binding;
          else delete next.to;

          gesture.draft = next;
        } else if (
          current.kind === 'rect' ||
          current.kind === 'ellipse'
        ) {
          const a = gesture.start;
          let q = gridSnap(p);
          let lines: Guide[] = [];

          if (guidesOn(mods)) {
            const snap = snapPoint(q, guideTargets(new Set()), threshold);
            q = snap.point;
            lines = snap.guides;
          }

          if (mods.shiftKey) {
            const side = Math.max(
              Math.abs(q.x - a.x),
              Math.abs(q.y - a.y),
            );

            q = {
              x: a.x + Math.sign(q.x - a.x || 1) * side,
              y: a.y + Math.sign(q.y - a.y || 1) * side,
            };
            lines = [];
          }

          setGuides(lines);

          gesture.draft = {
            ...current,
            ...boxBetween(a, q),
          };
        }

        setDraft(resolveDraft(gesture.draft));
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
      updateGesture(p, event);
      return;
    }

    if (tool === 'select') {
      const control = controlAt(p);

      setHoverCursor(
        control
          ? 'end' in control
            ? 'crosshair'
            : CURSORS[control.handle]
          : topmostAt(p, event.altKey)
            ? 'move'
            : 'default',
      );
    } else if (tool === 'line' || tool === 'arrow') {
      // Show where a new connector would snap or attach.
      endpoint(null, p, event);
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
      updateGesture(local(event), event);
    }

    const mods: Mods = event ?? NO_MODS;
    const gesture = gestureRef.current;
    gestureRef.current = null;

    setDraft(null);
    setMarquee(null);
    setGuides([]);
    releasePointer();

    if (!gesture || gesture.kind === 'marquee') {
      setSnapHint(null);
      setBindHint(null);
      return;
    }

    if (gesture.kind !== 'draw') {
      setSnapHint(null);
      setBindHint(null);
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

      // A drawn line connects to the shapes its ends land on.
      if (next.kind === 'line') {
        const a = endpoint(null, next.a, mods);
        const b = endpoint(null, next.b, mods);

        next = {
          ...next,
          a: a.point,
          b: b.point,
          ...(a.binding ? { from: a.binding } : {}),
          ...(b.binding ? { to: b.binding } : {}),
        };
      }
    }

    setSnapHint(null);
    setBindHint(null);

    const resolved = resolveDraft(next);

    if (
      isConnector(resolved) &&
      dist(resolved.a, resolved.b) < 3
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
    editLabel(next);
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
        select(new Set(
          shapesRef.current.filter(s => !isLabel(s)).map(s => s.id),
        ));
        return;
      }

      if (mod && key === 'c') {
        if (copySelection()) event.preventDefault();
        return;
      }

      if (mod && key === 'x') {
        if (copySelection()) {
          event.preventDefault();
          deleteSelected();
        }
        return;
      }

      if (mod && key === 'v') {
        if (clipboard.length) {
          event.preventDefault();
          paste();
        }
        return;
      }

      if (mod && key === 'd') {
        event.preventDefault();
        duplicate();
        return;
      }

      if (
        mod &&
        (event.code === 'BracketRight' || event.code === 'BracketLeft')
      ) {
        event.preventDefault();
        const up = event.code === 'BracketRight';
        reorder(
          event.shiftKey
            ? up ? 'front' : 'back'
            : up ? 'forward' : 'backward',
        );
        return;
      }

      const arrows: Record<string, Pt> = {
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };

      if (arrows[event.key] && selectedRef.current.size && !mod) {
        event.preventDefault();
        const step = grid ? GRID : event.shiftKey ? 10 : 1;
        nudge(arrows[event.key].x * step, arrows[event.key].y * step);
        return;
      }

      if (event.key === 'Enter' && !mod) {
        const shape = singleSelected();

        if (shape) {
          event.preventDefault();

          if (shape.kind === 'text') {
            startText({ existing: true, shape: { ...shape } });
          } else {
            editLabel(shape);
          }
        }
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

  // Font size reaches the labels of selected shapes as well as selected text.
  const isSelectedText = (s: Shape, ids: Set<string>): s is TextShape =>
    s.kind === 'text' &&
    (ids.has(s.id) || Boolean(s.labelFor && ids.has(s.labelFor)));

  const selectedTexts = shapes.filter(
    (s): s is TextShape => isSelectedText(s, selected),
  );

  const updateDraft = (patch: Partial<TextShape>) => {
    const currentDraft = textRef.current;
    if (!currentDraft) return false;

    setText({
      ...currentDraft,
      shape: placeText({ ...currentDraft.shape, ...patch }),
    });
    return true;
  };

  const mixedColors = selectedShapes.length > 1 &&
    selectedShapes.some(s => s.color !== selectedShapes[0].color);

  const displayedColor = textDraft?.shape.color ??
    selectedShapes[0]?.color ??
    color;

  const applyColor = (value: string) => {
    setColor(value);

    if (updateDraft({ color: value })) {
      inputRef.current?.focus();
      return;
    }

    if (selectedRef.current.size) {
      commit(
        shapesRef.current.map(s =>
          selectedRef.current.has(s.id) ? { ...s, color: value } : s,
        ),
      );
    }
  };

  const stroked = selectedShapes.filter(s => s.kind !== 'text');

  const mixedWidths = stroked.length > 1 &&
    stroked.some(s => s.width !== stroked[0].width);

  const displayedWidth = stroked[0]?.width ?? width;

  const applyWidth = (value: number) => {
    setWidth(value);

    if (stroked.length) {
      commit(
        shapesRef.current.map(s =>
          selectedRef.current.has(s.id) && s.kind !== 'text'
            ? { ...s, width: value }
            : s,
        ),
      );
    }
  };

  const freeTexts = selectedShapes.filter(s => s.kind === 'text' && !s.labelFor);
  const canAttach = freeTexts.length > 0 &&
    selectedShapes.some(canHaveLabel);

  const attachSelected = () => {
    const result = attachTexts(shapesRef.current, selectedRef.current);
    if (!result.count) {
      setToast('Put the text inside a selected shape to attach it');
      return;
    }

    commit(result.shapes);
    select(new Set(
      [...selectedRef.current].filter(id =>
        !result.shapes.some(s => s.id === id && isLabel(s)),
      ),
    ));
    setToast(result.count === 1 ? 'Label attached' : `${result.count} labels attached`);
  };

  const canDetach = shapes.some(s =>
    isLabel(s) && (selected.has(s.id) || selected.has(s.labelFor)),
  );

  const detachSelected = () => {
    commit(detachLabels(shapesRef.current, selectedRef.current));
    setToast('Label detached');
  };

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

    if (updateDraft({ size })) return;

    if (selectedTexts.length) {
      commit(
        shapesRef.current.map(s =>
          isSelectedText(s, selectedRef.current)
            ? { ...s, size }
            : s,
        ),
      );
    }
  };

  const input = textDraft?.shape;

  const inputWidth = input
    ? Math.max(
        input.labelFor ? 280 : 180,
        input.text.length * input.size * 0.75 + 40,
      )
    : 0;

  const hint = input?.labelFor
    ? 'Type a label · Enter saves · Esc skips'
    : input
      ? 'Enter saves · Esc cancels'
      : tool === 'select'
        ? selected.size
          ? `${selected.size} selected · Drag to move · Enter: label · ⌘D: duplicate · Arrows: nudge · ⌘]/⌘[: order · Alt: no snapping`
          : 'Drag empty space to box-select · Double-click a shape to label it · Alt+click picks a label'
        : tool === 'line' || tool === 'arrow'
          ? 'Start or end on a shape to connect it · Shift: 15° steps · Alt: no snapping'
          : tool === 'rect' || tool === 'ellipse'
            ? 'Shift: square / circle · Alt: no snapping'
            : tool === 'pen'
              ? 'With Assist on, rough shapes become clean ones'
              : tool === 'text'
                ? 'Click to add text · click existing text to edit'
                : 'Drag over shapes to erase them';

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
              data-keeps-text="true"
              title={`Stroke ${COLOR_NAMES[index]}`}
              aria-label={`Stroke ${COLOR_NAMES[index]}`}
              aria-pressed={!mixedColors && displayedColor === value}
              onClick={() => applyColor(value)}
              className={cn(
                'h-6 w-6 rounded-full border-2',
                !mixedColors && displayedColor === value
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
              aria-pressed={!mixedWidths && displayedWidth === value}
              active={!mixedWidths && displayedWidth === value}
              onClick={() => applyWidth(value)}
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
            data-keeps-text="true"
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
              title={selected.size ? 'Delete selection (Delete)' : 'Clear sketch (undoable)'}
              aria-label={selected.size ? 'Delete selection' : 'Clear sketch'}
              onClick={() => {
                if (selectedRef.current.size) deleteSelected();
                else clearAll();
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
              if (!gestureRef.current) {
                setSnapHint(null);
                setBindHint(null);
              }
            }}
            onDoubleClick={event => {
              if (tool !== 'select' && tool !== 'text') return;

              if (
                (event.target as Element).closest('[data-text-editor]')
              ) {
                return;
              }

              if (editAt(local(event))) event.preventDefault();
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

            {bindHint && (() => {
              const host = shapes.find(s => s.id === bindHint);
              if (!host) return null;

              return (
                <polyline
                  points={outline(host).map(q => `${q.x},${q.y}`).join(' ')}
                  fill="#3b82f60f"
                  stroke="#3b82f6"
                  strokeOpacity={0.55}
                  strokeWidth={host.width + 5}
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
              );
            })()}

            {guides.length > 0 && (
              <g
                pointerEvents="none"
                stroke="#ec4899"
                strokeWidth={1}
              >
                {guides.map((g, index) => {
                  if (g.type === 'align') {
                    return g.axis === 'x'
                      ? <line key={index} x1={g.at} x2={g.at} y1={g.from - 8} y2={g.to + 8} />
                      : <line key={index} y1={g.at} y2={g.at} x1={g.from - 8} x2={g.to + 8} />;
                  }

                  // Equal-gap marker: a span with end ticks.
                  return g.axis === 'x' ? (
                    <g key={index}>
                      <line x1={g.from} x2={g.to} y1={g.at} y2={g.at} />
                      <line x1={g.from} x2={g.from} y1={g.at - 4} y2={g.at + 4} />
                      <line x1={g.to} x2={g.to} y1={g.at - 4} y2={g.at + 4} />
                    </g>
                  ) : (
                    <g key={index}>
                      <line y1={g.from} y2={g.to} x1={g.at} x2={g.at} />
                      <line y1={g.from} y2={g.from} x1={g.at - 4} x2={g.at + 4} />
                      <line y1={g.to} y2={g.to} x1={g.at - 4} x2={g.at + 4} />
                    </g>
                  );
                })}
              </g>
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
                x={input.align === 'center' ? input.x - inputWidth / 2 : input.x - 2}
                y={input.y - 2}
                width={inputWidth}
                height={input.size * 1.5 + 8}
                style={{ overflow: 'visible' }}
              >
                <input
                  ref={inputRef}
                  aria-label={
                    input.labelFor
                      ? 'Shape label'
                      : textDraft?.existing
                        ? 'Edit text'
                        : 'New text'
                  }
                  value={input.text}
                  placeholder={
                    input.labelFor
                      ? 'Label (Enter saves, Esc skips)'
                      : 'Type...'
                  }
                  onPointerDown={event => event.stopPropagation()}
                  onDoubleClick={event => event.stopPropagation()}
                  onChange={event => {
                    const current = textRef.current;
                    if (!current) return;

                    setText({
                      ...current,
                      shape: {
                        ...current.shape,
                        text: event.target.value,
                      },
                    });
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
                        ?.closest('[data-keeps-text]')
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
                    textAlign: input.align === 'center' ? 'center' : 'left',
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

        <div className="flex min-h-10 items-center gap-2 border-t border-zinc-100 px-4 py-1 text-xs text-zinc-500">
          <span className="min-w-0 flex-1 truncate" title={hint}>
            {hint}
          </span>

          {tool === 'select' && selected.size > 0 && !textDraft && (
            <div
              role="group"
              aria-label="Arrange selection"
              className="flex shrink-0 items-center gap-0.5"
            >
              {canAttach && (
                <Button
                  className="h-7 px-2 text-xs"
                  title="Attach the selected text to the shape it sits in"
                  onClick={attachSelected}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Attach text
                </Button>
              )}

              {canDetach && (
                <Button
                  className="h-7 px-2 text-xs"
                  title="Turn the label back into free text"
                  onClick={detachSelected}
                >
                  <Unlink2 className="h-3.5 w-3.5" />
                  Detach label
                </Button>
              )}

              <Button
                size="icon"
                className="h-7 w-7"
                title="Duplicate (Ctrl/⌘+D)"
                aria-label="Duplicate"
                onClick={duplicate}
              >
                <CopyPlus className="h-3.5 w-3.5" />
              </Button>

              <Button
                size="icon"
                className="h-7 w-7"
                title="Bring to front (Ctrl/⌘+Shift+])"
                aria-label="Bring to front"
                onClick={() => reorder('front')}
              >
                <BringToFront className="h-3.5 w-3.5" />
              </Button>

              <Button
                size="icon"
                className="h-7 w-7"
                title="Send to back (Ctrl/⌘+Shift+[)"
                aria-label="Send to back"
                onClick={() => reorder('back')}
              >
                <SendToBack className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
