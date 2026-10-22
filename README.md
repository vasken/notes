# Local Notes

A small, self-hosted notes app: markdown notes, visual grouping on a board, and assisted sketches.
Everything is stored in a single JSON file on your machine (`./data/notes.json`), nothing leaves localhost.

## Run

```bash
npm install
npm run dev            # http://127.0.0.1:5173  (hot reload, same API)

# or as a lightweight "always on" local server
npm run build
npm start              # http://127.0.0.1:5180
```

Options (env vars): `PORT`, `HOST` (defaults to `127.0.0.1` — local only), `NOTES_DATA_DIR` (defaults to `./data`).
Requires Node 18+.

## Features

**Notes** — markdown with GFM (tables, task lists, strikethrough). Edit / Split / Preview modes, formatting toolbar,
`Ctrl/⌘+B / I / K`, list & checklist continuation on Enter, and clickable checkboxes in preview that write back to the source.

**Organize** — groups with colours. In the sidebar they are collapsible folders with their notes nested underneath (click the dot to recolour, hover for + / rename / delete); in the *Board* view they are frames on an
infinite canvas:
- drag a note card into a frame to file it (drag it out to un-group it)
- drag a frame header to move the frame *and* its notes; resize from the corner
- double-click empty space (or inside a frame) to create a note there
- **Tidy** re-flows each group into a grid; **Fit** zooms to show everything
- scroll to pan, Ctrl/⌘ + scroll (or pinch) to zoom; the search box highlights matches

**Sketches** — click **Sketch** in the editor to insert a drawing (stored as vector shapes, embedded in the note as
`![sketch](sketch:<id>)`). Click any sketch in preview to edit it.

| Assist feature | What it does |
| --- | --- |
| Shape recognition (pen) | Rough lines, rectangles, circles/ellipses, triangles and simple polygons become clean shapes |
| Angle snapping | Lines/arrows gently snap to 0°/45°/90°; hold **Shift** for 15° steps |
| Connector snapping | Line/arrow ends snap to corners, edge midpoints, centres and endpoints of other shapes |
| Grid snap (G) | Points, boxes and moves snap to a 20px grid |
| Shift on rect/ellipse | Square / circle |

Shortcuts: `V P L A R O T E` tools · `S` toggle assist · `G` grid · `Ctrl/⌘+Z` undo · `Ctrl/⌘+Shift+Z` redo ·
`Delete` remove selection · `Esc` close.

## Data

- `data/notes.json` — all notes, groups and sketches (written atomically; previous version kept as `notes.json.bak`)
- Sidebar ⤓ / ⤒ — export / import the whole thing as JSON

## Layout

```
api.mjs          JSON-file API (GET/PUT /api/state), used by both dev and prod servers
server.mjs       zero-dependency production server (static dist + API)
src/store.ts     zustand store, board layout logic, debounced autosave
src/lib/shapes.ts  geometry, shape recognition, snapping, hit-testing
src/components/  Sidebar, NoteEditor, Markdown, Board, SketchEditor, SketchView
```
