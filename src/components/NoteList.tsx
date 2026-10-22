import { useMemo } from 'react';
import { Plus, Search } from 'lucide-react';
import { useStore, type Filter } from '../store';
import type { Group, Note } from '../types';
import { Button, ColorDot } from './ui';
import { cn, relTime, snippet } from '../lib/util';

export function matchesFilter(n: Note, f: Filter) {
  if (f.type === 'all') return true;
  if (f.type === 'ungrouped') return !n.groupId;
  return n.groupId === f.id;
}

export function matchesSearch(n: Note, q: string) {
  if (!q.trim()) return true;
  const hay = (n.title + '\n' + n.body).toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

export function filterLabel(f: Filter, groups: Group[]) {
  if (f.type === 'all') return 'All notes';
  if (f.type === 'ungrouped') return 'Ungrouped';
  return groups.find((g) => g.id === f.id)?.name ?? 'Group';
}

export function NoteList() {
  const notes = useStore((s) => s.notes);
  const groups = useStore((s) => s.groups);
  const filter = useStore((s) => s.filter);
  const search = useStore((s) => s.search);
  const activeNoteId = useStore((s) => s.activeNoteId);
  const { setSearch, openNote, createNote } = useStore.getState();

  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const visible = useMemo(
    () => notes.filter((n) => matchesFilter(n, filter) && matchesSearch(n, search)).sort((a, b) => b.updatedAt - a.updatedAt),
    [notes, filter, search],
  );

  const newNote = () => openNote(createNote({ groupId: filter.type === 'group' ? filter.id : null }));

  return (
    <section className="flex w-80 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <h2 className="flex-1 truncate font-semibold">{filterLabel(filter, groups)}</h2>
        <Button variant="default" onClick={newNote}>
          <Plus className="h-4 w-4" /> New
        </Button>
      </div>
      <div className="px-4 pb-3">
        <label className="flex h-8 items-center gap-2 rounded-md border border-zinc-200 px-2 focus-within:border-zinc-400">
          <Search className="h-4 w-4 text-zinc-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="min-w-0 flex-1 text-sm outline-none" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((n) => {
          const g = n.groupId ? groupById.get(n.groupId) : undefined;
          return (
            <button
              key={n.id}
              onClick={() => openNote(n.id)}
              className={cn(
                'block w-full border-l-2 px-4 py-3 text-left transition-colors',
                n.id === activeNoteId ? 'border-zinc-900 bg-zinc-100' : 'border-transparent hover:bg-zinc-50',
              )}
            >
              <div className="truncate text-sm font-medium">{n.title || 'Untitled'}</div>
              <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{snippet(n.body) || 'No content'}</div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-400">
                {g && filter.type !== 'group' && (
                  <span className="inline-flex items-center gap-1">
                    <ColorDot color={g.color} className="h-2 w-2" /> {g.name}
                  </span>
                )}
                <span>{relTime(n.updatedAt)}</span>
              </div>
            </button>
          );
        })}
        {!visible.length && <p className="px-4 py-8 text-center text-sm text-zinc-400">{search ? 'No matches.' : 'No notes here yet.'}</p>}
      </div>
    </section>
  );
}
