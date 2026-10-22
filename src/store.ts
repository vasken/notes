import { create } from 'zustand';

import type {
  AppData,
  Group,
  Note,
  Pt,
  Shape,
  Sketch,
  Snippet,
} from './types';

import { uid } from './lib/util';

export const CARD_W = 232;
export const CARD_H = 152;
export const HEADER = 46;

const PAD = 16;
const GAP = 16;

export const GROUP_COLORS = [
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#ef4444',
  '#14b8a6',
  '#64748b',
];

export const SKETCH_W = 960;
export const SKETCH_H = 600;

const MAX_STATE_BYTES = 40 * 1024 * 1024;

export type Filter =
  | { type: 'all' }
  | { type: 'ungrouped' }
  | { type: 'group'; id: string };

export type View = 'notes' | 'board';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type SnippetInput =
  Pick<Snippet, 'title' | 'summary' | 'kind' | 'content'> &
  Partial<Pick<Snippet, 'language'>>;

type SnippetPatch = Partial<
  Pick<Snippet, 'title' | 'summary' | 'content' | 'language'>
>;

type Store = AppData & {
  loaded: boolean;
  saveStatus: SaveStatus;
  view: View;
  filter: Filter;
  search: string;
  activeNoteId: string | null;
  editingSketchId: string | null;

  setView: (view: View) => void;
  setFilter: (filter: Filter) => void;
  setSearch: (query: string) => void;
  openNote: (id: string | null) => void;
  openSketch: (id: string | null) => void;

  createNote: (options?: {
    groupId?: string | null;
    at?: Pt;
    title?: string;
    body?: string;
  }) => string;

  updateNote: (
    id: string,
    patch: Partial<Pick<Note, 'title' | 'body'>>,
  ) => void;

  moveNote: (id: string, x: number, y: number) => void;
  dropNote: (id: string) => void;
  setNoteGroup: (id: string, groupId: string | null) => void;
  deleteNote: (id: string) => void;

  createGroup: (name?: string) => string;
  updateGroup: (
    id: string,
    patch: Partial<Pick<Group, 'name' | 'color'>>,
  ) => void;
  moveGroup: (id: string, dx: number, dy: number) => void;
  resizeGroup: (id: string, w: number, h: number) => void;
  deleteGroup: (id: string) => void;
  tidy: () => void;

  createSketch: () => string;
  saveSketch: (id: string, shapes: Shape[]) => void;

  createSnippet: (input: SnippetInput) => string;
  updateSnippet: (id: string, patch: SnippetPatch) => void;

  replaceAll: (data: AppData) => void;
};

const cardCenter = (note: Pick<Note, 'x' | 'y'>): Pt => ({
  x: note.x + CARD_W / 2,
  y: note.y + CARD_H / 2,
});

const inFrame = (group: Group, point: Pt) =>
  point.x >= group.x &&
  point.x <= group.x + group.w &&
  point.y >= group.y &&
  point.y <= group.y + group.h;

export function groupAt(groups: Group[], point: Pt): Group | null {
  for (let i = groups.length - 1; i >= 0; i--) {
    if (inFrame(groups[i], point)) return groups[i];
  }

  return null;
}

export const groupUnderCard = (
  groups: Group[],
  note: Pick<Note, 'x' | 'y'>,
) => groupAt(groups, cardCenter(note));

const colsFor = (group: Group) =>
  Math.max(
    1,
    Math.floor((group.w - PAD * 2 + GAP) / (CARD_W + GAP)),
  );

const slot = (group: Group, index: number, columns: number): Pt => ({
  x: group.x + PAD + (index % columns) * (CARD_W + GAP),
  y: group.y + HEADER +
    Math.floor(index / columns) * (CARD_H + GAP),
});

const overlaps = (a: Pt, b: Pt) =>
  Math.abs(a.x - b.x) < CARD_W &&
  Math.abs(a.y - b.y) < CARD_H;

function freeSlotInGroup(
  group: Group,
  notes: Note[],
  skipId?: string,
): Pt {
  const members = notes.filter(
    note => note.groupId === group.id && note.id !== skipId,
  );

  const columns = colsFor(group);

  for (let index = 0; index < 1000; index++) {
    const position = slot(group, index, columns);

    if (!members.some(note => overlaps(note, position))) {
      return position;
    }
  }

  return slot(group, 0, columns);
}

