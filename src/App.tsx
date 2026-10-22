import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { loadInitial, useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { NoteEditor } from './components/NoteEditor';
import { Board } from './components/Board';
import { SketchEditor } from './components/SketchEditor';
import { Button } from './components/ui';

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const view = useStore((s) => s.view);
  const activeNoteId = useStore((s) => s.activeNoteId);
  const editingSketchId = useStore((s) => s.editingSketchId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInitial().catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="grid h-full place-items-center text-sm text-red-600">Could not load notes: {error}</div>;
  if (!loaded) return <div className="grid h-full place-items-center text-sm text-zinc-400">Loading…</div>;

  return (
    <div className="flex h-full">
      <Sidebar />
      {view === 'notes' ? (
        <>
          <main className="min-w-0 flex-1">
            {activeNoteId ? <NoteEditor key={activeNoteId} id={activeNoteId} /> : <EmptyState />}
          </main>
        </>
      ) : (
        <main className="relative min-w-0 flex-1">
          <Board />
          {activeNoteId && (
            <div className="absolute inset-y-0 right-0 z-20 w-[min(680px,100%)] border-l border-zinc-200 shadow-2xl">
              <NoteEditor key={activeNoteId} id={activeNoteId} onClose={() => useStore.getState().openNote(null)} />
            </div>
          )}
        </main>
      )}
      {editingSketchId && <SketchEditor key={editingSketchId} id={editingSketchId} />}
    </div>
  );
}

function EmptyState() {
  const { createNote, openNote, filter } = useStore.getState();
  return (
    <div className="grid h-full place-items-center bg-white">
      <div className="text-center">
        <FileText className="mx-auto mb-3 h-10 w-10 text-zinc-300" />
        <p className="mb-4 text-sm text-zinc-500">Select a note or start a new one.</p>
        <Button variant="default" onClick={() => openNote(createNote({ groupId: filter.type === 'group' ? filter.id : null }))}>
          New note
        </Button>
      </div>
    </div>
  );
}
