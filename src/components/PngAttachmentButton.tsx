import { useRef, useState, type RefObject } from 'react';
import { ImagePlus } from 'lucide-react';
import { useStore } from '../store';
import { Button } from './ui';

const MAX_PNG_BYTES = 2 * 1024 * 1024;

// Leaves headroom under the existing server's JSON request limit.
const MAX_STATE_BYTES = 32 * 1024 * 1024;

const PNG_SIGNATURE = [
  0x89, 0x50, 0x4e, 0x47,
  0x0d, 0x0a, 0x1a, 0x0a,
];

type Props = {
  noteId: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  useSelection: boolean;
};

type InsertionPoint = {
  body: string;
  start: number;
  end: number;
};

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Could not read the selected file.'));
    };

    reader.onabort = () => {
      reject(new Error('Reading the file was cancelled.'));
    };

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not encode the selected file.'));
        return;
      }

      // Use the validated content type rather than the supplied MIME type.
      const comma = reader.result.indexOf(',');

      if (comma < 0) {
        reject(new Error('Could not encode the selected file.'));
        return;
      }

      resolve(
        `data:image/png;base64,${reader.result.slice(comma + 1)}`,
      );
    };

    reader.readAsDataURL(file);
  });
}

async function validatePng(file: File): Promise<void> {
  if (file.size > MAX_PNG_BYTES) {
    throw new Error('Choose a PNG smaller than 2 MB.');
  }

  const header = new Uint8Array(
    await file.slice(0, PNG_SIGNATURE.length).arrayBuffer(),
  );

  if (
    header.length !== PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((value, index) => header[index] === value)
  ) {
    throw new Error('The selected file is not a PNG image.');
  }
}

function imageAlt(filename: string): string {
  const name = filename
    .replace(/\.png$/i, '')
    .replace(/[\r\n]/g, ' ')
    .trim();

  // Escape characters that have meaning inside Markdown image alt text.
  return (name || 'Attached PNG').replace(/[\\[\]]/g, '\\$&');
}

export function PngAttachmentButton({
  noteId,
  textareaRef,
  useSelection,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const insertionRef = useRef<InsertionPoint | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseFile = () => {
    const note = useStore.getState().notes.find(n => n.id === noteId);
    if (!note) return;

    const textarea = useSelection ? textareaRef.current : null;

    insertionRef.current = {
      body: note.body,
      start: textarea?.selectionStart ?? note.body.length,
      end: textarea?.selectionEnd ?? note.body.length,
    };

    setError(null);
    fileRef.current?.click();
  };

  const attach = async (file: File) => {
    setBusy(true);
    setError(null);

    try {
      await validatePng(file);
      const dataUrl = await readDataUrl(file);

      // Read the latest state after the asynchronous file operation.
      const state = useStore.getState();
      const note = state.notes.find(n => n.id === noteId);

      // The note might have been deleted while reading the file.
      if (!note) return;

      const insertion = insertionRef.current;
      const unchanged = insertion?.body === note.body;

      const start = unchanged
        ? insertion.start
        : note.body.length;

      const end = unchanged
        ? insertion.end
        : note.body.length;

      const markdown = `\n\n![${imageAlt(file.name)}](${dataUrl})\n\n`;

      const body =
        note.body.slice(0, start) +
        markdown +
        note.body.slice(end);

      const candidate = {
        version: 1,
        notes: state.notes.map(n =>
          n.id === noteId ? { ...n, body } : n,
        ),
        groups: state.groups,
        sketches: state.sketches,
      };

      const stateBytes = new Blob([
        JSON.stringify(candidate),
      ]).size;

      if (stateBytes > MAX_STATE_BYTES) {
        throw new Error(
          'This attachment would make the notes data too large. ' +
          'Remove an existing image or choose a smaller PNG.',
        );
      }

      state.updateNote(noteId, { body });

      requestAnimationFrame(() => {
        const textarea = textareaRef.current;

        // Avoid moving the caret in another note after navigation.
        if (
          !useSelection ||
          !textarea ||
          textarea.value !== body
        ) {
          return;
        }

        const caret = start + markdown.length;

        textarea.focus();
        textarea.setSelectionRange(caret, caret);
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not attach the PNG.',
      );
    } finally {
      insertionRef.current = null;
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        title="Attach a PNG image"
        disabled={busy}
        onClick={chooseFile}
      >
        <ImagePlus className="h-4 w-4" />
        {busy ? 'Attaching…' : 'Attach PNG'}
      </Button>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,.png"
        aria-label="Choose PNG attachment"
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0];

          // Allow selecting the same file again.
          event.currentTarget.value = '';

          if (file) void attach(file);
        }}
      />

      {error && (
        <span
          role="alert"
          className="px-2 text-xs text-red-600"
        >
          {error}
        </span>
      )}
    </>
  );
}
