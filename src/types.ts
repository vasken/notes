export type Pt = {
  x: number;
  y: number;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  groupId: string | null;
  x: number;
  y: number;
  createdAt: number;
  updatedAt: number;
};

export type Group = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type ShapeBase = {
  id: string;
  color: string;
  width: number;
  fill?: string;
};

export type Shape =
  | (ShapeBase & {
      kind: 'path';
      points: Pt[];
    })
  | (ShapeBase & {
      kind: 'line' | 'arrow';
      a: Pt;
      b: Pt;
    })
  | (ShapeBase & {
      kind: 'rect' | 'ellipse';
      x: number;
      y: number;
      w: number;
      h: number;
    })
  | (ShapeBase & {
      kind: 'polygon';
      points: Pt[];
    })
  | (ShapeBase & {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
    });

export type Sketch = {
  id: string;
  w: number;
  h: number;
  shapes: Shape[];
  updatedAt: number;
};

export type SnippetKind = 'text' | 'code' | 'png' | 'sketch';

export type Snippet = {
  id: string;
  title: string;
  summary: string;
  kind: SnippetKind;
  language?: string;

  // text/code: full text
  // png: PNG data URL
  // sketch: ID in AppData.sketches
  content: string;

  createdAt: number;
  updatedAt: number;
};

export type AppData = {
  version: 1;
  notes: Note[];
  groups: Group[];
  sketches: Record<string, Sketch>;
  snippets: Record<string, Snippet>;
};
