import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  secondaryLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void;
  onSecondary?: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  secondaryLabel,
  cancelLabel = 'Cancel',
  variant = 'primary',
  onConfirm,
  onSecondary,
}: ConfirmDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[45] bg-black/75 data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[46] w-[calc(100%-24px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[6px] border border-[var(--vg-border-strong)] bg-[var(--vg-surface-elevated)] p-5 shadow-2xl focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertTriangle
                className={
                  variant === 'danger'
                    ? 'w-5 h-5 text-red-400 shrink-0'
                    : 'w-5 h-5 text-amber-400 shrink-0'
                }
                aria-hidden="true"
              />
              <DialogPrimitive.Title className="font-display text-lg font-bold uppercase tracking-wider text-white">
                {title}
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close
              aria-label="Close dialog"
              className="p-1 text-zinc-400 hover:text-white rounded-[3px] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </DialogPrimitive.Close>
          </div>

          <DialogPrimitive.Description className="mt-3 text-sm text-zinc-300 leading-relaxed">
            {description}
          </DialogPrimitive.Description>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[40px]"
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            {secondaryLabel && onSecondary && (
              <Button
                variant="outline"
                size="sm"
                className="min-h-[40px]"
                onClick={() => {
                  onSecondary();
                  onOpenChange(false);
                }}
              >
                {secondaryLabel}
              </Button>
            )}
            <Button
              variant={variant === 'danger' ? 'danger' : 'primary'}
              size="sm"
              className="min-h-[40px]"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
