import { useMemo, useRef, useState } from 'react';

import {
  Check,
  ChevronRight,
  Download,
  FileText,
  FolderPlus,
  Inbox,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Upload,
} from 'lucide-react';

import { GROUP_COLORS, useStore } from '../store';
import type { AppData, Group, Note } from '../types';

import {
  cn,
  matchesSearch,
  relTime,
  snippet,
  snippetIdsIn,
} from '../lib/util';

import { Button, ColorDot } from './ui';

const UNGROUPED = '__ungrouped__';

function loadCollapsed(): Set<string> {
  try {
    return new Set(
      JSON.parse(localStorage.getItem('notes.collapsed') || '[]'),
    );
  } catch {
    return new Set();
  }
}

export function Sidebar() {
  const notes = useStore(state => state.notes);
  const groups = useStore(state => state.groups);
  const snippets = useStore(state => state.snippets);
  const view = useStore(state => state.view);
  const search = useStore(state => state.search);
  const filter = useStore(state => state.filter);
  const saveStatus = useStore(state => state.saveStatus);

  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const byGroup = useMemo(() => {
    const result = new Map<string, Note[]>();

    for (const note of notes) {
      const snippetText = snippetIdsIn(note.body)
        .map(id => {
          const item = snippets[id];
          return item ? `${item.title}\n${item.summary}` : '';
        })
        .join('\n');

      if (
        !matchesSearch(
          {
            title: note.title,
            body: `${note.body}\n${snippetText}`,
          },
          search,
        )
      ) {
        continue;
      }

      const key = note.groupId ?? UNGROUPED;
      const list = result.get(key) ?? [];
      list.push(note);
      result.set(key, list);
    }

    for (const list of result.values()) {
      list.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    return result;
  }, [notes, snippets, search]);

  const toggle = (id: string) => {
    setCollapsed(previous => {
      const next = new Set(previous);

      if (next.has(id)) next.delete(id);
      else next.add(id);

      localStorage.setItem(
        'notes.collapsed',
        JSON.stringify([...next]),
      );

      return next;
    });
  };

  const createNote = (groupId: string | null) => {
    const state = useStore.getState();
    state.openNote(state.createNote({ groupId }));

    const key = groupId ?? UNGROUPED;

    setCollapsed(previous => {
      const next = new Set(previous);
      next.delete(key);

      localStorage.setItem(
        'notes.collapsed',
        JSON.stringify([...next]),
      );

      return next;
    });
  };

  const exportJson = () => {
    const { notes, groups, sketches, snippets } =
      useStore.getState();

    const blob = new Blob(
      [
        JSON.stringify(
          { version: 1, notes, groups, sketches, snippets },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
      `notes-${new Date().toISOString().slice(0, 10)}.json`;

    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as AppData;

      if (
        !Array.isArray(data.notes) ||
        !Array.isArray(data.groups) ||
        !data.sketches ||
        typeof data.sketches !== 'object'
      ) {
        throw new Error('Not a valid notes export.');
      }

      if (
        confirm(
          `Replace current notes with ${data.notes.length} notes ` +
          `from "${file.name}"?`,
        )
      ) {
        useStore.getState().replaceAll(data);
      }
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : 'Import failed.',
      );
    }
  };

  const searching = Boolean(search.trim());

  const count = [...byGroup.values()]
    .reduce((total, list) => total + list.length, 0);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50">
      <header className="flex items-center gap-2 px-4 pb-2 pt-4">
        <StickyNote className="h-5 w-5" />
        <span className="flex-1 font-semibold">Notes</span>

        <Button
          variant="default"
          onClick={() => createNote(
            filter.type === 'group' ? filter.id : null,
          )}
        >
          <Plus className="h-4 w-4" />
          New
        </Button>
      </header>

      <div className="space-y-2 px-3 pb-2">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-200/60 p-1">
          {([
            ['notes', FileText, 'Notes'],
            ['board', LayoutGrid, 'Board'],
          ] as const).map(([value, Icon, label]) => (
            <button
              key={value}
              onClick={() => useStore.getState().setView(value)}
              className={cn(
                'flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-medium',
                view === value
                  ? 'bg-white shadow-sm'
                  : 'text-zinc-500',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <label className="flex h-8 items-center gap-2 rounded-md border bg-white px-2">
          <Search className="h-4 w-4 text-zinc-400" />
          <input
            value={search}
            onChange={event =>
              useStore.getState().setSearch(event.target.value)
            }
            placeholder="Search notes and summaries"
            className="min-w-0 flex-1 text-sm outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            {searching ? `${count} matches` : 'Groups'}
          </span>

          <Button
            size="icon"
            title="New group"
            onClick={() => setAdding(true)}
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>

        {adding && (
          <NameInput
            initial=""
            onDone={name => {
              setAdding(false);

              if (name) {
                const state = useStore.getState();
                state.setFilter({
                  type: 'group',
                  id: state.createGroup(name),
                });
              }
            }}
          />
        )}

        {groups.map(group => {
          const list = byGroup.get(group.id) ?? [];
          if (searching && !list.length) return null;

          return (
            <GroupSection
              key={group.id}
              group={group}
              notes={list}
              open={searching || !collapsed.has(group.id)}
              selected={
                filter.type === 'group' &&
                filter.id === group.id
              }
              onToggle={() => toggle(group.id)}
              onNew={() => createNote(group.id)}
            />
          );
        })}

        {(!searching || byGroup.get(UNGROUPED)?.length) && (
          <GroupSection
            notes={byGroup.get(UNGROUPED) ?? []}
            open={searching || !collapsed.has(UNGROUPED)}
            selected={filter.type === 'ungrouped'}
            onToggle={() => toggle(UNGROUPED)}
            onNew={() => createNote(null)}
          />
        )}

        {searching && !count && (
          <p className="py-6 text-center text-sm text-zinc-400">
            No matches.
          </p>
        )}
      </div>

      <footer className="flex items-center gap-1 border-t p-3">
        <Button size="icon" title="Export JSON" onClick={exportJson}>
          <Download className="h-4 w-4" />
        </Button>

        <Button
          size="icon"
          title="Import JSON"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void importJson(file);
          }}
        />

        <span className={cn(
          'ml-auto text-xs',
          saveStatus === 'error'
            ? 'text-red-600'
            : 'text-zinc-400',
        )}>
          {{
            idle: '',
            saving: 'Saving…',
            saved: 'Saved',
            error: 'Save failed; retrying',
          }[saveStatus]}
        </span>
      </footer>
    </aside>
  );
}

function GroupSection({
  group,
  notes,
  open,
  selected,
  onToggle,
  onNew,
}: {
  group?: Group;
  notes: Note[];
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onNew: () => void;
}) {
  const activeNoteId = useStore(state => state.activeNoteId);
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);

  return (
    <section className="mb-1">
      {renaming && group ? (
        <NameInput
          initial={group.name}
          onDone={name => {
            setRenaming(false);

            if (name) {
              useStore.getState().updateGroup(group.id, { name });
            }
          }}
        />
      ) : (
        <div className={cn(
          'group flex h-8 items-center gap-1 rounded-md pr-1 text-sm',
          selected
            ? 'bg-zinc-200/70 font-medium'
            : 'hover:bg-zinc-100',
        )}>
          <button
            title={open ? 'Collapse' : 'Expand'}
            className="grid h-8 w-6 place-items-center"
            onClick={onToggle}
          >
            <ChevronRight className={cn(
              'h-3.5 w-3.5 text-zinc-400',
              open && 'rotate-90',
            )} />
          </button>

          {group ? (
            <button
              title="Change colour"
              onClick={() => setPicking(value => !value)}
            >
              <ColorDot color={group.color} />
            </button>
          ) : (
            <Inbox className="h-3.5 w-3.5 text-zinc-400" />
          )}

          <button
            className="ml-1 min-w-0 flex-1 truncate text-left"
            onClick={() => {
              useStore.getState().setFilter(
                group
                  ? { type: 'group', id: group.id }
                  : { type: 'ungrouped' },
              );
            }}
            onDoubleClick={() => {
              if (group) setRenaming(true);
            }}
          >
            {group?.name ?? 'Ungrouped'}
          </button>

          <span className="text-xs text-zinc-400">
            {notes.length}
          </span>

          <button
            title="New note here"
            className="p-1 text-zinc-400 hover:text-zinc-900"
            onClick={onNew}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          {group && (
            <>
              <button
                title="Rename group"
                className="p-1 text-zinc-400 hover:text-zinc-900"
                onClick={() => setRenaming(true)}
              >
                <Pencil className="h-3 w-3" />
              </button>

              <button
                title="Delete group; keep notes"
                className="p-1 text-zinc-400 hover:text-red-600"
                onClick={() => {
                  if (confirm(`Delete "${group.name}"? Notes are kept.`)) {
                    useStore.getState().deleteGroup(group.id);
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      )}

      {picking && group && (
        <ColorPicker
          value={group.color}
          onPick={color => {
            useStore.getState().updateGroup(group.id, { color });
            setPicking(false);
          }}
        />
      )}

      {open && (
        <div className="ml-[18px] border-l border-zinc-200 pl-1.5">
          {notes.map(note => (
            <button
              key={note.id}
              onClick={() => useStore.getState().openNote(note.id)}
              className={cn(
                'block w-full rounded-md px-2 py-1.5 text-left',
                activeNoteId === note.id
                  ? 'bg-white shadow-sm ring-1 ring-zinc-200'
                  : 'hover:bg-zinc-100',
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {note.title || 'Untitled'}
                </span>
                <span className="shrink-0 text-[10px] text-zinc-400">
                  {relTime(note.updatedAt)}
                </span>
              </div>

              <div className="truncate text-xs text-zinc-500">
                {snippet(note.body, 100) || 'No content'}
              </div>
            </button>
          ))}

          {!notes.length && (
            <p className="px-2 py-1 text-xs text-zinc-400">
              No notes
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function NameInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (name: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);

  const finish = (name: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(name);
  };

  return (
    <input
      autoFocus
      value={value}
      placeholder="Group name"
      className="h-8 w-full rounded-md border bg-white px-2 text-sm outline-none"
      onChange={event => setValue(event.target.value)}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={event => {
        if (event.key === 'Enter') finish(value.trim() || null);
        if (event.key === 'Escape') finish(null);
      }}
    />
  );
}

export function ColorPicker({
  value,
  onPick,
}: {
  value: string;
  onPick: (color: string) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-1.5 px-2 py-2"
      onPointerDown={event => event.stopPropagation()}
    >
      {GROUP_COLORS.map(color => (
        <button
          key={color}
          title={color}
          onClick={() => onPick(color)}
          className="grid h-5 w-5 place-items-center rounded-full"
          style={{ background: color }}
        >
          {color === value && (
            <Check className="h-3 w-3 text-white" />
          )}
        </button>
      ))}
    </div>
  );
}