function looseSpot(
  groups: Group[],
  notes: Note[],
  skipId?: string,
): Pt {
  const top = groups.length
    ? Math.max(...groups.map(group => group.y + group.h)) + 56
    : 40;

  for (let index = 0; index < 1000; index++) {
    const position = {
      x: 40 + (index % 6) * (CARD_W + GAP),
      y: top + Math.floor(index / 6) * (CARD_H + GAP),
    };

    if (
      !notes.some(note =>
        note.id !== skipId && overlaps(note, position),
      )
    ) {
      return position;
    }
  }

  return { x: 40, y: top };
}

function fit(group: Group, notes: Note[]): Group {
  const members = notes.filter(note => note.groupId === group.id);
  if (!members.length) return group;

  const right = Math.max(
    ...members.map(note => note.x + CARD_W),
  ) + PAD;

  const bottom = Math.max(
    ...members.map(note => note.y + CARD_H),
  ) + PAD;

  return {
    ...group,
    w: Math.max(group.w, right - group.x),
    h: Math.max(group.h, bottom - group.y),
  };
}

function fitAll(
  groups: Group[],
  notes: Note[],
  ids: (string | null)[],
) {
  return groups.map(group =>
    ids.includes(group.id) ? fit(group, notes) : group,
  );
}

function dataFrom(state: AppData): AppData {
  return {
    version: 1,
    notes: state.notes,
    groups: state.groups,
    sketches: state.sketches,
    snippets: state.snippets,
  };
}

function checkSize(data: AppData) {
  const bytes = new Blob([JSON.stringify(data)]).size;

  if (bytes > MAX_STATE_BYTES) {
    throw new Error(
      'The notes data would exceed 40 MB. ' +
      'Use a smaller image or reduce the snippet content.',
    );
  }
}

function initialView(): View {
  return localStorage.getItem('notes.view') === 'board'
    ? 'board'
    : 'notes';
}

