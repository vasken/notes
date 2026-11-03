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

## Desktop app

```bash
npm run desktop:dmg      # build release/mac-arm64/Local Notes.app + release/Local Notes-*.dmg
npm run desktop:build    # same, with a log (release/build.log) and a macOS notification when done
npm run desktop:install  # quit the running app, replace /Applications/Local Notes.app with the build, relaunch
```

`desktop:install` asks before quitting a running app (check it shows "Saved" first; edits that haven't been saved
yet may be lost on quit). `-- -y` skips the prompt, `-- --no-open` skips the relaunch. Your notes live in
`~/Library/Application Support/Local Notes/`, outside the app, so replacing the app doesn't touch them.

**Auto-build on commit** (one-time setup per clone): `git config core.hooksPath .githooks`.
After that, every commit rebuilds the app in the background (`git commit` returns immediately). Commits made during a
build are coalesced into one follow-up build. Skip it for one commit with `SKIP_APP_BUILD=1 git commit ...`.
The build uses the working tree, so any uncommitted changes are included (the log warns when that happens).

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

**Sketches**: click **Sketch** in a note's toolbar (or press `Ctrl/⌘+Shift+K`) to start a drawing at the cursor
(stored as vector shapes). To import an editable sketch JSON file, use the upload button next to **Sketch**, drop the
`.json` file onto the note, or paste the JSON into the note. Click any sketch in preview to edit it.

| Assist feature | What it does |
| --- | --- |
| Shape recognition (pen) | Rough lines, rectangles, circles/ellipses, triangles and simple polygons become clean shapes |
| Labels | A label belongs to its shape: it stays centred, moves and resizes with it, and is deleted with it. Double-click a shape (or press **Enter**) to label it |
| Connected arrows | Start or end a line/arrow on a shape to attach it. Ends snapped to a corner or edge midpoint stay on that point; ends dropped inside a shape float to its edge. Move the shapes and the arrows follow |
| Smart guides | While moving, resizing or drawing, shapes snap to other shapes' edges and centres, the canvas centre, and equal spacing (pink guides) |
| Angle snapping | Lines/arrows gently snap to 0°/45°/90°; hold **Shift** for 15° steps |
| Grid snap (G) | Points, boxes and moves snap to a 20px grid (replaces smart guides while on) |
| Shift on rect/ellipse | Square / circle |

Hold **Alt** while dragging to turn all snapping off. **Alt+click** a label to select it on its own; dragging it away
from its shape turns it back into free text. **Attach text** (shown when a selection holds a shape and free text) turns
loose text sitting inside a shape into its label; **Detach label** does the reverse.

Stroke colour, stroke width, fill and font size apply to the current selection (font size also reaches the labels of
selected shapes).

Shortcuts: `V P L A R O T E` tools · `S` toggle assist · `G` grid · `Enter` edit label · `Ctrl/⌘+C / X / V` copy, cut, paste ·
`Ctrl/⌘+D` duplicate · arrow keys nudge (`Shift` ×10) · `Ctrl/⌘+]` / `[` forward / backward (add `Shift` for front / back) ·
`Ctrl/⌘+A` select all · `Ctrl/⌘+Z` undo · `Ctrl/⌘+Shift+Z` redo · `Delete` remove selection · `Esc` close.

### Sketch JSON

`{ "version": 1, "title", "summary", "w", "h", "shapes": [...] }`. Shapes are `rect` / `ellipse` (`x y w h`, `fill`),
`line` / `arrow` (`a`, `b`), `polygon` / `path` (`points`) and `text` (`x y text size`), each with `color` and `width`.
To connect things, give shapes an `id` and use:

- `"label": "Text"` on a shape or connector to attach a label (optional `labelSize`, `labelColor`)
- `"from"` / `"to"` on a line or arrow: a shape id (`"from": "order"`) floats to that shape's edge;
  `{ "id": "order", "fx": 1, "fy": 0.5 }` pins a point relative to its bounds (here the right edge midpoint)
- `"labelFor": "order"` on a text shape to attach existing text

Ids are regenerated on import; references to unknown ids are dropped.

## Data

- `data/notes.json` — all notes, groups and sketches (written atomically; previous version kept as `notes.json.bak`)
- Sidebar ⤓ / ⤒ — export / import the whole thing as JSON

## Layout

```
api.mjs          JSON-file API (GET/PUT /api/state), used by both dev and prod servers
server.mjs       zero-dependency production server (static dist + API)
src/store.ts     zustand store, board layout logic, debounced autosave
src/lib/shapes.ts  geometry, shape recognition, snapping, hit-testing
src/lib/sketch-layout.ts  labels and connected arrows (resolveLayout), copy/delete helpers
src/lib/sketch-guides.ts  smart guides: alignment and equal-spacing snapping
src/components/  Sidebar, NoteEditor, Markdown, Board, SketchEditor, SketchView
```
