import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';

import { useStore } from '../store';
import type { Binding, Pt, Shape, Sketch, Snippet } from '../types';
import { cloneShapes, resolveLayout } from '../lib/sketch-layout';
import { uid } from '../lib/util';
import { Button } from './ui';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_STATE_BYTES = 40 * 1024 * 1024;
const MAX_SHAPES = 5000;
const MAX_POINTS = 100000;
const MAX_CANVAS_SIZE = 20000;
const MAX_COORDINATE = 100000;

type ImportedSketch = {
  title: string;
  summary: string;
  w: number;
  h: number;
  shapes: Shape[];
};

function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function number(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${label} must be a number from ${minimum} to ${maximum}.`,
    );
  }

  return value;
}

function text(
  value: unknown,
  fallback: string,
  maximum: number,
  label: string,
): string {
  if (value === undefined) return fallback;

  if (typeof value !== 'string' || value.length > maximum) {
    throw new Error(
      `${label} must be text of at most ${maximum} characters.`,
    );
  }

  return value;
}

function color(
  value: unknown,
  fallback: string,
  allowNone: boolean,
): string {
  if (value === undefined) return fallback;

  if (allowNone && value === 'none') return 'none';

  if (
    typeof value !== 'string' ||
    !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(
      value,
    )
  ) {
    throw new Error(
      'Colors must be hex values such as #18181b or #e7effe. ' +
      'Fill may also be "none".',
    );
  }

  return value;
}

function point(value: unknown, label: string): Pt {
  const item = record(value, label);

  return {
    x: number(
      item.x,
      `${label}.x`,
      -MAX_COORDINATE,
      MAX_COORDINATE,
    ),
    y: number(
      item.y,
      `${label}.y`,
      -MAX_COORDINATE,
      MAX_COORDINATE,
    ),
  };
}

function reference(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;

  if (typeof value !== 'string' || !value || value.length > 200) {
    throw new Error(`${label} must be a shape id.`);
  }

  return value;
}

/** "boxId" floats to the shape's edge; { id, fx, fy } pins a point on it. */
function binding(value: unknown, label: string): Binding | undefined {
  if (value === undefined) return undefined;

  if (typeof value === 'string') {
    return { id: reference(value, label)!, fx: 0.5, fy: 0.5 };
  }

  const item = record(value, label);

  return {
    id: reference(item.id, `${label}.id`) ?? '',
    fx: number(item.fx ?? 0.5, `${label}.fx`, 0, 1),
    fy: number(item.fy ?? 0.5, `${label}.fy`, 0, 1),
  };
}

export function parseSketch(
  value: unknown,
  filename: string,
): ImportedSketch {
  const data = record(value, 'Sketch');

  if (data.version !== undefined && data.version !== 1) {
    throw new Error('Only sketch JSON version 1 is supported.');
  }

  if (
    !Array.isArray(data.shapes) ||
    data.shapes.length > MAX_SHAPES
  ) {
    throw new Error(
      `shapes must be an array containing at most ${MAX_SHAPES} items.`,
    );
  }

  let totalPoints = 0;
  const seen = new Set<string>();
  const labels: Shape[] = [];

  const shapes: Shape[] = data.shapes.map((value, index) => {
    const label = `Shape ${index + 1}`;
    const item = record(value, label);

    // Optional ids let shapes refer to each other (labels, connectors).
    // They are regenerated after parsing to avoid collisions.
    const sourceId = reference(item.id, `${label}.id`);

    if (sourceId && seen.has(sourceId)) {
      throw new Error(`${label} repeats the id "${sourceId}".`);
    }

    if (sourceId) seen.add(sourceId);

    const base = {
      id: sourceId ?? uid(),
      color: color(item.color, '#18181b', false),
      width: number(item.width ?? 2, `${label}.width`, 0.1, 100),
    };

    // Shorthand: "label": "Text" on a shape or connector adds an attached label.
    if (item.label !== undefined) {
      if (item.kind === 'text' || item.kind === 'path') {
        throw new Error(`${label}: only shapes and connectors can have a label.`);
      }

      labels.push({
        id: uid(),
        kind: 'text',
        x: 0,
        y: 0,
        text: text(item.label, '', 10000, `${label}.label`),
        size: number(item.labelSize ?? 16, `${label}.labelSize`, 1, 1000),
        color: color(item.labelColor, '#18181b', false),
        width: 1,
        labelFor: base.id,
        align: 'center',
      });
    }

    switch (item.kind) {
      case 'rect':
      case 'ellipse':
        return {
          ...base,
          kind: item.kind,
          x: number(
            item.x,
            `${label}.x`,
            -MAX_COORDINATE,
            MAX_COORDINATE,
          ),
          y: number(
            item.y,
            `${label}.y`,
            -MAX_COORDINATE,
            MAX_COORDINATE,
          ),
          w: number(item.w, `${label}.w`, 0.1, MAX_COORDINATE),
          h: number(item.h, `${label}.h`, 0.1, MAX_COORDINATE),
          fill: color(item.fill, 'none', true),
        };

      case 'line':
      case 'arrow':
        return {
          ...base,
          kind: item.kind,
          a: point(item.a, `${label}.a`),
          b: point(item.b, `${label}.b`),
          ...(item.from !== undefined
            ? { from: binding(item.from, `${label}.from`) }
            : {}),
          ...(item.to !== undefined
            ? { to: binding(item.to, `${label}.to`) }
            : {}),
        };

      case 'path':
      case 'polygon': {
        const minimum = item.kind === 'polygon' ? 3 : 1;

        if (
          !Array.isArray(item.points) ||
          item.points.length < minimum
        ) {
          throw new Error(
            `${label} requires at least ${minimum} points.`,
          );
        }

        totalPoints += item.points.length;

        if (totalPoints > MAX_POINTS) {
          throw new Error(
            `The sketch exceeds ${MAX_POINTS} total points.`,
          );
        }

        const points = item.points.map((value, pointIndex) =>
          point(value, `${label}.points[${pointIndex}]`),
        );

        if (item.kind === 'polygon') {
          return {
            ...base,
            kind: 'polygon',
            points,
            fill: color(item.fill, 'none', true),
          };
        }

        return {
          ...base,
          kind: 'path',
          points,
        };
      }

      case 'text':
        return {
          ...base,
          kind: 'text',
          x: number(
            item.x,
            `${label}.x`,
            -MAX_COORDINATE,
            MAX_COORDINATE,
          ),
          y: number(
            item.y,
            `${label}.y`,
            -MAX_COORDINATE,
            MAX_COORDINATE,
          ),
          text: text(item.text, '', 100000, `${label}.text`),
          size: number(item.size ?? 20, `${label}.size`, 1, 1000),
          ...(item.labelFor !== undefined
            ? { labelFor: reference(item.labelFor, `${label}.labelFor`) }
            : {}),
          ...(item.align === 'center' || item.labelFor !== undefined
            ? { align: 'center' as const }
            : {}),
        };

      default:
        throw new Error(
          `${label} has an unsupported kind: ${String(item.kind)}.`,
        );
    }
  });

  return {
    title: text(
      data.title,
      filename.replace(/\.json$/i, '') || 'Imported sketch',
      500,
      'Title',
    ),
    summary: text(
      data.summary,
      'Imported editable diagram.',
      10000,
      'Summary',
    ),
    w: number(data.w ?? 960, 'Canvas width', 1, MAX_CANVAS_SIZE),
    h: number(data.h ?? 600, 'Canvas height', 1, MAX_CANVAS_SIZE),
    // Fresh ids with references remapped (unknown ones dropped), then
    // labels and connector ends placed on their shapes.
    shapes: resolveLayout(cloneShapes([...shapes, ...labels])),
  };
}

export type Insertion = {
  body: string;
  start: number;
  end: number;
};

/**
 * Put a snippet reference on its own lines at the captured selection.
 * If the note changed since the capture, append instead.
 */
export function spliceSnippet(
  body: string,
  id: string,
  insertion?: Insertion | null,
): { body: string; caret: number } {
  const unchanged = insertion?.body === body;
  const start = unchanged ? insertion.start : body.length;
  const end = unchanged ? insertion.end : body.length;
  const reference = `\n\nsnippet:${id}\n\n`;

  return {
    body: body.slice(0, start) + reference + body.slice(end),
    caret: start + reference.length,
  };
}

/** Parsed JSON when the text has the shape of a sketch file, else null. */
export function sketchJsonIn(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.includes('"shapes"')) {
    return null;
  }

  try {
    const value = JSON.parse(trimmed) as unknown;
    return value &&
      typeof value === 'object' &&
      Array.isArray((value as { shapes?: unknown }).shapes)
      ? value
      : null;
  } catch {
    return null;
  }
}

export const isJsonFile = (file: File) =>
  file.type === 'application/json' || /\.json$/i.test(file.name);

export async function readSketchFile(file: File): Promise<unknown> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('Choose a sketch JSON file smaller than 5 MB.');
  }

  try {
    return JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error(`${file.name} is not valid JSON.`);
  }
}

/**
 * Atomic import: sketch, snippet and note reference land together,
 * then the editor opens on the new sketch.
 */
export function importSketch(
  noteId: string,
  value: unknown,
  filename: string,
  insertion?: Insertion | null,
) {
  const imported = parseSketch(value, filename);

  // Read the latest state; the file read may have been asynchronous.
  const state = useStore.getState();
  const note = state.notes.find(item => item.id === noteId);

  if (!note) {
    throw new Error('The destination note no longer exists.');
  }

  const sketchId = uid();
  const snippetId = uid();
  const now = Date.now();

  const sketch: Sketch = {
    id: sketchId,
    w: imported.w,
    h: imported.h,
    shapes: imported.shapes,
    updatedAt: now,
  };

  const snippet: Snippet = {
    id: snippetId,
    title: imported.title,
    summary: imported.summary,
    kind: 'sketch',
    content: sketchId,
    createdAt: now,
    updatedAt: now,
  };

  const sketches = { ...state.sketches, [sketchId]: sketch };
  const snippets = { ...state.snippets, [snippetId]: snippet };
  const { body } = spliceSnippet(note.body, snippetId, insertion);

  const notes = state.notes.map(item =>
    item.id === noteId ? { ...item, body, updatedAt: now } : item,
  );

  const bytes = new Blob([
    JSON.stringify({
      version: 1,
      notes,
      groups: state.groups,
      sketches,
      snippets,
    }),
  ]).size;

  if (bytes > MAX_STATE_BYTES) {
    throw new Error(
      'Importing this sketch would make the notes data exceed 40 MB.',
    );
  }

  // The sketch editor ignores keys aimed at text fields.
  (document.activeElement as HTMLElement | null)?.blur();

  // The existing store subscription handles autosave.
  useStore.setState({
    notes,
    sketches,
    snippets,
    editingSketchId: sketchId,
  });
}

export function ImportSketchButton({
  noteId,
  onImported,
}: {
  noteId: string;
  onImported?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importFile = async (file: File) => {
    setBusy(true);
    setError(null);

    try {
      importSketch(noteId, await readSketchFile(file), file.name);
      onImported?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not import the sketch.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        disabled={busy}
        title="Import an editable sketch from JSON"
        onClick={() => {
          setError(null);
          fileRef.current?.click();
        }}
      >
        <Upload className="h-4 w-4" />
        {busy ? 'Importing…' : 'Import sketch JSON'}
      </Button>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        aria-label="Choose sketch JSON"
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';

          if (file) void importFile(file);
        }}
      />

      {error && (
        <span role="alert" className="px-2 text-xs text-red-600">
          {error}
        </span>
      )}
    </>
  );
}