export const useStore = create<Store>()((set, get) => ({
  version: 1,
  notes: [],
  groups: [],
  sketches: {},
  snippets: {},

  loaded: false,
  saveStatus: 'idle',
  view: initialView(),
  filter: { type: 'all' },
  search: '',
  activeNoteId: null,
  editingSketchId: null,

  setView: view => {
    localStorage.setItem('notes.view', view);
    set({ view });
  },

  setFilter: filter => set({ filter }),
  setSearch: search => set({ search }),
  openNote: activeNoteId => set({ activeNoteId }),
  openSketch: editingSketchId => set({ editingSketchId }),

  createNote: (options = {}) => {
    const { notes, groups } = get();
    const id = uid();
    const now = Date.now();

    const group = options.groupId
      ? groups.find(item => item.id === options.groupId)
      : undefined;

    const position = options.at ?? (
      group
        ? freeSlotInGroup(group, notes)
        : looseSpot(groups, notes)
    );

    const note: Note = {
      id,
      title: options.title ?? '',
      body: options.body ?? '',
      groupId: group?.id ?? null,
      ...position,
      createdAt: now,
      updatedAt: now,
    };

    const next = [...notes, note];

    set({
      notes: next,
      groups: fitAll(groups, next, [note.groupId]),
    });

    return id;
  },

  updateNote: (id, patch) =>
    set(state => ({
      notes: state.notes.map(note =>
        note.id === id
          ? { ...note, ...patch, updatedAt: Date.now() }
          : note,
      ),
    })),

  moveNote: (id, x, y) =>
    set(state => ({
      notes: state.notes.map(note =>
        note.id === id ? { ...note, x, y } : note,
      ),
    })),

  dropNote: id => {
    const { notes, groups } = get();
    const note = notes.find(item => item.id === id);
    if (!note) return;

    const target = groupUnderCard(groups, note)?.id ?? null;

    const next = notes.map(item =>
      item.id === id ? { ...item, groupId: target } : item,
    );

    set({
      notes: next,
      groups: fitAll(groups, next, [target]),
    });
  },

  setNoteGroup: (id, groupId) => {
    const { notes, groups } = get();

    const group = groupId
      ? groups.find(item => item.id === groupId)
      : undefined;

    const position = group
      ? freeSlotInGroup(group, notes, id)
      : looseSpot(groups, notes, id);

    const next = notes.map(note =>
      note.id === id
        ? { ...note, groupId: group?.id ?? null, ...position }
        : note,
    );

    set({
      notes: next,
      groups: fitAll(groups, next, [group?.id ?? null]),
    });
  },

  // Keep stored snippets/sketches. Another note may reference them.
  deleteNote: id =>
    set(state => ({
      notes: state.notes.filter(note => note.id !== id),
      activeNoteId:
        state.activeNoteId === id ? null : state.activeNoteId,
    })),

  createGroup: name => {
    const { groups } = get();
    const id = uid();

    const x = groups.length
      ? Math.max(...groups.map(group => group.x + group.w)) + 48
      : 40;

    const group: Group = {
      id,
      name: name?.trim() || 'New group',
      color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
      x,
      y: 40,
      w: PAD * 2 + CARD_W * 2 + GAP,
      h: HEADER + CARD_H * 2 + GAP + PAD,
    };

    set({ groups: [...groups, group] });
    return id;
  },

  updateGroup: (id, patch) =>
    set(state => ({
      groups: state.groups.map(group =>
        group.id === id ? { ...group, ...patch } : group,
      ),
    })),

  moveGroup: (id, dx, dy) =>
    set(state => ({
      groups: state.groups.map(group =>
        group.id === id
          ? { ...group, x: group.x + dx, y: group.y + dy }
          : group,
      ),
      notes: state.notes.map(note =>
        note.groupId === id
          ? { ...note, x: note.x + dx, y: note.y + dy }
          : note,
      ),
    })),

  resizeGroup: (id, w, h) =>
    set(state => ({
      groups: state.groups.map(group =>
        group.id === id
          ? {
              ...group,
              w: Math.max(CARD_W + PAD * 2, w),
              h: Math.max(HEADER + 80, h),
            }
          : group,
      ),
    })),

  deleteGroup: id =>
    set(state => ({
      groups: state.groups.filter(group => group.id !== id),
      notes: state.notes.map(note =>
        note.groupId === id ? { ...note, groupId: null } : note,
      ),
      filter:
        state.filter.type === 'group' && state.filter.id === id
          ? { type: 'all' }
          : state.filter,
    })),

  tidy: () =>
    set(state => {
      let notes = state.notes.slice();

      const groups = state.groups.map(group => {
        const columns = colsFor(group);

        const members = notes
          .filter(note => note.groupId === group.id)
          .sort((a, b) => a.y - b.y || a.x - b.x);

        const positions = new Map(
          members.map((note, index) => [
            note.id,
            slot(group, index, columns),
          ]),
        );

        notes = notes.map(note => {
          const position = positions.get(note.id);
          return position ? { ...note, ...position } : note;
        });

        const rows = Math.max(
          1,
          Math.ceil(members.length / columns),
        );

        return {
          ...group,
          h: HEADER + rows * (CARD_H + GAP) - GAP + PAD,
        };
      });

      const top = groups.length
        ? Math.max(...groups.map(group => group.y + group.h)) + 56
        : 40;

      const loose = notes
        .filter(note => !note.groupId)
        .sort((a, b) => a.y - b.y || a.x - b.x);

      const positions = new Map(
        loose.map((note, index) => [
          note.id,
          {
            x: 40 + (index % 6) * (CARD_W + GAP),
            y: top + Math.floor(index / 6) * (CARD_H + GAP),
          },
        ]),
      );

      notes = notes.map(note => {
        const position = positions.get(note.id);
        return position ? { ...note, ...position } : note;
      });

      return { notes, groups };
    }),

    createSketch: () => {
    const id = uid();

    const sketch: Sketch = {
      id,
      w: SKETCH_W,
      h: SKETCH_H,
      shapes: [],
      updatedAt: Date.now(),
    };

    const sketches = { ...get().sketches };
    sketches[id] = sketch;

    set({ sketches });

    return id;
  },

  saveSketch: (id, shapes) => {
    const state = get();

    const previous = state.sketches[id] ?? {
      id,
      w: SKETCH_W,
      h: SKETCH_H,
      shapes: [],
      updatedAt: 0,
    };

    const updated: Sketch = {
      ...previous,
      shapes,
      updatedAt: Date.now(),
    };

    const sketches = { ...state.sketches };
    sketches[id] = updated;

    set({ sketches });
  },

  createSnippet: input => {
    const state = get();
    const id = uid();
    const now = Date.now();

    const item: Snippet = {
      ...input,
      id,
      title: input.title.trim() || 'Untitled snippet',
      createdAt: now,
      updatedAt: now,
    };

    const snippets = { ...state.snippets };
    snippets[id] = item;

    checkSize({
      ...dataFrom(state),
      snippets,
    });

    set({ snippets });

    return id;
  },

  updateSnippet: (id, patch) => {
    const state = get();
    const previous = state.snippets[id];

    if (!previous) return;

    const updated: Snippet = {
      ...previous,
      ...patch,
      updatedAt: Date.now(),
    };

    const snippets = { ...state.snippets };
    snippets[id] = updated;

    checkSize({
      ...dataFrom(state),
      snippets,
    });

    set({ snippets });
  },

  replaceAll: data => {
    const normalized: AppData = {
      version: 1,
      notes: data.notes ?? [],
      groups: data.groups ?? [],
      sketches: data.sketches ?? {},
      snippets: data.snippets ?? {},
    };

    checkSize(normalized);

    set({
      ...normalized,
      activeNoteId: null,
      editingSketchId: null,
      filter: { type: 'all' },
    });
  },
}));

