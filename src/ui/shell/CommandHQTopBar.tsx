import React from 'react';
import {
  Crosshair,
  Home,
  Map,
  Settings,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useAudioSettingsStore } from '@/src/stores/audioSettingsStore';
import { useProgressionStore } from '@/src/stores/progressionStore';
import { uiStore } from '@/src/stores/uiStore';
import { Button } from '@/src/ui/primitives/Button';

export type HQSectionId = 'title' | 'campaign' | 'armory' | 'settings';

export function CommandHQTopBar({
  activeSection,
  subtitle,
  title,
  hardwareBadge,
  onNavigate,
  onUiClick,
}: {
  activeSection: HQSectionId;
  subtitle: string;
  title: string;
  hardwareBadge?: string | null;
  onNavigate?: (target: HQSectionId) => void;
  onUiClick?: () => void;
}) {
  const reqPoints = useProgressionStore((s) => s.save.requisitionPoints);
  const muted = useAudioSettingsStore((s) => s.muted);
  const updateAudio = useAudioSettingsStore((s) => s.updateAudio);

  const goTo = (target: HQSectionId) => {
    onUiClick?.();
    if (onNavigate) {
      onNavigate(target);
      return;
    }
    if (target === 'settings') {
      uiStore.getState().openSettingsFrom(activeSection === 'campaign' ? 'campaign' : 'title');
    } else {
      uiStore.getState().setScreen(target);
    }
  };

  const navItems: Array<{
    id: HQSectionId;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: 'title', label: 'HQ', icon: <Home className="w-3.5 h-3.5" /> },
    { id: 'campaign', label: 'Operations', icon: <Map className="w-3.5 h-3.5" /> },
    { id: 'armory', label: 'Armory', icon: <Crosshair className="w-3.5 h-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-3.5 h-3.5" /> },
  ];

  return (
    <header className="flex flex-wrap [@media(max-height:520px)]:flex-nowrap items-center justify-between gap-x-2 gap-y-1.5 sm:gap-2.5 [@media(max-height:520px)]:gap-1.5 border-b border-[var(--vg-border-subtle)] pb-2.5 [@media(max-height:520px)]:pb-1.5 shrink-0">
      <div className="flex items-center gap-2 flex-1 sm:flex-initial [@media(max-height:520px)]:flex-initial min-w-0 order-1">
        <div className="min-w-0">
          <p className="font-mono text-[9.5px] sm:text-[10px] uppercase tracking-[0.16em] sm:tracking-[0.2em] text-[var(--vg-accent-cyan)] truncate [@media(max-height:520px)]:hidden">
            {subtitle}
          </p>
          <h2 className="font-display text-base min-[360px]:text-lg sm:text-2xl [@media(max-height:520px)]:text-sm font-bold uppercase tracking-wider text-[var(--vg-text-primary)] truncate [@media(max-height:520px)]:max-w-[110px] min-[760px]:[@media(max-height:520px)]:max-w-none">
            {title}
          </h2>
        </div>
      </div>

      <nav
        aria-label="Command HQ Navigation"
        className="order-3 sm:order-2 [@media(max-height:520px)]:order-2 w-full sm:w-auto [@media(max-height:520px)]:w-auto flex items-center gap-1 sm:gap-1.5 flex-nowrap overflow-x-auto max-w-full no-scrollbar"
      >
        {navItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => goTo(item.id)}
              className={`inline-flex items-center justify-center gap-1 sm:gap-1.5 min-h-[40px] [@media(max-height:520px)]:min-h-[34px] px-2 min-[400px]:px-2.5 sm:px-3 [@media(max-height:520px)]:px-2 rounded-sm font-display text-[11px] min-[400px]:text-xs [@media(max-height:520px)]:text-[10.5px] uppercase tracking-wide sm:tracking-wider font-semibold transition-colors cursor-pointer border whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-[var(--vg-bg-elevated)] text-[var(--vg-accent-amber)] border-[var(--vg-accent-amber)]'
                  : 'bg-[var(--vg-bg-panel)] text-[var(--vg-text-secondary)] border-[var(--vg-border-subtle)] hover:border-[var(--vg-border-strong)] hover:text-[var(--vg-text-primary)]'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="order-2 sm:order-3 [@media(max-height:520px)]:order-3 flex items-center gap-1.5 sm:gap-2 shrink-0">
        {hardwareBadge && (
          <div className="hidden lg:flex items-center bg-[var(--vg-bg-recessed)] border border-[var(--vg-border-subtle)] px-2.5 py-1.5 rounded-sm font-mono text-[10px] uppercase tracking-wider text-[var(--vg-text-secondary)]">
            {hardwareBadge}
          </div>
        )}
        <div className="bg-[var(--vg-bg-panel)] border border-[var(--vg-accent-amber)]/45 px-2 sm:px-3 py-1.5 [@media(max-height:520px)]:py-1 [@media(max-height:520px)]:px-1.5 rounded-sm font-mono text-xs [@media(max-height:520px)]:text-[11px] flex items-center gap-1">
          <span className="text-[var(--vg-text-muted)] text-[10px]">REQ</span>
          <span className="text-[var(--vg-accent-amber)] font-bold tabular-nums">{reqPoints}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
          className="min-h-[40px] min-w-[40px] [@media(max-height:520px)]:min-h-[34px] [@media(max-height:520px)]:min-w-[34px] px-2"
          onClick={() => {
            onUiClick?.();
            updateAudio({ muted: !muted });
          }}
        >
          {muted ? (
            <VolumeX className="w-4 h-4 text-[var(--vg-accent-crimson)]" />
          ) : (
            <Volume2 className="w-4 h-4 text-[var(--vg-text-secondary)]" />
          )}
        </Button>
      </div>
    </header>
  );
}
