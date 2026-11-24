import { ResourceManager } from '@/src/core/ResourceManager';
import { AudioSettings, AudioSettingsSchema } from '@/src/schemas/settings.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { MusicMood } from './MusicCatalog';
import { MusicPlayerController } from './MusicPlayerController';
import {
  buildImpulseResponseBuffer,
  ORDNANCE_SOUNDS,
  RELOAD_FOLEY_SOUNDS,
  SoundId,
  synthesizeLayeredSound,
  WEAPON_SHOT_SOUNDS,
} from './SfxSynthesizer';

export type { SoundId } from './SfxSynthesizer';

export type ReloadStageId = 'MAG_OUT' | 'MAG_IN' | 'CHAMBER';

export type VoiceCategory =
  | 'weapon_player'
  | 'reload_foley'
  | 'combat_spatial'
  | 'ordnance'
  | 'movement'
  | 'ui_hud';

export interface ActiveVoice {
  readonly id: string;
  readonly soundId: SoundId;
  readonly category: VoiceCategory;
  readonly priority: number;
  readonly startedAt: number;
  readonly seq: number;
  readonly stop: () => void;
}

function classifySoundCategory(id: SoundId, spatial: boolean): VoiceCategory {
  if (RELOAD_FOLEY_SOUNDS.has(id)) return 'reload_foley';
  if (ORDNANCE_SOUNDS.has(id)) return 'ordnance';
  if (WEAPON_SHOT_SOUNDS.has(id)) return spatial ? 'combat_spatial' : 'weapon_player';
  if (id === 'footstep' || id === 'jump' || id === 'engine') return 'movement';
  return spatial ? 'combat_spatial' : 'ui_hud';
}

function getCategoryConcurrencyLimit(category: VoiceCategory): number {
  switch (category) {
    case 'combat_spatial':
      return 8;
    case 'movement':
      return 4;
    case 'reload_foley':
      return 2;
    case 'ui_hud':
      return 6;
    case 'weapon_player':
      return 10;
    case 'ordnance':
      return 10;
  }
}

const CORE_PREWARM_SOUND_IDS: readonly SoundId[] = [
  'shot_rifle',
  'shot_pistol',
  'shot_smg',
  'shot_lmg',
  'shot_shotgun',
  'shot_sniper',
  'shot_grenade_launcher',
  'shot_rocket',
  'shot_missile',
  'shot_suppressed',
  'hit_marker',
  'headshot',
  'armor_hit',
  'armor_break',
  'kill_confirm',
  'bullet_crack',
  'enemy_bark_flank',
  'enemy_bark_frag',
  'empty_click',
  'mag_out',
  'mag_in',
  'chamber',
  'bolt_cycle',
  'pump_cycle',
  'drum_index',
  'reload',
  'footstep',
  'jump',
  'hurt',
  'explosion',
  'explosion_heavy',
  'c4_place',
  'c4_plant',
  'c4_beep',
  'bomb_whistle',
  'bomb_drop',
  'lock_beep',
  'lock_ready',
  'enemy_callout',
  'objective_complete',
  'pickup_health',
  'squad_order_confirm',
  'operator_downed_alarm',
  'ui_click',
  'engine',
  'nuke_alarm',
  'nuke_siren',
  'explosion_nuke',
  'nuke_detonation',
];

/**
 * TRN-08: Hybrid Layered Tactical Audio Pipeline.
 * - 4-layer stereo weapon & ordnance synthesis (Mechanical transient, Mid body, Sub-bass punch, Stereo tail)
 * - Stage-synchronized reload Foley (mag_out, mag_in, chamber, bolt_cycle, pump_cycle, drum_index) with instant cancellation
 * - Shared ConvolverNode impulse-response reverb bus
 * - 32-voice deterministic priority pool with category caps and distance attenuation
 */
export class AudioManager {
  private static activeInstance: AudioManager | null = null;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private dialogueGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbReturnGain: GainNode | null = null;
  private buffers = new Map<SoundId, AudioBuffer>();
  private voices: ActiveVoice[] = [];
  private readonly maxVoices = 32;
  private voiceSeq = 0;
  private unlocked = false;
  private suspendedByLifecycle = false;
  private settings: AudioSettings;
  private listenerPos = { x: 0, y: 1.7, z: 0 };
  private readonly musicController: MusicPlayerController;

