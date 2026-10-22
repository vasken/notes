import { memo, useMemo, useRef } from 'react';

import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from 'react-markdown';

import remarkGfm from 'remark-gfm';
import { Pencil } from 'lucide-react';

import { useStore } from '../store';
import { toggleTaskAt } from '../lib/util';

import { SketchView } from './SketchView';
import { SnippetPreview } from './Snippets';

function SketchEmbed({ id }: { id: string }) {
  const sketch = useStore(state => state.sketches[id]);
  const openSketch = useStore(state => state.openSketch);

  if (!sketch) {
    return (
      <span className="block rounded-md border border-dashed p-3 text-xs text-zinc-400">
        Missing sketch
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => openSketch(id)}
      onKeyDown={event => {
        if (event.key === 'Enter') openSketch(id);
      }}
      className="group relative my-3 block cursor-pointer overflow-hidden rounded-lg border border-zinc-200 bg-white transition hover:border-zinc-400"
    >
      {sketch.shapes.length ? (
        <SketchView
          sketch={sketch}
          className="block max-h-96 w-full"
        />
      ) : (
        <span className="block p-8 text-center text-sm text-zinc-400">
          Empty sketch: click to draw
        </span>
      )}

      <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100">
        <Pencil className="h-3 w-3" />
        Edit sketch
      </span>
    </span>
  );
}

const PNG_DATA_URL =
  /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

function urlTransform(url: string, key: string): string {
  if (
    key === 'src' &&
    (url.startsWith('sketch:') || PNG_DATA_URL.test(url))
  ) {
    return url;
  }

  return defaultUrlTransform(url);
}

export const Markdown = memo(function Markdown({
  source,
  onChange,
}: {
  source: string;
  onChange?: (next: string) => void;
}) {
  const latest = useRef({ source, onChange });
  latest.current = { source, onChange };

  const interactive = Boolean(onChange);

  const components: Components = useMemo(() => ({
    p: ({ node, children }) => {
      const child = node?.children.length === 1
        ? node.children[0]
        : undefined;

      const match = child?.type === 'text'
        ? child.value.trim().match(/^snippet:([a-z0-9]+)$/)
        : null;

      if (!match) return <p>{children}</p>;

      const start = node?.position?.start.offset;
      const end = node?.position?.end.offset;

      // Only interpret a reference occupying its own source line.
      const fullSource = latest.current.source;

      const lineStart = start === undefined || start === 0
        ? 0
        : fullSource.lastIndexOf('\n', start - 1) + 1;

      const nextNewline = end === undefined
        ? -1
        : fullSource.indexOf('\n', end);

      const lineEnd = nextNewline < 0
        ? fullSource.length
        : nextNewline;

      const standalone =
        start !== undefined &&
        end !== undefined &&
        fullSource.slice(lineStart, lineEnd).trim() ===
          `snippet:${match[1]}`;

      if (!standalone) return <p>{children}</p>;

      return (
        <SnippetPreview
          id={match[1]}
          onRemove={
            interactive
              ? () => {
                  const current = latest.current;

                  if (!current.onChange) return;

                  const removeEnd = nextNewline < 0
                    ? lineEnd
                    : lineEnd + 1;

                  current.onChange(
                    current.source.slice(0, lineStart) +
                    current.source.slice(removeEnd),
                  );
                }
              : undefined
          }
        />
      );
    },

    img: ({ src, alt }) => {
      if (typeof src !== 'string' || !src) return null;

      if (src.startsWith('sketch:')) {
        return <SketchEmbed id={src.slice(7)} />;
      }

      return (
        <img
          src={src}
          alt={alt ?? ''}
          loading="lazy"
          className="max-w-full rounded-lg"
        />
      );
    },

    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ),

    input: ({
      node: _node,
      disabled: _disabled,
      ...props
    }) => (
      <input
        {...props}
        disabled={!interactive}
        onChange={() => {}}
        className={interactive ? 'cursor-pointer' : undefined}
      />
    ),

    li: ({ node, children, className }) => {
      const offset = node?.position?.start.offset;

      return (
        <li
          className={className}
          onClick={event => {
            const target = event.target as HTMLInputElement;
            const current = latest.current;

            if (
              target.tagName !== 'INPUT' ||
              target.type !== 'checkbox' ||
              offset === undefined ||
              !current.onChange
            ) {
              return;
            }

            event.stopPropagation();

            current.onChange(
              toggleTaskAt(current.source, offset),
            );
          }}
        >
          {children}
        </li>
      );
    },
  }), [interactive]);

  return (
    <div className="prose prose-zinc max-w-none prose-headings:font-semibold prose-a:text-blue-600 prose-pre:bg-zinc-900 prose-code:before:content-none prose-code:after:content-none prose-img:rounded-lg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
