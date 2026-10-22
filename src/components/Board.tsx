import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react';
import { FolderPlus, Maximize, Minus, Palette, Plus, Sparkles, StickyNote, Trash2 } from 'lucide-react';
import { CARD_H, CARD_W, HEADER, groupUnderCard, useStore } from '../store';
import type { Group, Note } from '../types';
import { Button, Separator } from './ui';
import { ColorPicker } from './Sidebar';
import { SketchView } from './SketchView';
import { matchesSearch } from './NoteList';
import {
  cn,
  sketchIdsIn,
  snippet,
  snippetIdsIn,
} from '../lib/util';

type Viewport = { x: number; y: number; z: number };
const clampZ = (z: number) => Math.min(2, Math.max(0.25, z));

export function Board() {
  const notes = useStore((s) => s.notes);
  const groups = useStore((s) => s.groups);
  const filter = useStore((s) => s.filter);
  const search = useStore((s) => s.search);
  const activeNoteId = useStore((s) => s.activeNoteId);
  const { createNote, createGroup, openNote, dropNote, tidy, setSearch } = useStore.getState();

  const [vp, setVp] = useState<Viewport>(() => {
    try { return JSON.parse(localStorage.getItem('notes.viewport')!) ?? { x: 0, y: 0, z: 1 }; } catch { return { x: 0, y: 0, z: 1 }; }
  });
  useEffect(() => localStorage.setItem('notes.viewport', JSON.stringify(vp)), [vp]);

  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (cx - r.left - vp.x) / vp.z, y: (cy - r.top - vp.y) / vp.z };
  }, [vp]);

  // wheel: scroll pans, ctrl/⌘ + wheel (or trackpad pinch) zooms around the cursor
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setVp((v) => {
        if (e.ctrlKey || e.metaKey) {
          const z = clampZ(v.z * Math.exp(-e.deltaY * 0.01));
          const cx = e.clientX - r.left, cy = e.clientY - r.top;
          return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) };
        }
        return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // jump to a group when it is picked in the sidebar
  useEffect(() => {
    if (filter.type !== 'group') return;
    const g = useStore.getState().groups.find((x) => x.id === filter.id);
    if (g) setVp((v) => ({ ...v, x: 48 - g.x * v.z, y: 72 - g.y * v.z }));
  }, [filter]);

  const zoomBy = (f: number) => {
    const r = ref.current!.getBoundingClientRect();
    setVp((v) => {
      const z = clampZ(v.z * f);
      const cx = r.width / 2, cy = r.height / 2;
      return { z, x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z) };
    });
  };

  const fitAll = () => {
    const boxes = [...groups.map((g) => ({ x: g.x, y: g.y, w: g.w, h: g.h })), ...notes.map((n) => ({ x: n.x, y: n.y, w: CARD_W, h: CARD_H }))];
    if (!boxes.length) return setVp({ x: 0, y: 0, z: 1 });
    const minX = Math.min(...boxes.map((b) => b.x)), minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w)), maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const r = ref.current!.getBoundingClientRect();
    const z = clampZ(Math.min((r.width - 96) / (maxX - minX), (r.height - 140) / (maxY - minY), 1.25));
    setVp({ z, x: (r.width - (maxX - minX) * z) / 2 - minX * z, y: 72 + (r.height - 100 - (maxY - minY) * z) / 2 - minY * z });
  };

  // background: drag to pan, double-click to add a note
  const isBg = (t: EventTarget) => (t as HTMLElement).dataset?.bg === '1';
  const onBgDown = (e: RPointerEvent) => {
    if (!isBg(e.target) || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pan.current = { sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y };
  };
  const onBgMove = (e: RPointerEvent) => {
    const p = pan.current;
    if (p) setVp((v) => ({ ...v, x: p.vx + e.clientX - p.sx, y: p.vy + e.clientY - p.sy }));
  };
  const onBgUp = () => (pan.current = null);
  const onBgDouble = (e: RMouseEvent) => {
    if (!isBg(e.target)) return;
    const w = toWorld(e.clientX, e.clientY);
    const id = createNote({ at: { x: w.x - CARD_W / 2, y: w.y - 24 } });
    dropNote(id); // joins the group it was created in, if any
    openNote(id);
  };

  const groupColor = useMemo(() => new Map(groups.map((g) => [g.id, g.color])), [groups]);
  const sorted = useMemo(() => (draggingId ? [...notes.filter((n) => n.id !== draggingId), notes.find((n) => n.id === draggingId)!] : notes), [notes, draggingId]);

  return (
    <div
      ref={ref}
      data-bg="1"
      onPointerDown={onBgDown}
      onPointerMove={onBgMove}
      onPointerUp={onBgUp}
      onDoubleClick={onBgDouble}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-zinc-100"
      style={{
        backgroundImage: 'radial-gradient(circle, #d4d4d8 1px, transparent 1px)',
        backgroundSize: `${24 * vp.z}px ${24 * vp.z}px`,
        backgroundPosition: `${vp.x}px ${vp.y}px`,
        cursor: pan.current ? 'grabbing' : 'default',
      }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.z})` }} data-bg="1">
        {groups.map((g) => (
          <GroupFrame key={g.id} group={g} zoom={vp.z} highlighted={hoverGroup === g.id} />
        ))}
        {sorted.map((n) => (
          <NoteCard
            key={n.id}
            note={n}
            zoom={vp.z}
            color={n.groupId ? groupColor.get(n.groupId) : undefined}
            active={n.id === activeNoteId}
            dimmed={!!search.trim() && !matchesSearch(n, search)}
            onDragState={(dragging) => {
              setDraggingId(dragging ? n.id : null);
              if (!dragging) setHoverGroup(null);
            }}
            onHoverGroup={setHoverGroup}
          />
        ))}
      </div>

      {/* toolbar */}
      <div className="absolute left-4 top-4 flex items-center gap-1 rounded-xl border border-zinc-200 bg-white/95 p-1 shadow-sm backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
        <Button onClick={() => openNote(createNote())}><StickyNote className="h-4 w-4" /> Note</Button>
        <Button onClick={() => createGroup()}><FolderPlus className="h-4 w-4" /> Group</Button>
        <Button onClick={tidy} title="Arrange notes neatly inside their groups"><Sparkles className="h-4 w-4" /> Tidy</Button>
        <Separator vertical />
        <Button size="icon" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}><Minus className="h-4 w-4" /></Button>
        <button className="w-12 text-center text-xs tabular-nums text-zinc-500 hover:text-zinc-900" title="Reset zoom" onClick={() => setVp((v) => ({ ...v, z: 1 }))}>
          {Math.round(vp.z * 100)}%
        </button>
        <Button size="icon" title="Zoom in" onClick={() => zoomBy(1.2)}><Plus className="h-4 w-4" /></Button>
        <Button size="icon" title="Fit everything" onClick={fitAll}><Maximize className="h-4 w-4" /></Button>
        <Separator vertical />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Highlight…"
          className="h-8 w-32 rounded-md px-2 text-sm outline-none focus:bg-zinc-50"
        />
      </div>
      <div className="pointer-events-none absolute bottom-3 left-4 text-xs text-zinc-400">
        Double-click to add a note · drag a note into a group to file it · drag empty space to pan · Ctrl/⌘ + scroll to zoom
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NoteCard({
  note, zoom, color, active, dimmed, onDragState, onHoverGroup,
}: {
  note: Note; zoom: number; color?: string; active: boolean; dimmed: boolean;
  onDragState: (dragging: boolean) => void; onHoverGroup: (id: string | null) => void;
}) {

  const snippets = useStore(state => state.snippets);
const sketches = useStore(state => state.sketches);

const visualSnippet = snippetIdsIn(note.body)
  .map(id => snippets[id])
  .find(item =>
    item && (
      (item.kind === 'png' && Boolean(item.content)) ||
      (
        item.kind === 'sketch' &&
        Boolean(sketches[item.content]?.shapes.length)
      )
    ),
  );

const legacySketchId = sketchIdsIn(note.body)
  .find(id => sketches[id]?.shapes.length);

const sketch = visualSnippet?.kind === 'sketch'
  ? sketches[visualSnippet.content]
  : !visualSnippet && legacySketchId
    ? sketches[legacySketchId]
    : undefined;

const png = visualSnippet?.kind === 'png'
  ? visualSnippet
  : undefined;

  const drag = useRef<{ sx: number; sy: number; nx: number; ny: number; moved: boolean } | null>(null);
  const text = snippet(note.body, 400);

  const onDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, nx: note.x, ny: note.y, moved: false };
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / zoom, dy = (e.clientY - d.sy) / zoom;
    if (!d.moved && Math.hypot(dx, dy) * zoom < 4) return;
    if (!d.moved) { d.moved = true; onDragState(true); }
    const pos = { x: d.nx + dx, y: d.ny + dy };
    useStore.getState().moveNote(note.id, pos.x, pos.y);
    onHoverGroup(groupUnderCard(useStore.getState().groups, pos)?.id ?? null);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) { useStore.getState().dropNote(note.id); onDragState(false); }
    else useStore.getState().openNote(note.id);
  };

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute flex cursor-grab flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-[box-shadow,opacity] active:cursor-grabbing',
        active ? 'border-zinc-900 ring-2 ring-zinc-900/10' : 'border-zinc-200 hover:shadow-md',
        dimmed && 'opacity-30',
      )}
      style={{ left: note.x, top: note.y, width: CARD_W, height: CARD_H }}
    >
      <div className="h-1 shrink-0" style={{ background: color ?? '#e4e4e7' }} />
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-2 pt-2">
        <div className="truncate text-sm font-semibold">{note.title || 'Untitled'}</div>

        {png || sketch ? (
          <>
            {text && (
              <div className="truncate text-xs text-zinc-500">
                {text}
              </div>
            )}

            <div className="pointer-events-none mt-1 flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              {png ? (
                <img
                  src={png.content}
                  alt={png.title}
                  draggable={false}
                  className="block h-full w-full object-contain"
                />
              ) : sketch ? (
                <SketchView
                  sketch={sketch}
                  className="block max-h-full w-full"
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className="mt-1 line-clamp-5 text-xs leading-relaxed text-zinc-500">
            {text || 'Empty note'}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function GroupFrame({ group, zoom, highlighted }: { group: Group; zoom: number; highlighted: boolean }) {
  const { moveGroup, resizeGroup, updateGroup, deleteGroup, createNote, openNote } = useStore.getState();
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const size = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);

  const startMove = (e: RPointerEvent) => {
    if (e.button !== 0 || renaming) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
  };
  const doMove = (e: RPointerEvent) => {
    if (!last.current) return;
    moveGroup(group.id, (e.clientX - last.current.x) / zoom, (e.clientY - last.current.y) / zoom);
    last.current = { x: e.clientX, y: e.clientY };
  };
  const startResize = (e: RPointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    size.current = { sx: e.clientX, sy: e.clientY, w: group.w, h: group.h };
  };
  const doResize = (e: RPointerEvent) => {
    const s = size.current;
    if (s) resizeGroup(group.id, s.w + (e.clientX - s.sx) / zoom, s.h + (e.clientY - s.sy) / zoom);
  };

  return (
    <div
      data-bg="1"
      className="absolute rounded-2xl border-2 transition-shadow"
      style={{
        left: group.x, top: group.y, width: group.w, height: group.h,
        borderColor: group.color + (highlighted ? 'ff' : '66'),
        background: group.color + (highlighted ? '22' : '12'),
        boxShadow: highlighted ? `0 0 0 4px ${group.color}33` : undefined,
      }}
    >
      <div
        onPointerDown={startMove}
        onPointerMove={doMove}
        onPointerUp={() => (last.current = null)}
        onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); }}
        className="flex cursor-move items-center gap-2 rounded-t-[14px] px-3"
        style={{ height: HEADER - 6, background: group.color + '22' }}
      >
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: group.color }} />
        {renaming ? (
          <input
            autoFocus
            defaultValue={group.name}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => { updateGroup(group.id, { name: e.target.value.trim() || group.name }); setRenaming(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="min-w-0 flex-1 rounded bg-white px-1.5 text-sm font-semibold outline-none"
          />
        ) : (
          <span className="flex-1 truncate text-sm font-semibold text-zinc-800">{group.name}</span>
        )}
        <div className="flex items-center" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Button size="icon" className="h-7 w-7" title="Add note to group" onClick={() => openNote(createNote({ groupId: group.id }))}>
            <Plus className="h-4 w-4" />
          </Button>
          <Button size="icon" className="h-7 w-7" title="Colour" onClick={() => setPicking((p) => !p)}>
            <Palette className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            className="h-7 w-7 hover:text-red-600"
            title="Delete group (notes are kept)"
            onClick={() => confirm(`Delete group "${group.name}"? Its notes stay on the board.`) && deleteGroup(group.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {picking && (
        <div className="absolute right-2 top-10 z-10 rounded-lg border border-zinc-200 bg-white shadow-md">
          <ColorPicker value={group.color} onPick={(color) => { updateGroup(group.id, { color }); setPicking(false); }} />
        </div>
      )}
      <div
        onPointerDown={startResize}
        onPointerMove={doResize}
        onPointerUp={() => (size.current = null)}
        className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
        style={{ background: `linear-gradient(135deg, transparent 50%, ${group.color}99 50%)`, borderBottomRightRadius: 14 }}
      />
    </div>
  );
}
