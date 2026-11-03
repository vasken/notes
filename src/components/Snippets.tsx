import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

import { useStore } from '../store';
import type { Snippet, SnippetKind } from '../types';
import {
  ImportSketchButton,
  importSketch,
  isJsonFile,
  readSketchFile,
  sketchJsonIn,
  spliceSnippet,
  type Insertion,
} from './ImportSketchButton';

import {
  removeSnippetReference,
  snippetIdsIn,
} from '../lib/util';

import { SketchView } from './SketchView';
import { Pencil, Shapes, Upload } from 'lucide-react';
import { Button } from './ui';

type Draft = {
  title: string;
  summary: string;
  kind: SnippetKind;
  language: string;
  content: string;
};

const EMPTY: Draft = {
  title: '',
  summary: '',
  kind: 'text',
  language: '',
  content: '',
};

const MAX_PNG_BYTES = 2 * 1024 * 1024;

const PNG_SIGNATURE = [
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
];

async function readPng(file: File): Promise<string> {
  if (file.size > MAX_PNG_BYTES) {
    throw new Error('Choose a PNG smaller than 2 MB.');
  }

  const header = new Uint8Array(
    await file.slice(0, 8).arrayBuffer(),
  );

  if (
    header.length !== 8 ||
    !PNG_SIGNATURE.every((value, index) => header[index] === value)
  ) {
    throw new Error('The selected file is not a PNG.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Could not read the PNG.'));
    };

    reader.onabort = () => {
      reject(new Error('Reading the PNG was cancelled.'));
    };

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not encode the PNG.'));
        return;
      }

      const comma = reader.result.indexOf(',');

      if (comma < 0) {
        reject(new Error('Could not encode the PNG.'));
        return;
      }

      resolve(
        `data:image/png;base64,${reader.result.slice(comma + 1)}`,
      );
    };

    reader.readAsDataURL(file);
  });
}

function metadata(item: Snippet): string {
  if (item.kind === 'png') return 'PNG image';
  if (item.kind === 'sketch') return 'Sketch';

  const lines = item.content
    ? item.content.split('\n').length
    : 0;

  return [
    item.kind === 'code' ? item.language || 'Code' : 'Text',
    `${lines} lines`,
  ].join(' · ');
}

