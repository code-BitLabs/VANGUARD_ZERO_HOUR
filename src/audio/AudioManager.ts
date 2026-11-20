import { ResourceManager } from '@/src/core/ResourceManager';
import { AudioSettings, AudioSettingsSchema } from '@/src/schemas/settings.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';
import { MusicMood } from './MusicCatalog';
import { MusicPlayerController } from './MusicPlayerController';

export type SoundId =
  | 'shot_pistol'
  | 'shot_smg'
  | 'shot_rifle'
  | 'shot_lmg'
  | 'shot_shotgun'
  | 'shot_sniper'
  | 'shot_grenade_launcher'
  | 'shot_rocket'
  | 'shot_missile'
  | 'explosion'
  | 'explosion_heavy'
  | 'explosion_nuke'
  | 'nuke_detonation'
  | 'bomb_drop'
  | 'bomb_whistle'
  | 'c4_plant'
  | 'c4_place'
  | 'c4_beep'
  | 'nuke_alarm'
  | 'nuke_siren'
  | 'enemy_callout'
  | 'hit_marker'
  | 'headshot'
  | 'reload'
  | 'mag_out'
  | 'mag_in'
  | 'chamber'
  | 'bolt_cycle'
  | 'pump_cycle'
  | 'drum_index'
  | 'empty_click'
  | 'footstep'
  | 'jump'
  | 'hurt'
  | 'ui_click'
  | 'objective_complete'
  | 'lock_beep'
  | 'lock_ready'
  | 'engine'
  | 'pickup_health'
  | 'squad_order_confirm'
  | 'operator_downed_alarm';

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

const RELOAD_FOLEY_SOUNDS: ReadonlySet<SoundId> = new Set<SoundId>([
  'reload',
  'mag_out',
  'mag_in',
  'chamber',
  'bolt_cycle',
  'pump_cycle',
  'drum_index',
]);

const WEAPON_SHOT_SOUNDS: ReadonlySet<SoundId> = new Set<SoundId>([
  'shot_pistol',
  'shot_smg',
  'shot_rifle',
  'shot_lmg',
  'shot_shotgun',
  'shot_sniper',
  'shot_grenade_launcher',
  'shot_rocket',
  'shot_missile',
]);

