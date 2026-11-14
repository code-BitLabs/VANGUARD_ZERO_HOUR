import React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './cn';

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  'aria-label': ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange: (val: number) => void;
  'aria-label'?: string;
}) {
  return (
    <SliderPrimitive.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      onValueChange={(arr) => onValueChange(arr[0] ?? value)}
      className="relative flex items-center select-none touch-none w-full h-5 cursor-pointer"
    >
      <SliderPrimitive.Track className="bg-zinc-800 relative grow rounded-full h-1.5">
        <SliderPrimitive.Range className="absolute bg-amber-500 rounded-full h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block w-4 h-4 bg-zinc-100 border-2 border-amber-500 rounded-full shadow hover:bg-amber-300 focus:outline-none" />
    </SliderPrimitive.Root>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="w-10 h-5 bg-zinc-800 border border-zinc-700 rounded-full relative data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-400 transition-colors cursor-pointer"
    >
      <SwitchPrimitive.Thumb className="block w-3.5 h-3.5 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(Boolean(v))}
      className="w-4 h-4 rounded-sm bg-zinc-900 border border-zinc-600 flex items-center justify-center data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-400 cursor-pointer"
    >
      <CheckboxPrimitive.Indicator>
        <Check className="w-3 h-3 text-zinc-950 stroke-[3]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
}: {
  value: string;
  onValueChange: (val: string) => void;
  options: Array<{ value: string; label: string }>;
  'aria-label'?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className="inline-flex items-center justify-between gap-2 bg-[#0B0E11] border border-zinc-700 hover:border-amber-500/60 px-3 py-1.5 text-xs font-medium text-zinc-100 rounded-sm min-w-[140px] cursor-pointer"
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="z-50 bg-[#1B222C] border border-zinc-700 rounded-sm shadow-xl overflow-hidden">
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="flex items-center justify-between px-3 py-1.5 text-xs text-zinc-200 rounded-sm cursor-pointer outline-none data-[highlighted]:bg-amber-500 data-[highlighted]:text-zinc-950"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check className="w-3 h-3 ml-2" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function ProgressBar({
  value,
  className,
  barClassName,
}: {
  value: number;
  className?: string;
  barClassName?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <ProgressPrimitive.Root
      value={clamped}
      className={cn('relative overflow-hidden bg-zinc-800/90 rounded-xs h-2 w-full', className)}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full bg-amber-500 transition-transform duration-150', barClassName)}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={250}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-50 bg-[#0B0E11] border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-200 rounded-sm shadow-lg"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
