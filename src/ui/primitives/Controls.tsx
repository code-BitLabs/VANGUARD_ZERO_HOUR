import React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as ProgressPrimitive from '@radix-ui/react-progress';
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
      className="relative flex items-center select-none touch-none w-full h-7 py-1 cursor-pointer"
    >
      <SliderPrimitive.Track className="bg-zinc-800 relative grow rounded-full h-1.5">
        <SliderPrimitive.Range className="absolute bg-amber-500 rounded-full h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="relative block w-4 h-4 [@media(pointer:coarse)]:w-5 [@media(pointer:coarse)]:h-5 bg-zinc-100 border-2 border-amber-500 rounded-full shadow hover:bg-amber-300 focus:outline-none after:absolute after:-inset-3 after:content-['']" />
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
      className="w-10 h-5 bg-zinc-800 border border-zinc-700 rounded-full relative data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-400 transition-colors cursor-pointer after:absolute after:-inset-2.5 after:content-['']"
    >
      <SwitchPrimitive.Thumb className="block w-3.5 h-3.5 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-5" />
    </SwitchPrimitive.Root>
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
        className="inline-flex items-center justify-between gap-2 bg-[#0B0E11] border border-zinc-700 hover:border-amber-500/60 px-3 py-2 sm:py-1.5 min-h-[38px] sm:min-h-[32px] text-xs font-medium text-zinc-100 rounded-sm min-w-[140px] cursor-pointer"
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="z-50 bg-[#1B222C] border border-zinc-700 rounded-sm shadow-xl overflow-hidden max-h-60 overflow-y-auto">
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="flex items-center justify-between px-3 py-2 sm:py-1.5 min-h-[36px] sm:min-h-[30px] text-xs text-zinc-200 rounded-sm cursor-pointer outline-none data-[highlighted]:bg-amber-500 data-[highlighted]:text-zinc-950"
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
