import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react';
import { AudioManager } from '@/src/audio/AudioManager';
import { MUSIC_TRACK_CATALOG } from '@/src/audio/MusicCatalog';
import { MusicPlaybackSnapshot, MusicRepeatMode } from '@/src/audio/MusicPlayerController';
import { useAudioSettingsStore } from '@/src/stores/audioSettingsStore';
import { Slider } from '@/src/ui/primitives/Controls';

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function buildFallbackSnapshot(
  trackId: string,
  shuffle: boolean,
  repeatMode: MusicRepeatMode
): MusicPlaybackSnapshot {
  const track = MUSIC_TRACK_CATALOG.find((t) => t.id === trackId) ?? MUSIC_TRACK_CATALOG[0];
  return {
    trackId: track.id,
    trackTitle: track.title,
    trackMoodLabel: track.moodLabel,
    trackMood: track.mood,
    isPlaying: false,
    isPausedByLifecycle: false,
    isLoading: false,
    currentTimeSec: 0,
    durationSec: track.durationSec,
    shuffle,
    repeatMode,
    duckLevel: 1,
    activeSourceCount: 0,
    errorTrackIds: [],
    lastError: null,
    tracks: MUSIC_TRACK_CATALOG,
  };
}

export const MusicPlayerPanel: React.FC = () => {
  const audioSettings = useAudioSettingsStore((s) => s);
  const [snap, setSnap] = useState<MusicPlaybackSnapshot>(() => {
    const active = AudioManager.getActiveInstance();
    return active
      ? active.getMusicController().getSnapshot()
      : buildFallbackSnapshot(
          audioSettings.musicTrackId,
          audioSettings.musicShuffle,
          audioSettings.musicRepeatMode
        );
  });

  useEffect(() => {
    const active = AudioManager.getActiveInstance();
    if (!active) {
      setSnap(
        buildFallbackSnapshot(
          audioSettings.musicTrackId,
          audioSettings.musicShuffle,
          audioSettings.musicRepeatMode
        )
      );
      return;
    }

    const ctrl = active.getMusicController();
    const unsub = ctrl.subscribe(setSnap);
    const interval = window.setInterval(() => {
      setSnap(ctrl.getSnapshot());
    }, 250);

    return () => {
      unsub();
      window.clearInterval(interval);
    };
  }, [audioSettings.musicTrackId, audioSettings.musicShuffle, audioSettings.musicRepeatMode]);

  const ensureUnlockedAndGetController = () => {
    const active = AudioManager.getActiveInstance();
    if (!active) return null;
    active.unlock();
    return active.getMusicController();
  };

  const handleTogglePlay = () => {
    const ctrl = ensureUnlockedAndGetController();
    if (ctrl) {
      void ctrl.togglePlay();
    } else {
      audioSettings.updateAudio({ musicEnabled: !audioSettings.musicEnabled });
    }
  };

  const handleNext = () => {
    const ctrl = ensureUnlockedAndGetController();
    if (ctrl) {
      void ctrl.next(true);
    } else {
      const idx = MUSIC_TRACK_CATALOG.findIndex((t) => t.id === audioSettings.musicTrackId);
      const next = MUSIC_TRACK_CATALOG[(idx + 1) % MUSIC_TRACK_CATALOG.length];
      audioSettings.updateAudio({ musicTrackId: next.id });
    }
  };

  const handlePrev = () => {
    const ctrl = ensureUnlockedAndGetController();
    if (ctrl) {
      void ctrl.previous(true);
    } else {
      const idx = MUSIC_TRACK_CATALOG.findIndex((t) => t.id === audioSettings.musicTrackId);
      const prev =
        MUSIC_TRACK_CATALOG[(idx - 1 + MUSIC_TRACK_CATALOG.length) % MUSIC_TRACK_CATALOG.length];
      audioSettings.updateAudio({ musicTrackId: prev.id });
    }
  };

  const handleSeek = (val: number) => {
    const ctrl = ensureUnlockedAndGetController();
    if (ctrl) {
      void ctrl.seek(val);
    }
  };

  const handleSelectTrack = (id: string) => {
    const ctrl = ensureUnlockedAndGetController();
    if (ctrl) {
      void ctrl.selectTrack(id, { autoPlay: true, fromUser: true });
    } else {
      audioSettings.updateAudio({ musicTrackId: id, musicEnabled: true });
    }
  };

  const handleToggleShuffle = () => {
    const nextShuffle = !snap.shuffle;
    const ctrl = AudioManager.getActiveInstance()?.getMusicController();
    if (ctrl) {
      ctrl.setShuffle(nextShuffle);
    }
    audioSettings.updateAudio({ musicShuffle: nextShuffle });
  };

  const handleCycleRepeat = () => {
    const order: MusicRepeatMode[] = ['all', 'one', 'off'];
    const nextMode = order[(order.indexOf(snap.repeatMode) + 1) % order.length];
    const ctrl = AudioManager.getActiveInstance()?.getMusicController();
    if (ctrl) {
      ctrl.setRepeatMode(nextMode);
    }
    audioSettings.updateAudio({ musicRepeatMode: nextMode });
  };

  const statusText = snap.isLoading
    ? 'LOADING'
    : snap.isPausedByLifecycle
      ? 'SUSPENDED'
      : snap.isPlaying
        ? 'PLAYING'
        : 'PAUSED';

  const repeatLabel =
    snap.repeatMode === 'one'
      ? 'Repeat One'
      : snap.repeatMode === 'all'
        ? 'Repeat All'
        : 'Repeat Off';

  return (
    <section
      aria-label="Tactical Score Music Player"
      data-testid="music-player-panel"
      className="rounded-lg border border-zinc-800 bg-zinc-900/75 p-4 space-y-3.5"
    >
      <div className="flex items-start justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Tactical Score · {statusText}
          </div>
          <div
            data-testid="music-current-title"
            className="mt-0.5 truncate text-sm font-bold text-zinc-100"
          >
            {snap.trackTitle}
          </div>
          <div className="mt-0.5 text-xs text-zinc-400">
            {snap.trackMoodLabel} · {snap.tracks.find((t) => t.id === snap.trackId)?.bpm ?? 108} BPM
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            aria-label="Shuffle Tracks"
            aria-pressed={snap.shuffle}
            onClick={handleToggleShuffle}
            className={`rounded border px-2 py-1.5 text-xs transition-colors ${
              snap.shuffle
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Shuffle"
          >
            <Shuffle className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            aria-label="Previous Track"
            onClick={handlePrev}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            title="Previous track"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            aria-label={snap.isPlaying ? 'Pause Music' : 'Play Music'}
            data-testid="music-play-pause-btn"
            onClick={handleTogglePlay}
            className="rounded border border-amber-500/70 bg-amber-500/20 px-2.5 py-1.5 text-amber-200 transition-colors hover:bg-amber-500/30"
            title={snap.isPlaying ? 'Pause' : 'Play'}
          >
            {snap.isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>

          <button
            type="button"
            aria-label="Next Track"
            data-testid="music-next-btn"
            onClick={handleNext}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            title="Next track"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            aria-label={`Repeat Mode: ${repeatLabel}`}
            onClick={handleCycleRepeat}
            className={`rounded border px-2 py-1.5 text-xs transition-colors ${
              snap.repeatMode !== 'off'
                ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
            title={repeatLabel}
          >
            {snap.repeatMode === 'one' ? (
              <Repeat1 className="h-3.5 w-3.5" />
            ) : (
              <Repeat className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Progress bar with elapsed / total time and interactive seek */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400 tabular-nums">
          <span data-testid="music-elapsed-time">{formatClock(snap.currentTimeSec)}</span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">
            {snap.duckLevel < 0.92 ? 'Radio Ducking Active' : repeatLabel}
          </span>
          <span data-testid="music-total-time">{formatClock(snap.durationSec)}</span>
        </div>
        <Slider
          aria-label="Seek Music Progress"
          value={Math.min(snap.durationSec, snap.currentTimeSec)}
          min={0}
          max={Math.max(1, snap.durationSec)}
          step={0.5}
          onValueChange={handleSeek}
        />
      </div>

      {/* Compact integrated music volume strip */}
      <div className="flex items-center justify-between gap-4 border-t border-zinc-800/70 pt-2.5">
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <Volume2 className="h-3.5 w-3.5 text-zinc-400" />
          <span className="tabular-nums">
            Music Level ({Math.round(audioSettings.musicVolume * 100)}%)
          </span>
        </div>
        <div className="w-44">
          <Slider
            aria-label="Player Music Volume"
            value={audioSettings.musicVolume}
            min={0}
            max={1}
            step={0.02}
            onValueChange={(musicVolume) => audioSettings.updateAudio({ musicVolume })}
          />
        </div>
      </div>

      {snap.lastError && (
        <div className="flex items-center gap-2 rounded border border-red-900/70 bg-red-950/40 px-2.5 py-1.5 text-xs text-red-300">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{snap.lastError}</span>
        </div>
      )}

      {/* Selectable track playlist */}
      <div className="border-t border-zinc-800/70 pt-2.5">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Soundtrack Playlist ({snap.tracks.length} Tracks)
        </div>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {snap.tracks.map((track, index) => {
            const isActive = track.id === snap.trackId;
            const hasError = snap.errorTrackIds.includes(track.id);
            return (
              <button
                key={track.id}
                type="button"
                data-testid={`music-track-${track.id}`}
                onClick={() => handleSelectTrack(track.id)}
                className={`flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-left transition-colors ${
                  isActive
                    ? 'border-amber-500/60 bg-amber-500/12 text-amber-100'
                    : 'border-zinc-800/90 bg-zinc-950/50 text-zinc-300 hover:border-zinc-600 hover:text-white'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">
                    <span className="mr-1.5 text-[10px] text-zinc-500 tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {track.title}
                  </div>
                  <div className="truncate text-[10px] text-zinc-400">
                    {hasError ? 'Unavailable' : track.moodLabel}
                  </div>
                </div>
                <span className="shrink-0 text-[10px] text-zinc-400 tabular-nums">
                  {formatClock(track.durationSec)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
