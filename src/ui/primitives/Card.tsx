import React from 'react';
import { cn } from './cn';

export function Card({
  className,
  children,
  elevated = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { elevated?: boolean }) {
  return (
    <div
      className={cn(
        elevated
          ? 'bg-[var(--vg-surface-elevated)] border border-[var(--vg-border-strong)]'
          : 'bg-[var(--vg-surface-panel)] border border-[var(--vg-border-hairline)]',
        'rounded-[4px] shadow-[0_8px_28px_rgba(0,0,0,0.4)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-5', className)} {...props}>
      {children}
    </div>
  );
}
