import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-display font-semibold uppercase tracking-[0.08em] text-sm transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-[var(--vg-border-focus)] focus-visible:outline-offset-2 border select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-amber-500 text-zinc-950 border-amber-400 hover:bg-amber-400 active:bg-amber-600 shadow-[0_1px_16px_rgba(245,158,11,0.2)]',
        secondary:
          'bg-[var(--vg-surface-elevated)] text-[var(--vg-text-primary)] border-[var(--vg-border-strong)] hover:border-amber-500/60 hover:bg-[#1f2937]',
        tactical:
          'bg-sky-500/12 text-sky-300 border-sky-400/40 hover:bg-sky-500/20 hover:border-sky-400',
        ghost:
          'bg-transparent text-[var(--vg-text-secondary)] border-transparent hover:bg-white/[0.05] hover:text-[var(--vg-text-primary)]',
        danger:
          'bg-red-600/90 text-white border-red-500 hover:bg-red-500 active:bg-red-700',
        outline:
          'bg-[var(--vg-surface-well)] text-[var(--vg-text-primary)] border-[var(--vg-border-strong)] hover:border-amber-500/75 hover:text-amber-300',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-[3px]',
        md: 'h-10 px-4 text-sm rounded-[4px]',
        lg: 'h-12 px-7 text-base rounded-[4px]',
        icon: 'h-9 w-9 p-0 rounded-[4px]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = 'Button';
