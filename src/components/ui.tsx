import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/util';

type Variant = 'default' | 'ghost' | 'outline' | 'danger';
const variants: Record<Variant, string> = {
  default: 'bg-zinc-900 text-white hover:bg-zinc-800',
  ghost: 'hover:bg-zinc-100 text-zinc-700',
  outline: 'border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-800',
  danger: 'text-red-600 hover:bg-red-50',
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'icon'; active?: boolean };

/** shadcn-style button without the CLI. */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = 'ghost', size = 'sm', active, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-8 px-2.5' : 'h-8 w-8',
        variants[variant],
        active && 'bg-zinc-900 text-white hover:bg-zinc-800',
        className,
      )}
      {...props}
    />
  );
});

export function Separator({ vertical }: { vertical?: boolean }) {
  return <div className={vertical ? 'mx-1 h-5 w-px bg-zinc-200' : 'my-2 h-px w-full bg-zinc-200'} />;
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)} style={{ background: color }} />;
}
