import {
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import {
  Bold,
  Code,
  Columns2,
  Eye,
  Heading2,
  Italic,
  Link,
  List,
  ListChecks,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';

import { useStore } from '../store';
import { relTime } from '../lib/util';

import { Button, Separator } from './ui';
import { Markdown } from './Markdown';
import { NoteSnippetCards, SnippetTools } from './Snippets';

type Mode = 'edit' | 'split' | 'preview';

function initialMode(): Mode {
  const saved = localStorage.getItem('notes.editorMode');

  return saved === 'edit' || saved === 'preview'
    ? saved
    : 'split';
}

export function NoteEditor({
  id,
  onClose,
}: {
  id: string;
  onClose?: () => void;
}) {
  const note = useStore(state =>
    state.notes.find(item => item.id === id),
  );

  const groups = useStore(state => state.groups);
  const updateNote = useStore(state => state.updateNote);
  const setNoteGroup = useStore(state => state.setNoteGroup);
  const deleteNote = useStore(state => state.deleteNote);

  const [mode, setModeState] = useState<Mode>(initialMode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!note) return null;

  const body = note.body;
  const showEdit = mode !== 'preview';
  const showPreview = mode !== 'edit';

  const setBody = (next: string) => {
    updateNote(id, { body: next });
  };

  const setMode = (next: Mode) => {
    localStorage.setItem('notes.editorMode', next);
    setModeState(next);
  };

  const edit = (
    transform: (selection: string) => {
      text: string;
      selectionStart?: number;
      selectionEnd?: number;
    },
  ) => {
    const textarea = textareaRef.current;

    const start = textarea && showEdit
      ? textarea.selectionStart
      : body.length;

    const end = textarea && showEdit
      ? textarea.selectionEnd
      : body.length;

    const result = transform(body.slice(start, end));

    setBody(
      body.slice(0, start) +
      result.text +
      body.slice(end),
    );

    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;

      const selectionStart =
        result.selectionStart ?? result.text.length;

      const selectionEnd =
        result.selectionEnd ?? selectionStart;

      element.focus();
      element.setSelectionRange(
        start + selectionStart,
        start + selectionEnd,
      );
    });
  };

  const wrap = (
    before: string,
    after = before,
    placeholder = 'text',
  ) => {
    edit(selection => {
      const inner = selection || placeholder;

      return {
        text: before + inner + after,
        selectionStart: before.length,
        selectionEnd: before.length + inner.length,
      };
    });
  };

  const prefix = (marker: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart === 0
      ? 0
      : body.lastIndexOf('\n', textarea.selectionStart - 1) + 1;

    const end = textarea.selectionEnd;

    const block = body
      .slice(start, end)
      .split('\n')
      .map(line => marker + line)
      .join('\n');

    setBody(body.slice(0, start) + block + body.slice(end));

    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;

      const caret = start + block.length;
      element.focus();
      element.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (mod && key === 'b') {
      event.preventDefault();
      wrap('**');
      return;
    }

    if (mod && key === 'i') {
      event.preventDefault();
      wrap('*');
      return;
    }

    if (mod && key === 'k') {
      event.preventDefault();
      wrap('[', '](https://)', 'link');
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      edit(() => ({ text: '  ' }));
      return;
    }

    if (event.key !== 'Enter' || event.shiftKey) return;

    const textarea = event.currentTarget;
    const cursor = textarea.selectionStart;

    const lineStart = cursor === 0
      ? 0
      : body.lastIndexOf('\n', cursor - 1) + 1;

    const line = body.slice(lineStart, cursor);

    const match = line.match(
      /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)\. )(.*)$/,
    );

    if (!match) return;

    event.preventDefault();

    if (!match[4].trim()) {
      setBody(body.slice(0, lineStart) + body.slice(cursor));

      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(
          lineStart,
          lineStart,
        );
      });

      return;
    }

    const marker = match[3]
      ? `${Number(match[3]) + 1}. `
      : match[2].replace(/\[[xX]\]/, '[ ]');

    edit(() => ({
      text: `\n${match[1]}${marker}`,
    }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2">
        <input
          value={note.title}
          onChange={event =>
            updateNote(id, { title: event.target.value })
          }
          placeholder="Untitled"
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-zinc-300"
        />

        <select
          value={note.groupId ?? ''}
          onChange={event =>
            setNoteGroup(id, event.target.value || null)
          }
          title="Group"
          className="h-8 max-w-40 rounded-md border bg-white px-2 text-sm"
        >
          <option value="">No group</option>

          {groups.map(group => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>

        <Button
          variant="danger"
          size="icon"
          title="Delete note"
          onClick={() => {
            if (confirm('Delete this note?')) deleteNote(id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        {onClose && (
          <Button size="icon" title="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-100 px-3 py-1.5">
        <Button
          size="icon"
          title="Bold"
          disabled={!showEdit}
          onClick={() => wrap('**')}
        >
          <Bold className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          title="Italic"
          disabled={!showEdit}
          onClick={() => wrap('*')}
        >
          <Italic className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          title="Heading"
          disabled={!showEdit}
          onClick={() => prefix('## ')}
        >
          <Heading2 className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          title="Bulleted list"
          disabled={!showEdit}
          onClick={() => prefix('- ')}
        >
          <List className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          title="Checklist"
          disabled={!showEdit}
          onClick={() => prefix('- [ ] ')}
        >
          <ListChecks className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          title="Inline code"
          disabled={!showEdit}
          onClick={() => wrap('`', '`', 'code')}
        >
          <Code className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          title="Link"
          disabled={!showEdit}
          onClick={() => wrap('[', '](https://)', 'link')}
        >
          <Link className="h-4 w-4" />
        </Button>

        <Separator vertical />

        <SnippetTools
          noteId={id}
          textareaRef={textareaRef}
          useSelection={showEdit}
        />

        <div className="ml-auto flex items-center rounded-lg bg-zinc-100 p-0.5">
          {([
            ['edit', Pencil, 'Edit'],
            ['split', Columns2, 'Split'],
            ['preview', Eye, 'Preview'],
          ] as const).map(([value, Icon, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={
                'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium ' +
                (mode === value
                  ? 'bg-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-800')
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {showEdit && (
          <textarea
            ref={textareaRef}
            value={body}
            onChange={event => setBody(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Start writing…"
            spellCheck
            className={
              'min-h-0 min-w-0 flex-1 resize-none p-5 font-mono text-sm leading-relaxed outline-none ' +
              (showPreview ? 'border-r border-zinc-100' : '')
            }
          />
        )}

        {showPreview && (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
            {body.trim() ? (
              <Markdown source={body} onChange={setBody} />
            ) : (
              <p className="text-sm text-zinc-400">
                Nothing to preview yet.
              </p>
            )}
          </div>
        )}
      </div>

      {showEdit && <NoteSnippetCards noteId={id} />}

      <footer className="border-t border-zinc-100 px-4 py-1.5 text-xs text-zinc-400">
        Edited {relTime(note.updatedAt)}
      </footer>
    </div>
  );
}
