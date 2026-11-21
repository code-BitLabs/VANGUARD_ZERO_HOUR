import React from 'react';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { TIER3_MECHANIC_CARDS } from '@/src/gameplay/TacticalGuidanceSystem';
import { Button } from '@/src/ui/primitives/Button';
import { Card, CardContent } from '@/src/ui/primitives/Card';

const SECTIONS = [
  {
    title: 'Mobile Landscape Touch Controls',
    items: [
      ['Left Movement Zone', '360° analog thumbstick anywhere on lower-left; push forward edge to Auto-Sprint'],
      ['Right Camera Surface', 'Continuous 360° drag aiming & vertical pitch (never fires accidentally)'],
      ['FIRE & ADS Toggle', 'Dedicated Fire trigger + tap-to-toggle ADS aim (customizable in Settings)'],
      ['Primary & Kit Tray', 'Reload, Weapon Switch, Jump, Crouch/Slide; Grenade, Interact & Kit drawer appear cleanly on demand'],
      ['Top-Right HUD', 'Touch Overlay Toggle & Pause Button (min 44px touch targets)'],
    ],
  },
  {
    title: 'Infantry Movement & Stance',
    items: [
      ['W / A / S / D', 'Move & Strafe'],
      ['Shift', 'Tactical Sprint'],
      ['Ctrl / Alt', 'Crouch / Sprint-Slide (while sprinting)'],
      ['Space', 'Jump / Vault Low Cover'],
      ['Tab', 'Toggle Non-Pausing Tactical Overview Drawer & Cursor Lock'],
    ],
  },
  {
    title: 'Weapons, Ballistics & Ordnance',
    items: [
      ['Left Click', 'Fire Active Weapon / Vehicle Turret'],
      ['Right Click', 'Aim Down Sights / 6x Sniper Optical Scope'],
      ['1 – 9 / Scroll', 'Switch Across All 9 Weapons'],
      ['R / B / G', 'Reload Magazine / Cycle Fire Mode / Throw Frag'],
      ['C / Shift+C', 'Place C4 Satchel Charge / Remotely Detonate C4'],
      ['V / Shift+V', 'Call Tactical Bomb Strike / Cycle Bomb Type'],
      ['N + Enter', 'Request & Authorize [N] TRIDENT-X Strategic Strike'],
    ],
  },
  {
    title: 'Vehicles, Guided Missiles & Systems',
    items: [
      ['E', 'Enter/Exit Vehicle, Operate Cargo Lift, Plant Charge'],
      ['F', 'Cycle Vehicle Camera (Chase / Driver FPV / Turret / Orbit)'],
      ['Slot 8 (FIM-92X)', 'Hold aim on Helicopters, Drones, Jets or APCs to Lock On'],
      ['Esc', 'Pause Operation / Unlock Cursor'],
      ['F3 / F4', 'Toggle Engine & Combat AI Diagnostics (Dev Mode)'],
    ],
  },
];

export function HowToPlayModal({ onBack }: { onBack: () => void }) {
  return (
    <div
      className="fixed inset-0 z-30 bg-[#0B0E11]/95 flex items-start sm:items-center justify-center overflow-y-auto"
      style={{
        paddingTop: 'max(14px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(14px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="max-w-5xl w-full space-y-4 my-auto py-3">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-500">
              Field Manual // Tactical Mechanics Reference
            </p>
            <h2 className="font-display text-xl sm:text-2xl font-bold uppercase text-white">
              Combat Controls &amp; Tactical Systems
            </h2>
          </div>
          <Button variant="secondary" size="sm" className="min-h-[44px] px-4" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
        </div>

        {/* Tier 3 Advanced Mechanic Cards */}
        <div data-testid="tier3-mechanic-cards" className="space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            <span>Specialized Tactical Systems &amp; Stage Rules</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {TIER3_MECHANIC_CARDS.map((card) => (
              <div
                key={card.id}
                data-testid={`mechanic-card-${card.id}`}
                className="bg-[#141920] border border-zinc-800 p-3 rounded-sm space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-xs font-bold uppercase text-amber-400">
                    {card.title}
                  </span>
                  <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 text-zinc-300 rounded-xs">
                    {card.badge}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-300 leading-snug">{card.summary}</p>
                <div className="pt-1 border-t border-zinc-800/80 font-mono text-[10px] space-y-0.5">
                  <div className="text-cyan-300">
                    <span className="text-zinc-500">DESKTOP: </span>
                    {card.desktopControls}
                  </div>
                  <div className="text-amber-300">
                    <span className="text-zinc-500">MOBILE: </span>
                    {card.mobileControls}
                  </div>
                </div>
                <div className="text-[10px] text-emerald-300/90 italic">{card.tacticalNotes[0]}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {SECTIONS.map((sec) => (
            <Card key={sec.title}>
              <CardContent className="space-y-2.5">
                <h3 className="font-display text-sm font-bold uppercase tracking-wider text-amber-400">
                  {sec.title}
                </h3>
                <div className="space-y-2">
                  {sec.items.map(([k, desc]) => (
                    <div key={k} className="border-b border-zinc-800/70 pb-1.5 last:border-0 last:pb-0">
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
