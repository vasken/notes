export const uid = () =>
  (
    crypto.randomUUID?.() ??
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  )
    .replace(/-/g, '')
    .slice(0, 12);

export const cn = (
  ...values: (string | false | null | undefined)[]
) => values.filter(Boolean).join(' ');

export const SKETCH_RE =
  /!\[[^\]]*\]\(sketch:([a-z0-9]+)\)/gi;

export function sketchIdsIn(body: string): string[] {
  return [...body.matchAll(SKETCH_RE)].map(match => match[1]);
}

/**
 * Snippet references must be on their own line.
 * Ignore references inside fenced code blocks.
 */
export function snippetIdsIn(body: string): string[] {
  const ids = new Set<string>();

  let fence: {
    character: string;
    length: number;
  } | null = null;

  for (const line of body.split('\n')) {
    if (fence) {
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);

      if (
        closing &&
        closing[1][0] === fence.character &&
        closing[1].length >= fence.length
      ) {
        fence = null;
      }

      continue;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);

    if (opening) {
      fence = {
        character: opening[1][0],
        length: opening[1].length,
      };
      continue;
    }

    const reference = line.match(/^snippet:([a-z0-9]+)[ \t]*$/);

    if (reference) ids.add(reference[1]);
  }

  return [...ids];
}

export function removeSnippetReference(
  body: string,
  id: string,
): string {
  let fence: {
    character: string;
    length: number;
  } | null = null;

  return body
    .split('\n')
    .filter(line => {
      if (fence) {
        const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);

        if (
          closing &&
          closing[1][0] === fence.character &&
          closing[1].length >= fence.length
        ) {
          fence = null;
        }

        return true;
      }

      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);

      if (opening) {
        fence = {
          character: opening[1][0],
          length: opening[1].length,
        };
        return true;
      }

      return line.trim() !== `snippet:${id}`;
    })
    .join('\n');
}

export function snippet(body: string, max = 220): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/^snippet:[a-z0-9]+[ \t]*$/gm, '[Snippet]')
    .replace(SKETCH_RE, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(
      /^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+\.)\s*/gm,
      '',
    )
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function relTime(timestamp: number): string {
  const seconds = (Date.now() - timestamp) / 1000;

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) {
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  return new Date(timestamp).toLocaleDateString();
}

export function toggleTaskAt(
  source: string,
  offset: number,
): string {
  const pattern = /\[( |x|X)\]/g;
  pattern.lastIndex = offset;

  const match = pattern.exec(source);
  if (!match) return source;

  const next = match[1] === ' ' ? 'x' : ' ';

  return (
    source.slice(0, match.index) +
    `[${next}]` +
    source.slice(match.index + 3)
  );
}

export function matchesSearch(
  note: { title: string; body: string },
  query: string,
): boolean {
  if (!query.trim()) return true;

  const text = `${note.title}\n${note.body}`.toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(term => text.includes(term));
}