const ORDNANCE_SOUNDS: ReadonlySet<SoundId> = new Set<SoundId>([
  'explosion',
  'explosion_heavy',
  'explosion_nuke',
  'nuke_detonation',
  'bomb_drop',
  'bomb_whistle',
  'c4_plant',
  'c4_place',
  'c4_beep',
  'nuke_alarm',
  'nuke_siren',
]);

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
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
      convolver.buffer = this.buildImpulseResponseBuffer(this.ctx, 1.15);
      convolver.connect(returnGain);
      returnGain.connect(this.sfxGain);
      this.reverbNode = convolver;
      this.reverbReturnGain = returnGain;
    } catch {
      this.reverbNode = null;
      this.reverbReturnGain = null;
    }
  }

  private buildImpulseResponseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const ir = ctx.createBuffer(2, length, sampleRate);
    const left = ir.getChannelData(0);
    const right = ir.getChannelData(1);

    // Deterministic LCG for reproducible stereo canyon/urban early + late reflections
    let seed = 0x5f3759df;
    const nextRand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed / 4294967295) * 2 - 1;
    };

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 4.8) * (1 + 0.35 * Math.exp(-t * 24));
      // Early reflection taps at 14ms, 29ms, 47ms
      const earlyBoost =
        Math.abs(t - 0.014) < 0.0015 ||
        Math.abs(t - 0.029) < 0.0015 ||
        Math.abs(t - 0.047) < 0.0015
          ? 1.65
          : 1.0;
      left[i] = nextRand() * env * earlyBoost * 0.5;
      right[i] = nextRand() * env * earlyBoost * 0.5;
    }
    return ir;
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

  private getOrCreateBuffer(id: SoundId): AudioBuffer | null {
    if (!this.ctx) return null;
    const existing = this.buffers.get(id);
    if (existing) return existing;

    const created = this.synthesizeLayeredSound(id);
    this.buffers.set(id, created);
    return created;
  }

  private synthesizeLayeredSound(id: SoundId): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;

    const durations: Record<SoundId, number> = {
      shot_pistol: 0.28,
      shot_smg: 0.22,
      shot_rifle: 0.34,
      shot_lmg: 0.36,
      shot_shotgun: 0.52,
      shot_sniper: 0.78,
      shot_grenade_launcher: 0.48,
      shot_rocket: 0.68,
      shot_missile: 0.72,
      explosion: 1.25,
      explosion_heavy: 2.1,
      explosion_nuke: 4.0,
      nuke_detonation: 4.0,
      bomb_drop: 1.5,
      bomb_whistle: 1.5,
      c4_plant: 0.22,
      c4_place: 0.22,
      c4_beep: 0.12,
      nuke_alarm: 0.9,
      nuke_siren: 0.9,
      enemy_callout: 0.24,
      hit_marker: 0.08,
      headshot: 0.14,
      reload: 0.45,
      mag_out: 0.22,
      mag_in: 0.26,
      chamber: 0.24,
      bolt_cycle: 0.38,
      pump_cycle: 0.28,
      drum_index: 0.26,
      empty_click: 0.06,
      footstep: 0.12,
      jump: 0.18,
      hurt: 0.28,
      ui_click: 0.06,
      objective_complete: 0.65,
      lock_beep: 0.09,
      lock_ready: 0.18,
      engine: 0.5,
      pickup_health: 0.42,
      squad_order_confirm: 0.16,
      operator_downed_alarm: 0.48,
    };

    const dur = durations[id] ?? 0.25;
    const len = Math.max(1, Math.floor(sr * dur));
    const buf = ctx.createBuffer(2, len, sr);
    const dataL = buf.getChannelData(0);
    const dataR = buf.getChannelData(1);

    let seed = 0x13579bdf ^ (id.charCodeAt(0) << 8) ^ (id.charCodeAt(id.length - 1) << 16);
    const nextNoise = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed / 4294967295) * 2 - 1;
    };

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const nL = nextNoise();
      const nR = nextNoise();
      const nMono = (nL + nR) * 0.5;
      let sampleL = 0;
      let sampleR = 0;

      if (WEAPON_SHOT_SOUNDS.has(id)) {
        // 4-Layer Weapon Synthesis:
        // Layer 1: Mechanical action transient (bolt/sear click & high-frequency metallic ring)
        const mechEnv = Math.exp(-t * 95) + (t > 0.022 && t < 0.048 ? Math.exp(-(t - 0.022) * 110) * 0.45 : 0);
        const mechFreq = id === 'shot_sniper' ? 3400 : id === 'shot_shotgun' ? 2600 : 3100;
        const layer1Mech = (Math.sin(2 * Math.PI * mechFreq * t) * 0.55 + nMono * 0.45) * mechEnv * 0.28;

        // Layer 2: Mid-frequency muzzle blast & weapon body character
        let bodyDecay = 22;
        let bodyFreq = 260;
        let bodyGain = 0.62;
        if (id === 'shot_pistol') {
          bodyDecay = 28;
          bodyFreq = 360;
        } else if (id === 'shot_smg') {
          bodyDecay = 34;
          bodyFreq = 410;
        } else if (id === 'shot_rifle') {
          bodyDecay = 22;
          bodyFreq = 250;
        } else if (id === 'shot_lmg') {
          bodyDecay = 18;
          bodyFreq = 210;
          bodyGain = 0.68;
        } else if (id === 'shot_shotgun') {
          bodyDecay = 13;
          bodyFreq = 165;
          bodyGain = 0.78;
        } else if (id === 'shot_sniper') {
          bodyDecay = 10;
          bodyFreq = 145;
          bodyGain = 0.84;
        } else if (id === 'shot_grenade_launcher') {
          bodyDecay = 15;
          bodyFreq = 130;
          bodyGain = 0.66;
        } else if (id === 'shot_rocket' || id === 'shot_missile') {
          bodyDecay = 6.5;
          bodyFreq = 185;
          bodyGain = 0.72;
        }
        const bodyEnv = Math.exp(-t * bodyDecay);
        const layer2Body =
          (nMono * 0.68 + Math.sin(2 * Math.PI * bodyFreq * Math.exp(-t * 8) * t) * 0.32) *
          bodyEnv *
          bodyGain;

        // Layer 3: Low-frequency sub-bass punch (physical firing weight)
        const subFreq = id === 'shot_sniper' || id === 'shot_shotgun' ? 68 : id === 'shot_grenade_launcher' ? 58 : 88;
        const subEnv = Math.exp(-t * 24);
        const layer3Sub = Math.sin(2 * Math.PI * subFreq * Math.exp(-t * 6) * t) * subEnv * 0.46;

        // Layer 4: Stereo environmental tail (decorrelated L/R canyon/urban reflection decay)
        const tailAttack = Math.min(1, t / 0.018);
        const tailDecay = id === 'shot_sniper' ? 3.8 : id === 'shot_shotgun' ? 5.2 : 7.5;
        const tailEnv = tailAttack * Math.exp(-t * tailDecay) * 0.24;
        const layer4TailL = (nL * 0.8 + Math.sin(2 * Math.PI * 190 * t) * 0.2) * tailEnv;
        const layer4TailR = (nR * 0.8 + Math.cos(2 * Math.PI * 198 * t) * 0.2) * tailEnv;

        const coreMono = layer1Mech + layer2Body + layer3Sub;
        sampleL = Math.tanh((coreMono + layer4TailL) * 1.45);
        sampleR = Math.tanh((coreMono + layer4TailR) * 1.45);
      } else if (id === 'mag_out') {
        // Metallic catch release + magazine slide friction
        const click = t < 0.03 ? Math.sin(2 * Math.PI * 1650 * t) * Math.exp(-t * 110) * 0.65 : 0;
        const slide = t >= 0.03 ? (nMono * 0.6 + Math.sin(2 * Math.PI * 420 * t) * 0.4) * Math.exp(-(t - 0.03) * 18) * 0.42 : 0;
        sampleL = sampleR = click + slide;
      } else if (id === 'mag_in') {
        // Magazine well guide contact + firm locking seat thud
        const guide = t < 0.07 ? nMono * Math.exp(-t * 28) * 0.32 : 0;
        const seat =
          t >= 0.07
            ? (Math.sin(2 * Math.PI * 240 * (t - 0.07)) * 0.6 +
                Math.sin(2 * Math.PI * 1480 * (t - 0.07)) * 0.4) *
              Math.exp(-(t - 0.07) * 32) *
              0.75
            : 0;
        sampleL = sampleR = guide + seat;
      } else if (id === 'chamber') {
        // Bolt carrier release & locking lug snap
        const pull = t < 0.08 ? Math.sin(2 * Math.PI * 680 * t) * Math.exp(-t * 30) * 0.48 : 0;
        const snap =
          t >= 0.08
            ? (Math.sin(2 * Math.PI * 1920 * (t - 0.08)) * 0.65 + nMono * 0.35) *
              Math.exp(-(t - 0.08) * 40) *
              0.72
            : 0;
        sampleL = sampleR = pull + snap;
      } else if (id === 'bolt_cycle') {
        // 4-step sniper bolt lift -> pull back -> push forward -> lock down
        const s1 = t < 0.08 ? Math.sin(2 * Math.PI * 1120 * t) * Math.exp(-t * 36) * 0.55 : 0;
        const s2 =
          t >= 0.08 && t < 0.19
            ? (nMono * 0.5 + Math.sin(2 * Math.PI * 760 * (t - 0.08)) * 0.5) *
              Math.exp(-(t - 0.08) * 24) *
              0.62
            : 0;
        const s3 =
          t >= 0.19 && t < 0.3
            ? (nMono * 0.45 + Math.sin(2 * Math.PI * 840 * (t - 0.19)) * 0.55) *
              Math.exp(-(t - 0.19) * 26) *
              0.65
            : 0;
        const s4 =
          t >= 0.3
            ? Math.sin(2 * Math.PI * 1680 * (t - 0.3)) * Math.exp(-(t - 0.3) * 50) * 0.72
            : 0;
        sampleL = sampleR = s1 + s2 + s3 + s4;
      } else if (id === 'pump_cycle') {
        // Twin-bar shotgun forend rack back & forward clack
        const back =
          t < 0.12
            ? (nMono * 0.65 + Math.sin(2 * Math.PI * 520 * t) * 0.35) * Math.exp(-t * 22) * 0.68
            : 0;
        const fwd =
          t >= 0.12
            ? (nMono * 0.55 + Math.sin(2 * Math.PI * 1240 * (t - 0.12)) * 0.45) *
              Math.exp(-(t - 0.12) * 28) *
              0.74
            : 0;
        sampleL = sampleR = back + fwd;
      } else if (id === 'drum_index') {
        // Spring-loaded rotary grenade drum pawl ratchet clicks
        const ratchet1 = t < 0.08 ? Math.sin(2 * Math.PI * 980 * t) * Math.exp(-t * 45) * 0.6 : 0;
        const ratchet2 =
          t >= 0.08 && t < 0.17
            ? Math.sin(2 * Math.PI * 1160 * (t - 0.08)) * Math.exp(-(t - 0.08) * 45) * 0.64
            : 0;
        const ratchet3 =
          t >= 0.17
            ? Math.sin(2 * Math.PI * 1380 * (t - 0.17)) * Math.exp(-(t - 0.17) * 50) * 0.68
            : 0;
        sampleL = sampleR = ratchet1 + ratchet2 + ratchet3;
      } else if (id === 'explosion') {
        const env = Math.exp(-t * 3.2);
        const sub = Math.sin(2 * Math.PI * 48 * Math.exp(-t * 1.6) * t) * 0.72;
        const crack = Math.exp(-t * 28) * nMono * 0.5;
        sampleL = Math.tanh((nL * 0.65 + sub + crack) * env * 1.45);
        sampleR = Math.tanh((nR * 0.65 + sub + crack) * env * 1.45);
      } else if (id === 'explosion_heavy') {
        const env = Math.exp(-t * 1.85);
        const sub = Math.sin(2 * Math.PI * 36 * Math.exp(-t * 0.9) * t) * 0.85;
        const crack = Math.exp(-t * 24) * nMono * 0.65;
        sampleL = Math.tanh((nL * 0.72 + sub + crack) * env * 1.6);
        sampleR = Math.tanh((nR * 0.72 + sub + crack) * env * 1.6);
      } else if (id === 'explosion_nuke' || id === 'nuke_detonation') {
        const env = Math.exp(-t * 0.78);
        const sub = Math.sin(2 * Math.PI * 28 * Math.exp(-t * 0.35) * t) * 0.95;
        const shockwave = Math.sin(2 * Math.PI * 64 * Math.exp(-t * 1.2) * t) * 0.6;
        sampleL = Math.tanh((nL * 0.75 + sub + shockwave) * env * 1.8);
        sampleR = Math.tanh((nR * 0.75 + sub + shockwave) * env * 1.8);
      } else if (id === 'bomb_drop' || id === 'bomb_whistle') {
        const env = Math.sin((t / dur) * Math.PI);
        const freq = 980 * Math.exp(-t * 0.85);
        sampleL = sampleR = (Math.sin(2 * Math.PI * freq * t) * 0.55 + nMono * 0.2) * env * 0.65;
      } else if (id === 'c4_plant' || id === 'c4_place') {
        const click1 = t < 0.08 ? Math.sin(2 * Math.PI * 420 * t) * Math.exp(-t * 32) : 0;
        const beep2 = t >= 0.09 ? Math.sin(2 * Math.PI * 1680 * (t - 0.09)) * Math.exp(-(t - 0.09) * 26) : 0;
        sampleL = sampleR = (click1 + beep2) * 0.75;
      } else if (id === 'c4_beep') {
        const env = Math.exp(-t * 24);
        sampleL = sampleR = Math.sin(2 * Math.PI * 2250 * t) * env * 0.65;
      } else if (id === 'nuke_alarm' || id === 'nuke_siren') {
        const sweep = 520 + Math.sin(2 * Math.PI * 2.2 * t) * 240;
        const env = Math.sin((t / dur) * Math.PI);
        sampleL = sampleR = Math.tanh(Math.sin(2 * Math.PI * sweep * t) * 1.6) * env * 0.6;
      } else if (id === 'enemy_callout') {
        const f = t < 0.11 ? 310 : 255;
        sampleL = sampleR = (Math.sin(2 * Math.PI * f * t) * 0.55 + nMono * 0.35) * Math.exp(-t * 11) * 0.55;
      } else if (id === 'hit_marker') {
        const env = Math.exp(-t * 45);
        sampleL = sampleR = Math.sin(2 * Math.PI * 1850 * t) * env * 0.7;
      } else if (id === 'headshot') {
        const env = Math.exp(-t * 28);
        sampleL =
          sampleR =
            (Math.sin(2 * Math.PI * 2400 * t) + 0.5 * Math.sin(2 * Math.PI * 3600 * t)) * env * 0.75;
      } else if (id === 'reload') {
        const c1 = t < 0.12 ? Math.sin(2 * Math.PI * 620 * t) * Math.exp(-t * 25) : 0;
        const c2 =
          t > 0.22 && t < 0.38
            ? Math.sin(2 * Math.PI * 940 * (t - 0.22)) * Math.exp(-(t - 0.22) * 28)
            : 0;
        sampleL = sampleR = (c1 + c2 + nMono * 0.1 * Math.exp(-t * 8)) * 0.75;
      } else if (id === 'empty_click') {
        sampleL = sampleR = Math.sin(2 * Math.PI * 1400 * t) * Math.exp(-t * 60) * 0.6;
      } else if (id === 'footstep') {
        sampleL = sampleR = nMono * Math.exp(-t * 32) * 0.45;
      } else if (id === 'jump') {
        sampleL = sampleR = Math.sin(2 * Math.PI * (120 + t * 180) * t) * Math.exp(-t * 16) * 0.5;
      } else if (id === 'hurt') {
        sampleL = sampleR = (nMono * 0.5 + Math.sin(2 * Math.PI * 140 * t) * 0.5) * Math.exp(-t * 10) * 0.8;
      } else if (id === 'ui_click') {
        sampleL = sampleR = Math.sin(2 * Math.PI * 1200 * t) * Math.exp(-t * 55) * 0.5;
      } else if (id === 'objective_complete') {
        const f = t < 0.2 ? 523.25 : t < 0.4 ? 659.25 : 783.99;
        sampleL = sampleR = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 3.5) * 0.65;
      } else if (id === 'lock_beep') {
        sampleL = sampleR = Math.sin(2 * Math.PI * 1350 * t) * Math.exp(-t * 25) * 0.55;
      } else if (id === 'lock_ready') {
        sampleL = sampleR = Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 14) * 0.65;
      } else if (id === 'pickup_health') {
        const f = t < 0.13 ? 587.33 : t < 0.26 ? 783.99 : 1046.5;
        sampleL = sampleR = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 4.5) * 0.68;
      } else if (id === 'squad_order_confirm') {
        const f = t < 0.065 ? 920 : 1380;
        sampleL = sampleR = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 20) * 0.52;
      } else if (id === 'operator_downed_alarm') {
        const pulse = (t < 0.18 || (t >= 0.24 && t < 0.42)) ? 1 : 0;
        const f = t < 0.24 ? 880 : 660;
        sampleL = sampleR = Math.sin(2 * Math.PI * f * t) * pulse * Math.exp(-t * 3.8) * 0.64;
      } else {
        sampleL = sampleR = Math.sin(2 * Math.PI * 82 * t) * 0.4;
      }

      dataL[i] = sampleL;
      dataR[i] = sampleR;
    }
    return buf;
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
          src.disconnect();
          gain.disconnect();
          reverbSendGain?.disconnect();
        } catch {
          // already stopped
        }
      },
    };

    this.voices.push(voice);
    src.onended = () => {
      const idx = this.voices.indexOf(voice);
      if (idx !== -1) this.voices.splice(idx, 1);
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
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 5.0;
    panner.maxDistance = maxDist;
    panner.rolloffFactor = 1.25;
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;

    // Distance-attenuated gain scaling so distant fire retains presence without overpowering player cues
    const distAtten = 1 / (1 + Math.max(0, dist - 5) * 0.035);
    const gain = this.ctx.createGain();
    gain.gain.value = volume * Math.max(0.12, Math.min(1, distAtten));

    src.connect(panner);
    panner.connect(gain);
    gain.connect(this.sfxGain);

    let reverbSendGain: GainNode | null = null;
    const sendAmt = this.getReverbSendLevel(id, true);
    if (sendAmt > 0 && this.reverbNode) {
      reverbSendGain = this.ctx.createGain();
      // Slightly higher wet/dry reflection ratio at medium-to-long distance
      const distWetBoost = Math.min(1.6, 1 + dist / 65);
      reverbSendGain.gain.value = volume * sendAmt * distWetBoost * Math.max(0.2, distAtten);
      panner.connect(reverbSendGain);
      reverbSendGain.connect(this.reverbNode);
    }

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
          src.disconnect();
          panner.disconnect();
          gain.disconnect();
          reverbSendGain?.disconnect();
        } catch {
          // already stopped
        }
      },
    };

    this.voices.push(voice);
    src.onended = () => {
      const idx = this.voices.indexOf(voice);
      if (idx !== -1) this.voices.splice(idx, 1);
    };
    src.start(0);
  }

  public playWeaponSound(weaponId: WeaponId, spatialPos?: { x: number; y: number; z: number }): void {
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
    const sid = map[weaponId];
    if (spatialPos) {
      this.playSpatial(sid, spatialPos.x, spatialPos.y, spatialPos.z, 6, 0.75);
    } else {
      this.play2D(sid, 9, 0.82);
    }
  }

  public startMissionAmbienceAndMusic(mood?: MusicMood): void {
    this.stopMissionLoops();
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