  private activeLoopNodes: Array<{ stop: () => void }> = [];
  private radioVoiceCueCount = 0;
  private prewarmQueue: SoundId[] = [];
  private prewarmTimerId: number | null = null;
  private spatialOcclusionProbe:
    | ((lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => boolean)
    | null = null;
  private occlusionBudgetWindowStartMs = 0;
  private occlusionChecksInWindow = 0;
  private lastOccludedSpatialCount = 0;

  constructor(
    private readonly resourceManager: ResourceManager,
    initialSettings: Partial<AudioSettings>,
    onMusicPreferenceChange?: (prefs: {
      musicTrackId: string;
      musicShuffle: boolean;
      musicRepeatMode: 'all' | 'one' | 'off';
      musicEnabled: boolean;
    }) => void
  ) {
    const parsed = AudioSettingsSchema.parse(initialSettings);
    this.settings = parsed;
    this.musicController = new MusicPlayerController({
      initialTrackId: parsed.musicTrackId,
      initialShuffle: parsed.musicShuffle,
      initialRepeatMode: parsed.musicRepeatMode,
      onPreferenceChange: onMusicPreferenceChange,
    });
    this.musicController.syncPreferences({
      musicEnabled: parsed.musicEnabled,
      musicTrackId: parsed.musicTrackId,
      musicShuffle: parsed.musicShuffle,
      musicRepeatMode: parsed.musicRepeatMode,
    });
    AudioManager.activeInstance = this;
  }

  public static getActiveInstance(): AudioManager | null {
    return AudioManager.activeInstance;
  }

  public getMusicController(): MusicPlayerController {
    return this.musicController;
  }

  public unlock(): void {
    if (this.unlocked) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const globalAudio = globalThis as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const AudioCtx = globalAudio.AudioContext || globalAudio.webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.dialogueGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.ambienceGain = this.ctx.createGain();

      this.sfxGain.connect(this.masterGain);
      this.dialogueGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.ambienceGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.musicController.attachAudioContext(this.ctx, this.musicGain);
      this.setupSharedReverbBus();
      this.applySettings(this.settings);
      this.unlocked = true;
      this.schedulePrewarm();
    } catch {
      // Headless / blocked audio gracefully falls back to silent no-op
    }
  }

  private setupSharedReverbBus(): void {
    if (!this.ctx || !this.sfxGain) return;
    try {
      const convolver = this.ctx.createConvolver();
      const returnGain = this.ctx.createGain();
      returnGain.gain.value = 0.22;
      convolver.buffer = buildImpulseResponseBuffer(this.ctx, 1.15);
      convolver.connect(returnGain);
      returnGain.connect(this.sfxGain);
      this.reverbNode = convolver;
      this.reverbReturnGain = returnGain;
    } catch {
      this.reverbNode = null;
      this.reverbReturnGain = null;
    }
  }

  public applySettings(settings: Partial<AudioSettings>): void {
    const parsed = AudioSettingsSchema.parse({ ...this.settings, ...settings });
    this.settings = parsed;
    this.musicController.syncPreferences({
      musicEnabled: parsed.musicEnabled,
      musicTrackId: parsed.musicTrackId,
      musicShuffle: parsed.musicShuffle,
      musicRepeatMode: parsed.musicRepeatMode,
    });
    if (!this.ctx || !this.masterGain || !this.sfxGain || !this.musicGain || !this.ambienceGain) {
      return;
    }

    const now = this.ctx.currentTime;
    const master = this.suspendedByLifecycle || parsed.muted ? 0 : parsed.masterVolume;
    // Scale music bus slightly (0.58 headroom factor) so even high slider positions never drown out gunfire or callouts
    const effectiveMusic = parsed.musicEnabled ? parsed.musicVolume * 0.58 : 0;
    this.masterGain.gain.setTargetAtTime(master, now, 0.03);
    this.sfxGain.gain.setTargetAtTime(parsed.sfxVolume, now, 0.02);
    if (this.dialogueGain) {
      this.dialogueGain.gain.setTargetAtTime(parsed.dialogueVolume ?? 0.9, now, 0.02);
    }
    this.musicGain.gain.setTargetAtTime(effectiveMusic, now, 0.04);
    this.ambienceGain.gain.setTargetAtTime(parsed.ambienceVolume, now, 0.03);
  }

