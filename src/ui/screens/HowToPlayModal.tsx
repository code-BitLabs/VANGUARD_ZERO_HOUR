import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/src/ui/primitives/Button';
import { Card, CardContent } from '@/src/ui/primitives/Card';

const SECTIONS = [
  {
    title: 'Infantry Movement & Stance',
    items: [
      ['W / A / S / D', 'Move & Strafe'],
      ['Shift', 'Tactical Sprint'],
      ['C', 'Crouch / Sprint-Slide (while sprinting)'],
      ['Space', 'Jump / Vault Low Cover'],
      ['Mouse', 'Free Look (Pointer Lock)'],
    ],
  },
  {
    title: 'Weapons & Ballistics',
    items: [
      ['Left Click', 'Fire Active Weapon / Vehicle Turret'],
      ['Right Click', 'Aim Down Sights / 6x Sniper Optical Scope'],
      ['1 – 9 / Scroll', 'Switch Across All 9 Weapons'],
      ['R / B', 'Reload Magazine / Cycle Fire Mode'],
      ['G', 'Throw M67 Fragmentation Grenade'],
    ],
  },
  {
    title: 'Vehicles, Guided Missiles & Systems',
    items: [
      ['E', 'Enter/Exit Vehicle, Collect Supply Crate, Sabotage Target'],
      ['Slot 8 (FIM-92X)', 'Hold aim on Helicopters, Drones, Jets or APCs to Lock On'],
      ['Esc', 'Pause Operation / Unlock Cursor'],
      ['F3', 'Toggle Engine Diagnostics Telemetry'],
    ],
  },
];

export function HowToPlayModal({ onBack }: { onBack: () => void }) {
  return (
    <div className="fixed inset-0 z-30 bg-[#0B0E11]/95 flex items-center justify-center p-5 overflow-y-auto">
      <div className="max-w-4xl w-full space-y-5">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-500">Field Manual</p>
            <h2 className="font-display text-2xl font-bold uppercase text-white">Combat Controls & Systems</h2>
          </div>
          <Button variant="secondary" size="sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {SECTIONS.map((sec) => (
            <Card key={sec.title}>
              <CardContent className="space-y-3">
                <h3 className="font-display text-sm font-bold uppercase tracking-wider text-amber-400">
                  {sec.title}
                </h3>
                <div className="space-y-2.5">
                  {sec.items.map(([k, desc]) => (
                    <div key={k} className="border-b border-zinc-800/70 pb-2 last:border-0 last:pb-0">
                      <div className="font-mono text-xs text-cyan-400">{k}</div>
                      <div className="text-xs text-zinc-300 mt-0.5">{desc}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