let timer: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let savedRevision = 0;
let saving = false;

function scheduleSave(delay = 500) {
  clearTimeout(timer);
  timer = setTimeout(() => void save(), delay);
}

async function save() {
  if (saving) return;

  saving = true;
  const targetRevision = revision;
  const payload = JSON.stringify(dataFrom(useStore.getState()));

  useStore.setState({ saveStatus: 'saving' });

  try {
    const response = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    if (!response.ok) {
      throw new Error(`Save failed: ${response.status}`);
    }

    savedRevision = targetRevision;

    if (revision === targetRevision) {
      useStore.setState({ saveStatus: 'saved' });
    } else {
      scheduleSave(0);
    }
  } catch {
    useStore.setState({ saveStatus: 'error' });
    scheduleSave(3000);
  } finally {
    saving = false;
  }
}

useStore.subscribe((state, previous) => {
  if (!state.loaded || !previous.loaded) return;

  if (
    state.notes !== previous.notes ||
    state.groups !== previous.groups ||
    state.sketches !== previous.sketches ||
    state.snippets !== previous.snippets
  ) {
    revision++;
    scheduleSave();
  }
});

window.addEventListener('beforeunload', () => {
  if (revision === savedRevision) return;

  // Best effort only; wait for "Saved" before closing large notes.
  navigator.sendBeacon(
    '/api/state',
    new Blob(
      [JSON.stringify(dataFrom(useStore.getState()))],
      { type: 'application/json' },
    ),
  );
});

let loading: Promise<void> | undefined;

export function loadInitial(): Promise<void> {
  if (useStore.getState().loaded) return Promise.resolve();
  if (loading) return loading;

  loading = (async () => {
    const response = await fetch('/api/state');

    if (!response.ok) {
      throw new Error(`Could not load notes: ${response.status}`);
    }

    const data = await response.json() as Partial<AppData> & {
      empty?: boolean;
    };

    if (data.empty) {
      useStore.setState({
        ...seed(),
        loaded: true,
      });

      revision++;
      scheduleSave(0);
      return;
    }

    useStore.setState({
      version: 1,
      notes: data.notes ?? [],
      groups: data.groups ?? [],
      sketches: data.sketches ?? {},
      snippets: data.snippets ?? {},
      loaded: true,
      saveStatus: 'saved',
    });
  })().catch(error => {
    loading = undefined;
    throw error;
  });

  return loading;
}

function seed(): AppData {
  const now = Date.now();
  const groupId = uid();

  return {
    version: 1,
    groups: [{
      id: groupId,
      name: 'Getting started',
      color: GROUP_COLORS[2],
      x: 40,
      y: 40,
      w: 528,
      h: HEADER + CARD_H + PAD,
    }],
    notes: [{
      id: uid(),
      title: 'Welcome',
      body:
        'Write your note here.\n\n' +
        'Use **Add snippet** for code, long text, PNG images, or sketches.\n\n' +
        'Only a short reference appears in the note source.',
      groupId,
      x: 40 + PAD,
      y: 40 + HEADER,
      createdAt: now,
      updatedAt: now,
    }],
    sketches: {},
    snippets: {},
  };
}
