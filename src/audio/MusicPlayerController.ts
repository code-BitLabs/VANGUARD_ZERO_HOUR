import {
  getDefaultTrackForMood,
  getMusicTrackById,
  MUSIC_TRACK_CATALOG,
  MusicMood,
  MusicTrackMetadata,
} from './MusicCatalog';
import { MusicSynthWorkerClient } from './MusicSynthWorkerClient';

export type MusicRepeatMode = 'all' | 'one' | 'off';

export interface MusicPlaybackSnapshot {
  trackId: string;
  trackTitle: string;
  trackMoodLabel: string;
  trackMood: MusicMood;
  isPlaying: boolean;
  isPausedByLifecycle: boolean;
  isLoading: boolean;
  currentTimeSec: number;
  durationSec: number;
  shuffle: boolean;
  repeatMode: MusicRepeatMode;
  adaptiveEnabled: boolean;
  userTrackLocked: boolean;
  duckLevel: number;
  activeSourceCount: number;
  errorTrackIds: string[];
  lastError: string | null;
  tracks: readonly MusicTrackMetadata[];
}

export interface MusicTrackLoader {
  loadTrack(track: MusicTrackMetadata, ctx: AudioContext): Promise<AudioBuffer>;
}

export interface MusicControllerOptions {
  tracks?: readonly MusicTrackMetadata[];
  initialTrackId?: string;
  initialShuffle?: boolean;
  initialRepeatMode?: MusicRepeatMode;
  customLoader?: MusicTrackLoader;
  onPreferenceChange?: (prefs: {
    musicTrackId: string;
    musicShuffle: boolean;
    musicRepeatMode: MusicRepeatMode;
    musicEnabled: boolean;
  }) => void;
}

interface ActiveTrackPlayback {
  source: AudioBufferSourceNode;
  trackGain: GainNode;
  startedAtCtxSec: number;
  startOffsetSec: number;
  epoch: number;
  stop: () => void;
}

/**
 * Authoritative multi-track background music controller.
 * Guarantees:
 * - At most ONE active AudioBufferSourceNode at any time (zero overlap/duplication on restart or rapid toggling).
 * - Independent ducking gain that deterministically restores exact user volume after radio/dialogue cues.
 * - Clean pause/resume across mission transitions and browser visibility changes.
 * - Isolated per-track failure handling with automatic fallback to next playable track.
 * - Bounded memory: keeps only the active track buffer resident (releases prior buffer on switch).
 */
export class MusicPlayerController {
  private readonly tracks: readonly MusicTrackMetadata[];
  private readonly customLoader?: MusicTrackLoader;
  private readonly onPreferenceChange?: MusicControllerOptions['onPreferenceChange'];

  private ctx: AudioContext | null = null;
  private outputNode: GainNode | null = null;
  private duckGainNode: GainNode | null = null;

  private currentTrackId: string;
  private shuffle: boolean;
  private repeatMode: MusicRepeatMode;
  private userEnabled = true;

  private isPlaying = false;
  private isPausedByLifecycle = false;
  private resumeAfterLifecycle = false;
  private isLoading = false;

  private currentTimeSec = 0;
  private activeBufferTrackId: string | null = null;
  private activeBuffer: AudioBuffer | null = null;
  private readonly bufferLruCache = new Map<string, AudioBuffer>();
  private readonly maxCachedTracks = 2;
  private readonly synthWorker = new MusicSynthWorkerClient();
  private activePlayback: ActiveTrackPlayback | null = null;
  private playbackEpoch = 0;

  private duckLevel = 1.0;
  private targetDuckLevel = 1.0;
  private duckRemainingSec = 0;

  private adaptiveEnabled = true;
  private userTrackLocked = false;
  private adaptiveCooldownSec = 0;

  private readonly errorTrackIds = new Set<string>();
  private lastError: string | null = null;
  private readonly listeners = new Set<(snap: MusicPlaybackSnapshot) => void>();

