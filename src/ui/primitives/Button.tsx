import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-display font-semibold uppercase tracking-[0.08em] text-sm transition-colors duration-150 cursor-pointer disabled:opacity-45 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-amber-500 focus-visible:outline-offset-2 border',
  {
    variants: {
      variant: {
        primary:
          'bg-amber-500 text-zinc-950 border-amber-400 hover:bg-amber-400 active:bg-amber-600 shadow-[0_0_20px_rgba(245,158,11,0.22)]',
        secondary:
          'bg-[#1B222C] text-zinc-100 border-zinc-700 hover:border-amber-500/60 hover:bg-[#232c39]',
        ghost:
          'bg-transparent text-zinc-300 border-transparent hover:bg-white/5 hover:text-white',
        danger:
          'bg-red-600/90 text-white border-red-500 hover:bg-red-500',
        outline:
          'bg-[#0B0E11]/85 text-zinc-200 border-zinc-600 hover:border-amber-500 hover:text-amber-400',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-sm',
        md: 'h-10 px-4 text-sm rounded-sm',
        lg: 'h-12 px-7 text-base rounded-sm',
        icon: 'h-9 w-9 p-0 rounded-sm',
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
