import React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './cn';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex shrink-0 items-center gap-1 bg-[#0B0E11] p-1 border border-zinc-800 rounded-sm',
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'px-3.5 py-1.5 text-xs font-display font-semibold uppercase tracking-wider rounded-sm text-zinc-400 hover:text-zinc-100 data-[state=active]:bg-amber-500 data-[state=active]:text-zinc-950 transition-colors cursor-pointer',
        className
      )}
      {...props}
    />
  );
}

export const TabsContent = TabsPrimitive.Content;