  constructor(opts: MusicControllerOptions = {}) {
    this.tracks = opts.tracks && opts.tracks.length > 0 ? opts.tracks : MUSIC_TRACK_CATALOG;
    const initial =
      (opts.initialTrackId && this.tracks.find((t) => t.id === opts.initialTrackId)) ||
      this.tracks[0];
    this.currentTrackId = initial.id;
    this.shuffle = Boolean(opts.initialShuffle);
    this.repeatMode = opts.initialRepeatMode ?? 'all';
    this.customLoader = opts.customLoader;
    this.onPreferenceChange = opts.onPreferenceChange;
  }

  attachAudioContext(ctx: AudioContext, destinationMusicGain: GainNode): void {
    if (this.ctx === ctx && this.outputNode === destinationMusicGain) return;
    this.teardownActiveSource();
    this.ctx = ctx;
    this.outputNode = destinationMusicGain;
    this.duckGainNode = ctx.createGain();
    this.duckGainNode.gain.value = this.duckLevel;
    this.duckGainNode.connect(destinationMusicGain);
  }

  getTracks(): readonly MusicTrackMetadata[] {
    return this.tracks;
  }

  getCurrentTrack(): MusicTrackMetadata {
    return this.tracks.find((t) => t.id === this.currentTrackId) ?? this.tracks[0];
  }

  getActiveSourceCount(): number {
    return this.activePlayback ? 1 : 0;
  }

  getSnapshot(): MusicPlaybackSnapshot {
    const track = this.getCurrentTrack();
    const duration = this.activeBuffer?.duration ?? track.durationSec;
    const liveTime = this.computeLivePositionSec(duration);
    return {
      trackId: track.id,
      trackTitle: track.title,
      trackMoodLabel: track.moodLabel,
      trackMood: track.mood,
      isPlaying: this.isPlaying && !this.isPausedByLifecycle,
      isPausedByLifecycle: this.isPausedByLifecycle,
      isLoading: this.isLoading,
      currentTimeSec: liveTime,
      durationSec: duration,
      shuffle: this.shuffle,
      repeatMode: this.repeatMode,
      adaptiveEnabled: this.adaptiveEnabled,
      userTrackLocked: this.userTrackLocked,
      duckLevel: this.duckLevel,
      activeSourceCount: this.getActiveSourceCount(),
      errorTrackIds: Array.from(this.errorTrackIds),
      lastError: this.lastError,
      tracks: this.tracks,
    };
  }

  subscribe(listener: (snap: MusicPlaybackSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) {
      fn(snap);
    }
  }

  private persistPreferences(): void {
    this.onPreferenceChange?.({
      musicTrackId: this.currentTrackId,
      musicShuffle: this.shuffle,
      musicRepeatMode: this.repeatMode,
      musicEnabled: this.userEnabled,
    });
  }

  private computeLivePositionSec(durationSec: number): number {
    if (this.activePlayback && this.ctx && this.isPlaying && !this.isPausedByLifecycle) {
      const elapsed = Math.max(0, this.ctx.currentTime - this.activePlayback.startedAtCtxSec);
      const pos = this.activePlayback.startOffsetSec + elapsed;
      if (durationSec > 0) {
        return Math.min(durationSec, Math.max(0, pos));
      }
      return pos;
    }
    return Math.min(Math.max(0, durationSec), Math.max(0, this.currentTimeSec));
  }

  private teardownActiveSource(): void {
    if (!this.activePlayback) return;
    const pb = this.activePlayback;
    this.activePlayback = null;
    pb.stop();
  }