  public duckMusicForDialogue(durationSec = 2.6, duckLevel = 0.32): void {
    this.musicController.duckForDialogue(durationSec, duckLevel);
  }

  public applyAdaptiveMusicMood(mood: MusicMood, forceImmediate = false): Promise<boolean> {
    if (!this.settings.musicEnabled) return Promise.resolve(false);
    return this.musicController.applyAdaptiveMood(mood, forceImmediate);
  }

  public tick(dt: number): void {
    this.musicController.tick(dt);
  }

  public isSuspendedByLifecycle(): boolean {
    return this.suspendedByLifecycle;
  }

  public getMaxVoiceCapacity(): number {
    return this.maxVoices;
  }

  public getActiveVoiceCount(): number {
    return this.voices.length;
  }

  public getActiveVoicesSnapshot(): readonly ActiveVoice[] {
    return this.voices;
  }

  public hasSharedReverbBus(): boolean {
    return this.reverbNode !== null && this.reverbReturnGain !== null;
  }

  public getRadioVoiceCueCount(): number {
    return this.radioVoiceCueCount;
  }

  public setSpatialOcclusionProbe(
    probe:
      | ((lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => boolean)
      | null
  ): void {
    this.spatialOcclusionProbe = probe;
  }

  public getOccludedSpatialCount(): number {
    return this.lastOccludedSpatialCount;
  }

  /**
   * TRN-46 / TRN-47 Procedural Tactical Radio Voice Signature.
   * Synthesizes a clean, non-fatiguing radio squelch + operator-distinct vocal cadence
   * strictly routed through dialogueGain (honoring dialogueVolume & mute) and gently
   * ducking background music on CRITICAL alerts without touching manual track selection.
   */
  public playOperatorRadioVoice(
    voiceProfile: {
      basePitchHz: number;
      formantPitchHz: number;
      cadenceMs: number;
      radioClickHz: number;
    },
    priority: 'CRITICAL' | 'TACTICAL' | 'BANTER' = 'TACTICAL'
  ): void {
    this.radioVoiceCueCount++;
    if (priority === 'CRITICAL') {
      this.duckMusicForDialogue(2.6, 0.34);
    } else if (priority === 'TACTICAL') {
      this.duckMusicForDialogue(1.8, 0.52);
    }

    if (!this.ctx || !this.dialogueGain || this.settings.muted) {
      return;
    }

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const bandpass = this.ctx.createBiquadFilter();
      const env = this.ctx.createGain();

      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(Math.max(400, Math.min(2600, voiceProfile.formantPitchHz)), now);
      bandpass.Q.setValueAtTime(2.6, now);

      const durSec = Math.max(0.14, Math.min(0.32, (voiceProfile.cadenceMs / 1000) * 1.4));
      const gainPeak = priority === 'CRITICAL' ? 0.24 : priority === 'TACTICAL' ? 0.17 : 0.12;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(voiceProfile.radioClickHz, now);
      osc.frequency.setValueAtTime(voiceProfile.basePitchHz, now + 0.025);
      osc.frequency.linearRampToValueAtTime(voiceProfile.basePitchHz * 1.12, now + durSec * 0.55);
      osc.frequency.linearRampToValueAtTime(voiceProfile.basePitchHz * 0.94, now + durSec - 0.02);
      osc.frequency.setValueAtTime(voiceProfile.radioClickHz * 0.85, now + durSec - 0.015);

      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(gainPeak, now + 0.018);
      env.gain.setValueAtTime(gainPeak * 0.78, now + durSec * 0.65);
      env.gain.exponentialRampToValueAtTime(0.0001, now + durSec);

      osc.connect(bandpass);
      bandpass.connect(env);
      env.connect(this.dialogueGain);

      osc.start(now);
      osc.stop(now + durSec + 0.02);
      osc.onended = () => {
        try {
          osc.disconnect();
          bandpass.disconnect();
          env.disconnect();
        } catch {
          // already disconnected
        }
      };
    } catch {
      // ignore audio graph errors on suspended/headless contexts
    }
  }