export function SnippetCard({
  id,
  onRemove,
}: {
  id: string;
  onRemove?: () => void;
}) {
  const item = useStore(state => state.snippets[id]);
  const [open, setOpen] = useState(false);

  if (!item) {
    return (
      <div className="not-prose my-2 rounded-lg border border-dashed p-3 text-sm text-zinc-400">
        Missing snippet: {id}
        {onRemove && (
          <Button onClick={onRemove}>Remove reference</Button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="not-prose my-2 rounded-xl border border-zinc-200 bg-white p-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">
              {item.title}
            </div>

            <div className="mt-0.5 text-xs text-zinc-400">
              {metadata(item)}
            </div>

            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">
              {item.summary || 'No summary'}
            </p>
          </div>

          <div className="flex shrink-0 gap-1">
            <Button onClick={() => setOpen(true)}>
              Open
            </Button>

            {onRemove && (
              <Button
                variant="danger"
                title="Remove reference from this note"
                onClick={onRemove}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {open && (
        <SnippetDialog
          item={item}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function SnippetPreview({
  id,
  onRemove,
}: {
  id: string;
  onRemove?: () => void;
}) {
  const item = useStore(state => state.snippets[id]);

  const sketch = useStore(state =>
    item?.kind === 'sketch'
      ? state.sketches[item.content]
      : undefined,
  );

  const openSketch = useStore(state => state.openSketch);

  if (
    !item ||
    (item.kind !== 'png' && item.kind !== 'sketch')
  ) {
    return <SnippetCard id={id} onRemove={onRemove} />;
  }

  return (
    <div className="not-prose my-4 overflow-hidden rounded-xl border border-zinc-200 bg-white">
      {item.kind === 'png' ? (
        <img
          src={item.content}
          alt={item.title}
          loading="lazy"
          className="block max-h-[32rem] w-full object-contain"
        />
      ) : sketch ? (
        <button
          type="button"
          title="Open sketch editor"
          aria-label={`Edit sketch: ${item.title}`}
          onClick={() => openSketch(item.content)}
          className="group relative block w-full cursor-pointer bg-white p-3 text-left hover:bg-zinc-50"
        >
          {sketch.shapes.length ? (
            <SketchView
              sketch={sketch}
              className="block max-h-96 w-full"
            />
          ) : (
            <span className="block p-8 text-center text-sm text-zinc-400">
              Empty sketch: click to draw
            </span>
          )}

          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <Pencil className="h-3 w-3" />
            Edit sketch
          </span>
        </button>
      ) : (
        <div className="p-4 text-sm text-zinc-400">
          The referenced sketch is missing.
        </div>
      )}

      <div className="border-t border-zinc-100 px-3 py-2">
        <div className="text-sm font-medium">
          {item.title}
        </div>

        {item.summary && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500">
            {item.summary}
          </p>
        )}

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="mt-2 text-xs text-red-600 hover:underline"
          >
            Remove from note
          </button>
        )}
      </div>
    </div>
  );
}

function SnippetDialog({
  item,
  noteId,
  onClose,
  onCreate,
}: {
  item?: Snippet;
  noteId?: string;
  onClose: () => void;
  onCreate?: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    item
      ? {
          title: item.title,
          summary: item.summary,
          kind: item.kind,
          language: item.language ?? '',
          content: item.content,
        }
      : { ...EMPTY },
  );

  const [editing, setEditing] = useState(!item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sketch = useStore(state =>
    draft.kind === 'sketch'
      ? state.sketches[draft.content]
      : undefined,
  );

  const patch = (value: Partial<Draft>) => {
    setDraft(previous => ({ ...previous, ...value }));
  };

  const save = () => {
    if (busy) return;

    setError(null);

    try {
      if (draft.kind === 'png' && !draft.content) {
        throw new Error('Choose a PNG first.');
      }

      const state = useStore.getState();

      const content =
        draft.kind === 'sketch' && !draft.content
          ? state.createSketch()
          : draft.content;

      const input = {
        title: draft.title.trim() || 'Untitled snippet',
        summary: draft.summary.trim(),
        kind: draft.kind,
        language: draft.language.trim() || undefined,
        content,
      };

      if (item) {
        state.updateSnippet(item.id, {
          title: input.title,
          summary: input.summary,
          language: input.language,
          content: input.content,
        });
      } else {
        const id = state.createSnippet(input);
        onCreate?.(id);
      }

      onClose();

      if (!item && draft.kind === 'sketch') {
        state.openSketch(content);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save the snippet.',
      );
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.content);
      setError(null);
    } catch {
      setError('Clipboard access was unavailable.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm"
      onClick={event => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={item ? 'Snippet' : 'Add snippet'}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b p-3">
          <h2 className="min-w-0 flex-1 truncate font-semibold">
            {item ? draft.title : 'Add snippet'}
          </h2>

          {item && !editing && (
            <Button onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}

          {(draft.kind === 'text' || draft.kind === 'code') && (
            <Button onClick={() => void copy()}>
              Copy
            </Button>
          )}

          <Button disabled={busy} onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {editing ? (
            <>
              {!item && (
                <label className="block text-sm">
                  Type
                  <select
                    value={draft.kind}
                    disabled={busy}
                    onChange={event => {
                      patch({
                        kind: event.target.value as SnippetKind,
                        content: '',
                      });
                      setError(null);
                    }}
                    className="mt-1 block h-9 w-full rounded-md border px-2"
                  >
                    <option value="text">Text</option>
                    <option value="code">Code</option>
                    <option value="png">PNG image</option>
                    <option value="sketch">Sketch</option>
                  </select>
                </label>
              )}

              <label className="block text-sm">
                Title
                <input
                  value={draft.title}
                  onChange={event => patch({
                    title: event.target.value,
                  })}
                  className="mt-1 block h-9 w-full rounded-md border px-2"
                  placeholder="Architecture diagram"
                />
              </label>

              <label className="block text-sm">
                Summary shown in the note
                <textarea
                  value={draft.summary}
                  onChange={event => patch({
                    summary: event.target.value,
                  })}
                  className="mt-1 block min-h-20 w-full rounded-md border p-2"
                  placeholder="A short description of the hidden content."
                />
              </label>

              {draft.kind === 'code' && (
                <label className="block text-sm">
                  Language
                  <input
                    value={draft.language}
                    onChange={event => patch({
                      language: event.target.value,
                    })}
                    className="mt-1 block h-9 w-full rounded-md border px-2"
                    placeholder="typescript"
                  />
                </label>
              )}

              {(draft.kind === 'text' || draft.kind === 'code') && (
                <label className="block text-sm">
                  Full content
                  <textarea
                    value={draft.content}
                    onChange={event => patch({
                      content: event.target.value,
                    })}
                    spellCheck={draft.kind !== 'code'}
                    className="mt-1 block min-h-64 w-full rounded-md border p-3 font-mono text-sm"
                  />
                </label>
              )}

              {draft.kind === 'png' && (
                <div className="space-y-3">
                  <input
                    type="file"
                    accept="image/png,.png"
                    disabled={busy}
                    aria-label="Choose snippet PNG"
                    onChange={async event => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (!file) return;

                      setBusy(true);
                      setError(null);

                      try {
                        const content = await readPng(file);

                        setDraft(previous => ({
                          ...previous,
                          content,
                          title: previous.title || file.name,
                        }));
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : 'Could not read the PNG.',
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />

                  {draft.content && (
                    <img
                      src={draft.content}
                      alt={draft.title || 'PNG snippet'}
                      className="max-h-96 max-w-full rounded-lg border object-contain"
                    />
                  )}
                </div>
              )}

              {draft.kind === 'sketch' && !draft.content && (
                <div className="space-y-3 rounded-lg border border-dashed p-4">
                  <p className="text-sm text-zinc-500">
                    Create a blank sketch using the button below,
                    or import an editable sketch JSON file.
                  </p>

                  {!item && noteId && (
                    <ImportSketchButton
                      noteId={noteId}
                      onImported={onClose}
                    />
                  )}

                  <p className="text-xs text-zinc-400">
                    Imported sketches use the title and summary from the JSON
                    file. You can edit those afterward.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm text-zinc-600">
                {draft.summary || 'No summary'}
              </p>

              {draft.kind === 'text' && (
                <div className="whitespace-pre-wrap break-words">
                  {draft.content}
                </div>
              )}

              {draft.kind === 'code' && (
                <pre className="overflow-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-100">
                  <code>{draft.content}</code>
                </pre>
              )}

              {draft.kind === 'png' && (
                <img
                  src={draft.content}
                  alt={draft.title}
                  className="max-h-[60vh] max-w-full rounded-lg object-contain"
                />
              )}
            </>
          )}

          {draft.kind === 'sketch' && draft.content && (
            <div className="space-y-3">
              {sketch ? (
                <SketchView
                  sketch={sketch}
                  className="max-h-96 w-full rounded-lg border"
                />
              ) : (
                <p className="text-sm text-red-600">
                  The referenced sketch is missing.
                </p>
              )}

              {sketch && (
                <Button
                  variant="outline"
                  onClick={() =>
                    useStore.getState().openSketch(draft.content)
                  }
                >
                  Open sketch editor
                </Button>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </div>

        {editing && (
          <footer className="flex justify-end border-t p-3">
            <Button
              variant="default"
              disabled={busy}
              onClick={save}
            >
              {busy
                ? 'Reading PNG…'
                : !item && draft.kind === 'sketch'
                  ? 'Create blank sketch'
                  : 'Save snippet'}
            </Button>
          </footer>
        )}
      </section>
    </div>
  );
}

function captureInsertion(
  noteId: string,
  textarea: HTMLTextAreaElement | null,
): Insertion | null {
  const note = useStore.getState().notes.find(
    item => item.id === noteId,
  );
  if (!note) return null;

  return {
    body: note.body,
    start: textarea?.selectionStart ?? note.body.length,
    end: textarea?.selectionEnd ?? note.body.length,
  };
}

export type SketchActions = ReturnType<typeof useSketchActions>;

/**
 * New, imported (file, drop) and pasted sketches all land at the
 * cursor and open straight in the sketch editor.
 */
export function useSketchActions({
  noteId,
  textareaRef,
  useSelection,
}: {
  noteId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  useSelection: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const capture = () =>
    captureInsertion(
      noteId,
      useSelection ? textareaRef.current : null,
    );

  const fail = (cause: unknown, fallback: string) => {
    setError(cause instanceof Error ? cause.message : fallback);
  };

  const create = () => {
    const insertion = capture();
    if (!insertion) return;

    setError(null);

    const state = useStore.getState();
    const sketchId = state.createSketch();

    const id = state.createSnippet({
      title: 'Untitled sketch',
      summary: '',
      kind: 'sketch',
      content: sketchId,
    });

    const note = state.notes.find(item => item.id === noteId);
    if (!note) return;

    state.updateNote(noteId, {
      body: spliceSnippet(note.body, id, insertion).body,
    });

    // The sketch editor ignores keys aimed at text fields.
    (document.activeElement as HTMLElement | null)?.blur();
    state.openSketch(sketchId);
  };

  const importFile = async (file: File) => {
    const insertion = capture();
    setBusy(true);
    setError(null);

    try {
      if (!isJsonFile(file)) {
        throw new Error(
          `${file.name} is not a sketch. Sketches import from .json files.`,
        );
      }

      importSketch(
        noteId,
        await readSketchFile(file),
        file.name,
        insertion,
      );
    } catch (cause) {
      fail(cause, 'Could not import the sketch.');
    } finally {
      setBusy(false);
    }
  };

  /** True when the pasted text was taken as a sketch. */
  const importPasted = (text: string): boolean => {
    const value = sketchJsonIn(text);
    if (!value) return false;

    try {
      importSketch(noteId, value, 'Pasted sketch', capture());
      setError(null);
      return true;
    } catch (cause) {
      // Keep the paste as text, and say why it was not a sketch.
      fail(cause, 'Could not import the sketch.');
      return false;
    }
  };

  const createRef = useRef(create);
  createRef.current = create;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || !event.shiftKey || event.key.toLowerCase() !== 'k') return;

      if (useStore.getState().editingSketchId) return;

      // Other fields (titles, dialogs) keep their own keys.
      const target = event.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        (target.tagName === 'TEXTAREA' && target !== textareaRef.current) ||
        target.isContentEditable;
      if (typing || document.querySelector('[role="dialog"]')) return;

      event.preventDefault();
      createRef.current();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [textareaRef]);

  return {
    create,
    importFile,
    importPasted,
    busy,
    error,
    clearError: () => setError(null),
  };
}

/** "Sketch" and its import option, joined as one control. */
export function SketchButtons({ actions }: { actions: SketchActions }) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex">
      <Button
        variant="outline"
        title="New sketch (Ctrl/Cmd+Shift+K)"
        onClick={actions.create}
        className="rounded-r-none"
      >
        <Shapes className="h-4 w-4" />
        Sketch
      </Button>

      <Button
        variant="outline"
        size="icon"
        disabled={actions.busy}
        title="Import sketch JSON. You can also drop a .json file on the note, or paste sketch JSON."
        aria-label="Import sketch JSON"
        onClick={() => fileRef.current?.click()}
        className="-ml-px rounded-l-none"
      >
        <Upload className="h-4 w-4" />
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
          if (file) void actions.importFile(file);
        }}
      />
    </div>
  );
}

export function SnippetTools({
  noteId,
  textareaRef,
  useSelection,
}: {
  noteId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  useSelection: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const insertionRef = useRef<Insertion | null>(null);

  const begin = () => {
    const insertion = captureInsertion(
      noteId,
      useSelection ? textareaRef.current : null,
    );
    if (!insertion) return;

    insertionRef.current = insertion;
    setAdding(true);
  };

  const insert = (id: string) => {
    const state = useStore.getState();
    const note = state.notes.find(item => item.id === noteId);
    if (!note) return;

    const { body, caret } = spliceSnippet(
      note.body,
      id,
      insertionRef.current,
    );

    state.updateNote(noteId, { body });

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;

      if (
        !useSelection ||
        !textarea ||
        textarea.value !== body ||
        useStore.getState().editingSketchId
      ) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  };

  return (
    <>
      <Button variant="outline" onClick={begin}>
        Add snippet
      </Button>

      {adding && (
        <SnippetDialog
          noteId={noteId}
          onClose={() => setAdding(false)}
          onCreate={insert}
        />
      )}
    </>
  );
}

export function NoteSnippetCards({
  noteId,
}: {
  noteId: string;
}) {
  const body = useStore(state =>
    state.notes.find(note => note.id === noteId)?.body ?? '',
  );

  const ids = snippetIdsIn(body);
  if (!ids.length) return null;

  return (
    <div className="max-h-52 shrink-0 overflow-auto border-t bg-zinc-50 px-4 py-2">
      {ids.map(id => (
        <SnippetCard
          key={id}
          id={id}
          onRemove={() => {
            const state = useStore.getState();
            const note = state.notes.find(item => item.id === noteId);
            if (!note) return;

            state.updateNote(noteId, {
              body: removeSnippetReference(note.body, id),
            });
          }}
        />
      ))}
    </div>
  );
}