  async play(opts?: { resetToStart?: boolean; fromUser?: boolean }): Promise<boolean> {
    if (opts?.fromUser) {
      this.userEnabled = true;
      this.isPausedByLifecycle = false;
      this.resumeAfterLifecycle = false;
      this.persistPreferences();
    }
    if (opts?.resetToStart) {
      this.currentTimeSec = 0;
    }
    if (!this.userEnabled && !opts?.fromUser) {
      return false;
    }

    const epoch = ++this.playbackEpoch;
    this.teardownActiveSource();
    this.isPlaying = true;
    this.isPausedByLifecycle = false;

    const track = this.getCurrentTrack();
    if (!this.ctx || !this.duckGainNode) {
      // Headless / pre-unlock state: remember playing intent and advance deterministically in tick()
      this.emit();
      return true;
    }

    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // Browser autoplay policy may hold context suspended until user gesture
      }
    }
    if (epoch !== this.playbackEpoch) return false;

    const buffer = await this.loadBufferForTrack(track);
    if (epoch !== this.playbackEpoch) return false;

    if (!buffer) {
      this.errorTrackIds.add(track.id);
      this.lastError = `Track unavailable: ${track.title}`;
      const fallback = this.findNextPlayableTrackId(track.id);
      if (fallback && fallback !== track.id) {
        this.currentTrackId = fallback;
        this.currentTimeSec = 0;
        this.persistPreferences();
        this.emit();
        return this.play({ resetToStart: true });
      }
      this.isPlaying = false;
      this.emit();
      return false;
    }

    this.errorTrackIds.delete(track.id);
    this.lastError = null;
    this.startBufferSource(buffer, epoch);
    this.emit();
    return true;
  }

  private async loadBufferForTrack(track: MusicTrackMetadata): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.bufferLruCache.get(track.id);
    if (cached) {
      // Refresh LRU recency so recon <-> combat mood switches are 0ms
      this.bufferLruCache.delete(track.id);
      this.bufferLruCache.set(track.id, cached);
      this.activeBufferTrackId = track.id;
      this.activeBuffer = cached;
      return cached;
    }

    this.isLoading = true;
    this.emit();
    try {
      let buf: AudioBuffer;
      if (this.customLoader) {
        buf = await this.customLoader.loadTrack(track, this.ctx);
      } else if (track.sourceType === 'url' && track.url) {
        const res = await fetch(track.url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const raw = await res.arrayBuffer();
        buf = await this.ctx.decodeAudioData(raw);
      } else {
        buf = await this.synthWorker.synthesizeTrackBuffer(this.ctx, track);
      }
      // Bounded 2-track LRU memory (~5.6 MB max): keeps active + prior mood track warm for instant switches
      this.bufferLruCache.delete(track.id);
      this.bufferLruCache.set(track.id, buf);
      while (this.bufferLruCache.size > this.maxCachedTracks) {
        const oldestKey = this.bufferLruCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.bufferLruCache.delete(oldestKey);
        } else {
          break;
        }
      }
      this.activeBufferTrackId = track.id;
      this.activeBuffer = buf;
      return buf;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Failed to load audio track';
      return null;
    } finally {
      this.isLoading = false;
    }
  }

  private startBufferSource(buffer: AudioBuffer, epoch: number): void {
    if (!this.ctx || !this.duckGainNode) return;
    this.teardownActiveSource();

    const duration = Math.max(0.1, buffer.duration);
    const offset = Math.min(Math.max(0, this.currentTimeSec), Math.max(0, duration - 0.05));

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = false;

    const trackGain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    // Smooth 180ms fade-in prevents clicks on seek/track-switch/resume
    if (typeof trackGain.gain.setValueAtTime === 'function' && typeof trackGain.gain.linearRampToValueAtTime === 'function') {
      trackGain.gain.setValueAtTime(0.001, now);
      trackGain.gain.linearRampToValueAtTime(1.0, now + 0.18);
    } else {
      trackGain.gain.value = 1.0;
    }

    src.connect(trackGain);
    trackGain.connect(this.duckGainNode);

    let stopped = false;
    const stopFn = () => {
      if (stopped) return;
      stopped = true;
      src.onended = null;
      try {
        src.stop();
      } catch {
        // already stopped
      }
      try {
        src.disconnect();
        trackGain.disconnect();
      } catch {
        // already disconnected
      }
    };

    const playback: ActiveTrackPlayback = {
      source: src,
      trackGain,
      startedAtCtxSec: now,
      startOffsetSec: offset,
      epoch,
      stop: stopFn,
    };
    this.activePlayback = playback;

    src.onended = () => {
      if (stopped || epoch !== this.playbackEpoch || this.activePlayback !== playback) return;
      this.activePlayback = null;
      this.handleTrackEnded();
    };

    try {
      src.start(0, offset);
    } catch {
      stopFn();
      this.activePlayback = null;
    }
  }

  private handleTrackEnded(): void {
    const duration = this.activeBuffer?.duration ?? this.getCurrentTrack().durationSec;
    this.currentTimeSec = duration;

    if (this.repeatMode === 'one') {
      this.currentTimeSec = 0;
      void this.play({ resetToStart: true });
      return;
    }

    const nextId = this.pickNextTrackId(1);
    if (!nextId) {
      this.isPlaying = false;
      this.currentTimeSec = 0;
      this.emit();
      return;
    }

    this.currentTrackId = nextId;
    this.currentTimeSec = 0;
    this.persistPreferences();
    void this.play({ resetToStart: true });
  }

  pause(opts?: { fromUser?: boolean }): void {
    const duration = this.activeBuffer?.duration ?? this.getCurrentTrack().durationSec;
    this.currentTimeSec = this.computeLivePositionSec(duration);
    this.playbackEpoch++;
    this.teardownActiveSource();
    this.isPlaying = false;
    if (opts?.fromUser) {
      this.userEnabled = false;
      this.isPausedByLifecycle = false;
      this.resumeAfterLifecycle = false;
      this.persistPreferences();
    }
    this.emit();
  }

  stop(): void {
    this.playbackEpoch++;
    this.teardownActiveSource();
    this.isPlaying = false;
    this.isPausedByLifecycle = false;
    this.resumeAfterLifecycle = false;
    this.currentTimeSec = 0;
    this.emit();
  }

  async togglePlay(): Promise<boolean> {
    if (this.isPlaying && !this.isPausedByLifecycle) {
      this.pause({ fromUser: true });
      return false;
    }
    return this.play({ fromUser: true });
  }

  async selectTrack(
    trackId: string,
    opts?: { autoPlay?: boolean; fromUser?: boolean }
  ): Promise<boolean> {
    const target = this.tracks.find((t) => t.id === trackId) ?? getMusicTrackById(trackId);
    if (!target) return false;
    const wasPlaying = this.isPlaying && !this.isPausedByLifecycle;
    this.playbackEpoch++;
    this.teardownActiveSource();
    this.currentTrackId = target.id;
    this.currentTimeSec = 0;
    if (opts?.fromUser) {
      this.userEnabled = true;
      this.userTrackLocked = true;
    }
    this.persistPreferences();
    this.emit();

    if (opts?.autoPlay ?? wasPlaying) {
      return this.play({ resetToStart: true, fromUser: opts?.fromUser });
    }
    return true;
  }

  async next(fromUser = true): Promise<boolean> {
    const nextId = this.pickNextTrackId(1, true);
    if (!nextId) return false;
    return this.selectTrack(nextId, { autoPlay: this.isPlaying || fromUser, fromUser });
  }

  async previous(fromUser = true): Promise<boolean> {
    const duration = this.activeBuffer?.duration ?? this.getCurrentTrack().durationSec;
    const pos = this.computeLivePositionSec(duration);
    // Standard music player behavior: if > 3s into track, restart track; else jump to previous
    if (pos > 3.0) {
      return this.seek(0);
    }
    const prevId = this.pickNextTrackId(-1, true);
    if (!prevId) return false;
    return this.selectTrack(prevId, { autoPlay: this.isPlaying || fromUser, fromUser });
  }

  async seek(targetSec: number): Promise<boolean> {
    const track = this.getCurrentTrack();
    const duration = this.activeBuffer?.duration ?? track.durationSec;
    const safeDuration = Math.max(0.1, duration);
    const clamped = Math.min(Math.max(0, targetSec), Math.max(0, safeDuration - 0.05));
    this.currentTimeSec = clamped;

    if (this.isPlaying && !this.isPausedByLifecycle) {
      if (this.ctx && this.duckGainNode) {
        const epoch = ++this.playbackEpoch;
        const buf = await this.loadBufferForTrack(track);
        if (epoch !== this.playbackEpoch) return false;
        if (buf) {
          this.startBufferSource(buf, epoch);
        }
      }
    }
    this.emit();
    return true;
  }

  setShuffle(enabled: boolean): void {
    this.shuffle = Boolean(enabled);
    this.persistPreferences();
    this.emit();
  }

  setRepeatMode(mode: MusicRepeatMode): void {
    this.repeatMode = mode;
    this.persistPreferences();
    this.emit();
  }

  setAdaptiveEnabled(enabled: boolean): void {
    this.adaptiveEnabled = Boolean(enabled);
    if (this.adaptiveEnabled) {
      this.userTrackLocked = false;
      this.adaptiveCooldownSec = 0;
    }
    this.emit();
  }

  /**
   * Adapts score mood smoothly to gameplay intensity (deployment -> recon -> combat -> climax).
   * Strictly yields if adaptive scoring is off, music is paused/disabled by the user,
   * or the player manually picked a specific track in Settings -> Audio.
   */
  async applyAdaptiveMood(mood: MusicMood, forceImmediate = false): Promise<boolean> {
    if (!this.adaptiveEnabled || this.userTrackLocked || !this.userEnabled) {
      return false;
    }
    if (!this.isPlaying || this.isPausedByLifecycle) {
      return false;
    }
    if (!forceImmediate && this.adaptiveCooldownSec > 0) {
      return false;
    }
    const targetTrack = getDefaultTrackForMood(mood);
    if (!targetTrack || targetTrack.id === this.currentTrackId) {
      return false;
    }
    if (!this.tracks.some((t) => t.id === targetTrack.id) || this.errorTrackIds.has(targetTrack.id)) {
      return false;
    }
    this.adaptiveCooldownSec = 14.0;
    await this.selectTrack(targetTrack.id, { autoPlay: true, fromUser: false });
    return true;
  }

  syncPreferences(prefs: {
    musicEnabled?: boolean;
    musicTrackId?: string;
    musicShuffle?: boolean;
    musicRepeatMode?: MusicRepeatMode;
  }): void {
    if (typeof prefs.musicEnabled === 'boolean') {
      this.userEnabled = prefs.musicEnabled;
    }
    if (typeof prefs.musicShuffle === 'boolean') {
      this.shuffle = prefs.musicShuffle;
    }
    if (prefs.musicRepeatMode) {
      this.repeatMode = prefs.musicRepeatMode;
    }
    if (prefs.musicTrackId && this.tracks.some((t) => t.id === prefs.musicTrackId)) {
      if (this.currentTrackId !== prefs.musicTrackId) {
        this.currentTrackId = prefs.musicTrackId;
        this.currentTimeSec = 0;
      }
    }
    this.emit();
  }

  /**
   * Starts or transitions score for a mission without duplicating any active source.
   * Respects user-selected track unless `preferMoodTrack` is requested and user hasn't locked a track.
   */
  async startForMission(mood?: MusicMood, preferMoodTrack = false): Promise<boolean> {
    this.playbackEpoch++;
    this.teardownActiveSource();
    this.isPausedByLifecycle = false;
    this.resumeAfterLifecycle = false;

    if (preferMoodTrack && mood) {
      const rec = getDefaultTrackForMood(mood);
      if (this.tracks.some((t) => t.id === rec.id)) {
        this.currentTrackId = rec.id;
        this.currentTimeSec = 0;
      }
    }
    if (!this.userEnabled) {
      this.isPlaying = false;
      this.emit();
      return false;
    }
    return this.play({ resetToStart: false });
  }

  /**
   * Lifecycle pause (browser tab hidden, pause menu, mission transition).
   * Preserves exact playback cursor so resume continues seamlessly without duplication.
   */
  suspendForLifecycle(): void {
    if (this.isPausedByLifecycle) return;
    const duration = this.activeBuffer?.duration ?? this.getCurrentTrack().durationSec;
    this.currentTimeSec = this.computeLivePositionSec(duration);
    this.resumeAfterLifecycle = this.isPlaying;
    this.isPausedByLifecycle = true;
    this.playbackEpoch++;
    this.teardownActiveSource();
    this.emit();
  }

  async resumeFromLifecycle(): Promise<void> {
    if (!this.isPausedByLifecycle) return;
    this.isPausedByLifecycle = false;
    const shouldResume = this.resumeAfterLifecycle && this.userEnabled;
    this.resumeAfterLifecycle = false;
    if (shouldResume) {
      await this.play({ resetToStart: false });
    } else {
      this.emit();
    }
  }

  /**
   * Temporarily ducks background music during important tactical radio dialogue,
   * mission announcements, or critical cues. Deterministically restores duckLevel to 1.0.
   */
  duckForDialogue(durationSec: number, targetLevel = 0.32): void {
    const clampedDur = Math.max(0.2, Math.min(12, durationSec));
    const clampedLvl = Math.max(0.12, Math.min(0.95, targetLevel));
    this.duckRemainingSec = Math.max(this.duckRemainingSec, clampedDur);
    this.targetDuckLevel = Math.min(this.targetDuckLevel, clampedLvl);
    this.applyDuckImmediateStep(0.05);
  }

  /**
   * Advances deterministic ducking recovery and headless playback cursor.
   * Called from AudioManager / GameEngine tick.
   */
  tick(dt: number): void {
    const safeDt = Math.max(0, Math.min(0.25, dt));
    if (this.adaptiveCooldownSec > 0) {
      this.adaptiveCooldownSec = Math.max(0, this.adaptiveCooldownSec - safeDt);
    }
    if (this.duckRemainingSec > 0) {
      this.duckRemainingSec = Math.max(0, this.duckRemainingSec - safeDt);
      if (this.duckRemainingSec <= 0) {
        this.targetDuckLevel = 1.0;
      }
    } else {
      this.targetDuckLevel = 1.0;
    }

    this.applyDuckImmediateStep(safeDt);

    // Advance playback clock cleanly when running headless (no AudioContext)
    if (this.isPlaying && !this.isPausedByLifecycle && !this.activePlayback) {
      const duration = this.activeBuffer?.duration ?? this.getCurrentTrack().durationSec;
      this.currentTimeSec += safeDt;
      if (this.currentTimeSec >= duration) {
        this.handleTrackEnded();
      }
    }
  }

  private applyDuckImmediateStep(dt: number): void {
    const rate = this.targetDuckLevel < this.duckLevel ? 9.5 : 3.2;
    const blend = Math.min(1, dt * rate);
    this.duckLevel += (this.targetDuckLevel - this.duckLevel) * blend;
    if (Math.abs(this.duckLevel - this.targetDuckLevel) < 0.002) {
      this.duckLevel = this.targetDuckLevel;
    }
    if (this.duckGainNode && this.ctx) {
      const now = this.ctx.currentTime;
      if (typeof this.duckGainNode.gain.setTargetAtTime === 'function') {
        this.duckGainNode.gain.setTargetAtTime(this.duckLevel, now, 0.04);
      } else {
        this.duckGainNode.gain.value = this.duckLevel;
      }
    }
  }

  private findNextPlayableTrackId(fromId: string): string | null {
    const idx = this.tracks.findIndex((t) => t.id === fromId);
    for (let step = 1; step <= this.tracks.length; step++) {
      const cand = this.tracks[(idx + step) % this.tracks.length];
      if (!this.errorTrackIds.has(cand.id)) {
        return cand.id;
      }
    }
    return null;
  }

  private pickNextTrackId(direction: 1 | -1, manualSkip = false): string | null {
    if (this.tracks.length === 0) return null;
    const idx = Math.max(
      0,
      this.tracks.findIndex((t) => t.id === this.currentTrackId)
    );

    if (this.shuffle && this.tracks.length > 1) {
      const candidates = this.tracks.filter(
        (t) => t.id !== this.currentTrackId && !this.errorTrackIds.has(t.id)
      );
      if (candidates.length > 0) {
        // Deterministic-friendly pseudo-random index spread
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        return pick.id;
      }
    }

    const rawNext = idx + direction;
    if (!manualSkip && this.repeatMode === 'off' && (rawNext < 0 || rawNext >= this.tracks.length)) {
      return null;
    }
    const wrapped = (rawNext + this.tracks.length) % this.tracks.length;
    return this.tracks[wrapped].id;
  }

  dispose(): void {
    this.playbackEpoch++;
    this.teardownActiveSource();
    this.synthWorker.dispose();
    try {
      this.duckGainNode?.disconnect();
    } catch {
      // ignore
    }
    this.duckGainNode = null;
    this.outputNode = null;
    this.ctx = null;
    this.activeBuffer = null;
    this.activeBufferTrackId = null;
    this.bufferLruCache.clear();
    this.listeners.clear();
  }
}