  public updateListener(
    posX: number,
    posY: number,
    posZ: number,
    fwdX: number,
    fwdY: number,
    fwdZ: number
  ): void {
    this.listenerPos.x = posX;
    this.listenerPos.y = posY;
    this.listenerPos.z = posZ;
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = posX;
      l.positionY.value = posY;
      l.positionZ.value = posZ;
      l.forwardX.value = fwdX;
      l.forwardY.value = fwdY;
      l.forwardZ.value = fwdZ;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else if (typeof l.setPosition === 'function') {
      l.setPosition(posX, posY, posZ);
      l.setOrientation(fwdX, fwdY, fwdZ, 0, 1, 0);
    }
  }

  public async loadExternalSoundBuffer(id: SoundId, url: string): Promise<boolean> {
    if (!this.ctx) return false;
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const arr = await res.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(arr);
      this.buffers.set(id, decoded);
      return true;
    } catch {
      return false;
    }
  }

  public hasCachedBuffer(id: SoundId): boolean {
    return this.buffers.has(id);
  }

  public getCachedBufferCount(): number {
    return this.buffers.size;
  }

  public schedulePrewarm(prioritySounds: readonly SoundId[] = CORE_PREWARM_SOUND_IDS): void {
    if (!this.ctx) return;
    const queued = new Set(this.prewarmQueue);
    for (let i = 0; i < prioritySounds.length; i++) {
      const sid = prioritySounds[i];
      if (!this.buffers.has(sid) && !queued.has(sid)) {
        this.prewarmQueue.push(sid);
        queued.add(sid);
      }
    }
    if (this.prewarmQueue.length === 0 || this.prewarmTimerId !== null) return;
    if (typeof window === 'undefined') {
      this.pumpPrewarmSlice(4.0);
      return;
    }
    this.prewarmTimerId = window.setTimeout(this.runPrewarmSlice, 16);
  }

  public prewarmBuffersSync(ids: readonly SoundId[] = CORE_PREWARM_SOUND_IDS): number {
    if (!this.ctx) return 0;
    let built = 0;
    for (let i = 0; i < ids.length; i++) {
      const sid = ids[i];
      if (!this.buffers.has(sid)) {
        this.getOrCreateBuffer(sid);
        built++;
      }
    }
    return built;
  }

  private cancelScheduledPrewarm(): void {
    if (this.prewarmTimerId !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.prewarmTimerId);
    }
    this.prewarmTimerId = null;
    this.prewarmQueue.length = 0;
  }

  private readonly runPrewarmSlice = (): void => {
    this.prewarmTimerId = null;
    if (!this.ctx || this.prewarmQueue.length === 0) return;
    this.pumpPrewarmSlice(3.5);
    if (this.prewarmQueue.length > 0 && typeof window !== 'undefined') {
      this.prewarmTimerId = window.setTimeout(this.runPrewarmSlice, 16);
    }
  };

  private pumpPrewarmSlice(budgetMs: number): void {
    if (!this.ctx) {
      this.prewarmQueue.length = 0;
      return;
    }
    const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    while (this.prewarmQueue.length > 0) {
      const sid = this.prewarmQueue.shift()!;
      if (!this.buffers.has(sid)) {
        this.getOrCreateBuffer(sid);
      }
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startMs;
      if (elapsed >= budgetMs) break;
    }
  }

  private getOrCreateBuffer(id: SoundId): AudioBuffer | null {
    if (!this.ctx) return null;
    const existing = this.buffers.get(id);
    if (existing) return existing;

    const created = synthesizeLayeredSound(this.ctx, id);
    this.buffers.set(id, created);
    return created;
  }

  /**
   * Deterministic priority & category-cap admission control for the 32-voice pool.
   */
  private ensureVoiceSlot(category: VoiceCategory, priority: number): boolean {
    // 1. Enforce per-category concurrency cap first
    const catCap = getCategoryConcurrencyLimit(category);
    let catCount = 0;
    let weakestCatIdx = -1;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.category === category) {
        catCount++;
        if (
          weakestCatIdx === -1 ||
          v.priority < this.voices[weakestCatIdx].priority ||
          (v.priority === this.voices[weakestCatIdx].priority &&
            v.seq < this.voices[weakestCatIdx].seq)
        ) {
          weakestCatIdx = i;
        }
      }
    }
    if (catCount >= catCap && weakestCatIdx !== -1) {
      const weakestCat = this.voices[weakestCatIdx];
      if (priority < weakestCat.priority) {
        return false;
      }
      weakestCat.stop();
      this.voices.splice(weakestCatIdx, 1);
    }

    // 2. Enforce global 32-voice pool cap with deterministic tie-breaking (lowest priority, then oldest seq)
    if (this.voices.length >= this.maxVoices) {
      let evictIdx = 0;
      for (let i = 1; i < this.voices.length; i++) {
        const cur = this.voices[i];
        const best = this.voices[evictIdx];
        if (
          cur.priority < best.priority ||
          (cur.priority === best.priority && cur.seq < best.seq)
        ) {
          evictIdx = i;
        }
      }
      const candidate = this.voices[evictIdx];
      if (priority < candidate.priority) {
        return false;
      }
      candidate.stop();
      this.voices.splice(evictIdx, 1);
    }

    return true;
  }

  public cancelReloadFoley(): number {
    let cancelled = 0;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if (this.voices[i].category === 'reload_foley') {
        this.voices[i].stop();
        this.voices.splice(i, 1);
        cancelled++;
      }
    }
    return cancelled;
  }

  public playReloadStageFoley(weaponId: WeaponId, stage: ReloadStageId): void {
    if (stage === 'MAG_OUT') {
      if (weaponId === 'grenade_launcher') {
        this.play2D('drum_index', 5, 0.52);
      } else if (weaponId === 'shotgun') {
        this.play2D('pump_cycle', 5, 0.5);
      } else {
        this.play2D('mag_out', 5, 0.54);
      }
    } else if (stage === 'MAG_IN') {
      if (weaponId === 'grenade_launcher') {
        this.play2D('drum_index', 5, 0.56);
      } else {
        this.play2D('mag_in', 5, 0.58);
      }
    } else if (stage === 'CHAMBER') {
      if (weaponId === 'sniper_rifle') {
        this.play2D('bolt_cycle', 6, 0.62);
      } else if (weaponId === 'shotgun') {
        this.play2D('pump_cycle', 6, 0.62);
      } else {
        this.play2D('chamber', 6, 0.58);
      }
    }
  }

  private getReverbSendLevel(id: SoundId, spatial: boolean): number {
    if (WEAPON_SHOT_SOUNDS.has(id)) return spatial ? 0.28 : 0.18;
    if (ORDNANCE_SOUNDS.has(id)) return 0.34;
    if (RELOAD_FOLEY_SOUNDS.has(id)) return 0.06;
    return 0;
  }

  public play2D(id: SoundId, priority = 5, volume = 0.8, pitchJitter = 0.04): void {
    const category = classifySoundCategory(id, false);
    if (!this.ensureVoiceSlot(category, priority)) return;

    const seq = ++this.voiceSeq;
    const voiceId = `${id}_${seq}`;

    if (!this.ctx || !this.sfxGain || this.settings.muted) {
      // Track logical voice metadata in headless/uninitialized test environments when needed
      return;
    }
    const buf = this.getOrCreateBuffer(id);
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitchJitter;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this.sfxGain);

    let reverbSendGain: GainNode | null = null;
    const sendAmt = this.getReverbSendLevel(id, false);
    if (sendAmt > 0 && this.reverbNode) {
      reverbSendGain = this.ctx.createGain();
      reverbSendGain.gain.value = volume * sendAmt;
      src.connect(reverbSendGain);
      reverbSendGain.connect(this.reverbNode);
    }

    let cleaned = false;
    const disconnectNodes = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        src.disconnect();
      } catch {
        // already disconnected
      }
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
      if (reverbSendGain) {
        try {
          reverbSendGain.disconnect();
        } catch {
          // already disconnected
        }
      }
    };

    const voice: ActiveVoice = {
      id: voiceId,
      soundId: id,
      category,
      priority,
      startedAt: this.ctx.currentTime,
      seq,
      stop: () => {
        try {
          src.stop();
        } catch {
          // already stopped
        }
        disconnectNodes();
      },
    };

    this.voices.push(voice);
    src.onended = () => {
      const idx = this.voices.indexOf(voice);
      if (idx !== -1) this.voices.splice(idx, 1);
      disconnectNodes();
    };
    src.start(0);
  }

  public playSpatial(
    id: SoundId,
    x: number,
    y: number,
    z: number,
    priority = 5,
    volume = 0.85
  ): void {
    const dx = x - this.listenerPos.x;
    const dy = y - this.listenerPos.y;
    const dz = z - this.listenerPos.z;
    const dist = Math.hypot(dx, dy, dz);
    const maxDist = ORDNANCE_SOUNDS.has(id) ? 180 : 120;
    if (dist > maxDist) return;

    const category = classifySoundCategory(id, true);
    if (!this.ensureVoiceSlot(category, priority)) return;

    const seq = ++this.voiceSeq;
    const voiceId = `${id}_sp_${seq}`;

    if (!this.ctx || !this.sfxGain || this.settings.muted) {
      return;
    }

    const buf = this.getOrCreateBuffer(id);
    if (!buf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.96 + Math.random() * 0.08;

    const panner = this.ctx.createPanner();
    // Use full binaural HRTF for close tactical cues and lightweight equalpower stereo beyond 35m
    panner.panningModel = dist < 35 ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 5.0;
    panner.maxDistance = maxDist;
    panner.rolloffFactor = 1.25;
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;

    // Budgeted wall-occlusion low-pass muffling (max 4 occlusion probes per 50ms window so large waves never spike CPU)
    let isOccluded = false;
    if (
      this.spatialOcclusionProbe &&
      dist > 3.5 &&
      (WEAPON_SHOT_SOUNDS.has(id) || ORDNANCE_SOUNDS.has(id) || id === 'enemy_callout' || id === 'enemy_bark_flank' || id === 'enemy_bark_frag')
    ) {
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (nowMs - this.occlusionBudgetWindowStartMs >= 50) {
        this.occlusionBudgetWindowStartMs = nowMs;
        this.occlusionChecksInWindow = 0;
      }
      if (this.occlusionChecksInWindow < 4) {
        this.occlusionChecksInWindow++;
        isOccluded = this.spatialOcclusionProbe(
          this.listenerPos.x,
          this.listenerPos.y,
          this.listenerPos.z,
          x,
          y,
          z
        );
        if (isOccluded) {
          this.lastOccludedSpatialCount++;
        }
      }
    }

    // Distance-attenuated gain scaling so distant fire retains presence without overpowering player cues
    const distAtten = 1 / (1 + Math.max(0, dist - 5) * 0.035);
    const occlusionGainMul = isOccluded ? 0.62 : 1.0;
    const gain = this.ctx.createGain();
    gain.gain.value = volume * Math.max(0.12, Math.min(1, distAtten)) * occlusionGainMul;

    let occlusionFilter: BiquadFilterNode | null = null;
    if (isOccluded && typeof this.ctx.createBiquadFilter === 'function') {
      occlusionFilter = this.ctx.createBiquadFilter();
      occlusionFilter.type = 'lowpass';
      occlusionFilter.frequency.value = ORDNANCE_SOUNDS.has(id) ? 620 : 950;
      occlusionFilter.Q.value = 0.7;
      src.connect(occlusionFilter);
      occlusionFilter.connect(panner);
    } else {
      src.connect(panner);
    }
    panner.connect(gain);
    gain.connect(this.sfxGain);

    let reverbSendGain: GainNode | null = null;
    const sendAmt = this.getReverbSendLevel(id, true);
    if (sendAmt > 0 && this.reverbNode) {
      reverbSendGain = this.ctx.createGain();
      // Slightly higher wet/dry reflection ratio at medium-to-long distance
      const distWetBoost = Math.min(1.6, 1 + dist / 65);
      reverbSendGain.gain.value =
        volume * sendAmt * distWetBoost * Math.max(0.2, distAtten) * occlusionGainMul;
      panner.connect(reverbSendGain);
      reverbSendGain.connect(this.reverbNode);
    }

    let cleaned = false;
    const disconnectNodes = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        src.disconnect();
      } catch {
        // already disconnected
      }
      if (occlusionFilter) {
        try {
          occlusionFilter.disconnect();
        } catch {
          // already disconnected
        }
      }
      try {
        panner.disconnect();
      } catch {
        // already disconnected
      }
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
      if (reverbSendGain) {
        try {
          reverbSendGain.disconnect();
        } catch {
          // already disconnected
        }
      }
    };

    const voice: ActiveVoice = {
      id: voiceId,
      soundId: id,
      category,
      priority,
      startedAt: this.ctx.currentTime,
      seq,
      stop: () => {
        try {
          src.stop();
        } catch {
          // already stopped
        }
        disconnectNodes();
      },
    };

    this.voices.push(voice);
    src.onended = () => {
      const idx = this.voices.indexOf(voice);
      if (idx !== -1) this.voices.splice(idx, 1);
      disconnectNodes();
    };
    src.start(0);
  }

  public playWeaponSound(
    weaponId: WeaponId,
    spatialPos?: { x: number; y: number; z: number },
    suppressed = false
  ): void {
    const map: Record<WeaponId, SoundId> = {
      pistol: 'shot_pistol',
      smg: 'shot_smg',
      assault_rifle: 'shot_rifle',
      lmg: 'shot_lmg',
      shotgun: 'shot_shotgun',
      sniper_rifle: 'shot_sniper',
      grenade_launcher: 'shot_grenade_launcher',
      rocket_launcher: 'shot_rocket',
      guided_missile: 'shot_missile',
    };
    const sid: SoundId = suppressed && weaponId !== 'rocket_launcher' && weaponId !== 'guided_missile' && weaponId !== 'grenade_launcher'
      ? 'shot_suppressed'
      : map[weaponId];
    if (spatialPos) {
      this.playSpatial(sid, spatialPos.x, spatialPos.y, spatialPos.z, 6, suppressed ? 0.45 : 0.75);
    } else {
      this.play2D(sid, 9, suppressed ? 0.68 : 0.82);
    }
  }

  public startMissionAmbienceAndMusic(mood?: MusicMood): void {
    this.stopMissionLoops();
    this.schedulePrewarm();
    // Multi-track background music system (single-source guarantee, zero duplication on restart)
    if (this.settings.musicEnabled) {
      void this.musicController.startForMission(mood, false);
    }

    if (!this.ctx || !this.ambienceGain) return;

    // Subtle battlefield atmospheric wind/rumble bed on ambienceGain (completely independent of music tracks)
    const sr = Math.min(22050, this.ctx.sampleRate || 22050);
    const len = Math.floor(sr * 2.5);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    let seed = 0x243f6a88;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const white = (seed / 0xffffffff) * 2 - 1;
      lp += (white - lp) * 0.04;
      const t = i / sr;
      data[i] = (lp * 0.55 + Math.sin(2 * Math.PI * 48 * t) * 0.14) * 0.16;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 160;

    const subGain = this.ctx.createGain();
    subGain.gain.value = 0.22;

    src.connect(filter);
    filter.connect(subGain);
    subGain.connect(this.ambienceGain);

    src.start(0);

    let stopped = false;
    const stopFn = () => {
      if (stopped) return;
      stopped = true;
      try {
        src.stop();
        src.disconnect();
        filter.disconnect();
        subGain.disconnect();
      } catch {
        // ignore
      }
    };

    this.activeLoopNodes.push({ stop: stopFn });
    this.resourceManager.register('audioNode', 'mission:audio', stopFn, 'mission_ambience_bed');
  }

  public stopMissionLoops(): void {
    for (const n of this.activeLoopNodes) {
      n.stop();
    }
    this.activeLoopNodes = [];
    this.musicController.stop();
    this.resourceManager.unloadScope('mission:audio');
  }

  public suspend(): void {
    this.suspendedByLifecycle = true;
    this.musicController.suspendForLifecycle();
    this.applySettings(this.settings);
    if (this.ctx) {
      void this.ctx.suspend().catch(() => {});
    }
  }

  public resume(): void {
    this.suspendedByLifecycle = false;
    this.applySettings(this.settings);
    if (this.ctx) {
      void this.ctx.resume().catch(() => {});
    }
    void this.musicController.resumeFromLifecycle();
  }

  public dispose(): void {
    this.cancelScheduledPrewarm();
    this.stopMissionLoops();
    this.musicController.dispose();
    if (AudioManager.activeInstance === this) {
      AudioManager.activeInstance = null;
    }
    for (const v of this.voices) {
      v.stop();
    }
    this.voices = [];
    this.buffers.clear();
    try {
      this.reverbNode?.disconnect();
      this.reverbReturnGain?.disconnect();
      this.dialogueGain?.disconnect();
    } catch {
      // ignore
    }
    this.reverbNode = null;
    this.reverbReturnGain = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.dialogueGain = null;
    this.musicGain = null;
    this.ambienceGain = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.unlocked = false;
  }
}
