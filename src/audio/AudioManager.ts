import { ResourceManager } from '@/src/core/ResourceManager';
import { AudioSettings } from '@/src/schemas/settings.schema';
import { WeaponId } from '@/src/schemas/weapon.schema';

export type SoundKind =
  | 'shot_rifle'
  | 'shot_smg'
  | 'shot_sniper'
  | 'shot_shotgun'
  | 'shot_lmg'
  | 'shot_pistol'
  | 'shot_rocket'
  | 'shot_grenade_launcher'
  | 'reload'
  | 'explosion'
  | 'impact'
  | 'hit_marker'
  | 'headshot'
  | 'footstep'
  | 'lock_beep'
  | 'lock_ready'
  | 'enemy_callout'
  | 'rotor'
  | 'engine'
  | 'c4_place'
  | 'c4_beep'
  | 'bomb_whistle'
  | 'nuke_siren'
  | 'nuke_detonation'
  | 'ui_click';

interface VoiceSlot {
  active: boolean;
  priority: number;
  startTime: number;
  source: AudioBufferSourceNode | null;
  panner: PannerNode | null;
  gain: GainNode | null;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;

  private buffers = new Map<SoundKind, AudioBuffer>();
  private voices: VoiceSlot[] = [];
  private readonly maxVoices = 24;
  private ambienceSource: AudioBufferSourceNode | null = null;
  private ambienceFilter: BiquadFilterNode | null = null;
  private ambienceNodeGain: GainNode | null = null;
  private ambienceResourceId: string | null = null;
  private ambienceCleanup: (() => void) | null = null;
  private musicIntervalId = 0;
  private settings: AudioSettings;
  private initialized = false;
  private suspendedByLifecycle = false;

  constructor(
    private readonly resourceManager: ResourceManager,
    initialSettings: AudioSettings
  ) {
    this.settings = initialSettings;
    for (let i = 0; i < this.maxVoices; i++) {
      this.voices.push({
        active: false,
        priority: 0,
        startTime: 0,
        source: null,
        panner: null,
        gain: null,
      });
    }
  }

  unlock(): void {
    try {
      this.suspendedByLifecycle = false;
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.ambienceGain = this.ctx.createGain();

        this.sfxGain.connect(this.masterGain);
        this.musicGain.connect(this.masterGain);
        this.ambienceGain.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);

        this.applySettings(this.settings);
        this.prebuildBuffers();
        this.initialized = true;
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      this.syncMasterGain();
    } catch {
      // Fail gracefully if Web Audio is blocked or unavailable
    }
  }

  suspend(): void {
    this.suspendedByLifecycle = true;
    this.syncMasterGain(true);
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => {});
    }
  }

  resume(): void {
    this.suspendedByLifecycle = false;
    this.syncMasterGain();
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  isSuspendedByLifecycle(): boolean {
    return this.suspendedByLifecycle;
  }

  applySettings(settings: AudioSettings): void {
    this.settings = settings;
    if (!this.ctx || !this.masterGain || !this.sfxGain || !this.musicGain || !this.ambienceGain) return;
    const now = this.ctx.currentTime;
    this.syncMasterGain();
    this.sfxGain.gain.setTargetAtTime(settings.sfxVolume, now, 0.02);
    this.musicGain.gain.setTargetAtTime(settings.musicVolume, now, 0.02);
    this.ambienceGain.gain.setTargetAtTime(settings.ambienceVolume, now, 0.02);
  }

  private syncMasterGain(immediate = false): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const master = this.suspendedByLifecycle || this.settings.muted ? 0 : this.settings.masterVolume;
    if (immediate) {
      this.masterGain.gain.setValueAtTime(master, now);
    } else {
      this.masterGain.gain.setTargetAtTime(master, now, 0.02);
    }
  }

  updateListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = px;
      l.positionY.value = py;
      l.positionZ.value = pz;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
  }

  playWeaponSound(weaponId: WeaponId): void {
    const map: Record<WeaponId, SoundKind> = {
      assault_rifle: 'shot_rifle',
      smg: 'shot_smg',
      sniper_rifle: 'shot_sniper',
      shotgun: 'shot_shotgun',
      lmg: 'shot_lmg',
      pistol: 'shot_pistol',
      rocket_launcher: 'shot_rocket',
      guided_missile: 'shot_rocket',
      grenade_launcher: 'shot_grenade_launcher',
    };
    this.play2D(map[weaponId], 10, 0.72);
  }

  play2D(kind: SoundKind, priority = 5, volume = 0.65): void {
    this.playInternal(kind, priority, volume, null);
  }

  playSpatial(kind: SoundKind, x: number, y: number, z: number, priority = 4, volume = 0.8): void {
    this.playInternal(kind, priority, volume, { x, y, z });
  }

  startMissionAmbienceAndMusic(): void {
    this.stopMissionLoops();
    if (!this.ctx || !this.ambienceGain || !this.musicGain) return;

    // Looping subtle battlefield wind/rumble noise
    const buf = this.createNoiseLoopBuffer(3.0);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 260;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.22;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.ambienceGain);
      src.start();
      this.ambienceSource = src;
      this.ambienceFilter = filter;
      this.ambienceNodeGain = gain;

      let nodeDisposed = false;
      const cleanupAmbience = () => {
        if (nodeDisposed) return;
        nodeDisposed = true;
        try {
          src.stop();
          src.disconnect();
        } catch {
          // Ignore already-stopped audio nodes
        }
        try {
          filter.disconnect();
          gain.disconnect();
        } catch {
          // Ignore already-disconnected nodes
        }
        if (this.ambienceSource === src) this.ambienceSource = null;
        if (this.ambienceFilter === filter) this.ambienceFilter = null;
        if (this.ambienceNodeGain === gain) this.ambienceNodeGain = null;
        if (this.ambienceCleanup === cleanupAmbience) this.ambienceCleanup = null;
      };
      this.ambienceCleanup = cleanupAmbience;
      this.ambienceResourceId = this.resourceManager.register('audioNode', 'mission:audio', cleanupAmbience);
    }

    // Procedural tactical pulse bassline
    let step = 0;
    const notes = [55, 55, 65.4, 49, 55, 55, 73.4, 61.7];
    this.musicIntervalId = window.setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running' || !this.musicGain) return;
      const freq = notes[step % notes.length];
      step++;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      const t = this.ctx.currentTime;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      osc.connect(filter);
      filter.connect(g);
      g.connect(this.musicGain);
      osc.start(t);
      osc.stop(t + 0.44);
      osc.onended = () => {
        osc.onended = null;
        osc.disconnect();
        filter.disconnect();
        g.disconnect();
      };
    }, 480);
  }

  stopMissionLoops(): void {
    if (this.ambienceResourceId) {
      const id = this.ambienceResourceId;
      this.ambienceResourceId = null;
      this.resourceManager.release(id);
    }
    if (this.ambienceCleanup) {
      this.ambienceCleanup();
    }
    if (this.ambienceSource) {
      try {
        this.ambienceSource.stop();
        this.ambienceSource.disconnect();
      } catch {
        // Ignore
      }
      this.ambienceSource = null;
    }
    if (this.ambienceFilter) {
      try {
        this.ambienceFilter.disconnect();
      } catch {
        // Ignore
      }
      this.ambienceFilter = null;
    }
    if (this.ambienceNodeGain) {
      try {
        this.ambienceNodeGain.disconnect();
      } catch {
        // Ignore
      }
      this.ambienceNodeGain = null;
    }
    if (this.musicIntervalId) {
      window.clearInterval(this.musicIntervalId);
      this.musicIntervalId = 0;
    }
    this.stopAllVoices();
  }

  stopAllVoices(): void {
    for (const v of this.voices) {
      if (v.active) {
        this.releaseVoice(v);
      }
    }
  }

  getActiveVoiceCount(): number {
    let count = 0;
    for (let i = 0; i < this.voices.length; i++) {
      if (this.voices[i].active) count++;
    }
    return count;
  }

  dispose(): void {
    this.stopMissionLoops();
    this.masterGain?.disconnect();
    this.sfxGain?.disconnect();
    this.musicGain?.disconnect();
    this.ambienceGain?.disconnect();
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.ambienceGain = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
    this.suspendedByLifecycle = false;
    this.buffers.clear();
  }

  private playInternal(
    kind: SoundKind,
    priority: number,
    volume: number,
    pos: { x: number; y: number; z: number } | null
  ): void {
    if (!this.initialized || !this.ctx || !this.sfxGain || this.ctx.state !== 'running') return;
    const buffer = this.buffers.get(kind);
    if (!buffer) return;

    const slot = this.acquireVoiceSlot(priority);
    if (!slot) return;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const isPitchFixedCue =
      kind === 'ui_click' ||
      kind === 'hit_marker' ||
      kind === 'headshot' ||
      kind === 'lock_beep' ||
      kind === 'lock_ready' ||
      kind === 'c4_beep' ||
      kind === 'nuke_siren';
    src.playbackRate.value = isPitchFixedCue ? 1.0 : 0.95 + Math.random() * 0.1;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    let panner: PannerNode | null = null;
    if (pos) {
      panner = this.ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 8;
      panner.maxDistance = 160;
      panner.rolloffFactor = 1.15;
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;

      src.connect(gain);
      gain.connect(panner);
      panner.connect(this.sfxGain);
    } else {
      src.connect(gain);
      gain.connect(this.sfxGain);
    }

    slot.active = true;
    slot.priority = priority;
    slot.startTime = this.ctx.currentTime;
    slot.source = src;
    slot.panner = panner;
    slot.gain = gain;

    src.onended = () => {
      this.releaseVoice(slot);
    };
    src.start();
  }

  private acquireVoiceSlot(priority: number): VoiceSlot | null {
    for (let i = 0; i < this.voices.length; i++) {
      if (!this.voices[i].active) return this.voices[i];
    }
    // Evict lowest-priority oldest voice
    let victim: VoiceSlot | null = null;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.priority <= priority && (!victim || v.priority < victim.priority || v.startTime < victim.startTime)) {
        victim = v;
      }
    }
    if (victim) {
      this.releaseVoice(victim);
      return victim;
    }
    return null;
  }

  private releaseVoice(slot: VoiceSlot): void {
    if (slot.source) {
      slot.source.onended = null;
    }
    try {
      slot.source?.stop();
    } catch {
      // Ignore already ended
    }
    try {
      slot.source?.disconnect();
      slot.gain?.disconnect();
      slot.panner?.disconnect();
    } catch {
      // Ignore
    }
    slot.active = false;
    slot.source = null;
    slot.gain = null;
    slot.panner = null;
  }

  private prebuildBuffers(): void {
    const kinds: SoundKind[] = [
      'shot_rifle',
      'shot_smg',
      'shot_sniper',
      'shot_shotgun',
      'shot_lmg',
      'shot_pistol',
      'shot_rocket',
      'shot_grenade_launcher',
      'reload',
      'explosion',
      'impact',
      'hit_marker',
      'headshot',
      'footstep',
      'lock_beep',
      'lock_ready',
      'enemy_callout',
      'rotor',
      'engine',
      'c4_place',
      'c4_beep',
      'bomb_whistle',
      'nuke_siren',
      'nuke_detonation',
      'ui_click',
    ];
    for (const k of kinds) {
      const buf = this.synthesizeSound(k);
      if (buf) this.buffers.set(k, buf);
    }
  }

  private synthesizeSound(kind: SoundKind): AudioBuffer | null {
    if (!this.ctx) return null;
    const sr = this.ctx.sampleRate;
    const durMap: Record<SoundKind, number> = {
      shot_rifle: 0.22,
      shot_smg: 0.14,
      shot_sniper: 0.45,
      shot_shotgun: 0.36,
      shot_lmg: 0.24,
      shot_pistol: 0.17,
      shot_rocket: 0.55,
      shot_grenade_launcher: 0.28,
      reload: 0.25,
      explosion: 1.15,
      impact: 0.12,
      hit_marker: 0.08,
      headshot: 0.14,
      footstep: 0.1,
      lock_beep: 0.09,
      lock_ready: 0.18,
      enemy_callout: 0.24,
      rotor: 0.25,
      engine: 0.3,
      c4_place: 0.18,
      c4_beep: 0.08,
      bomb_whistle: 0.95,
      nuke_siren: 1.1,
      nuke_detonation: 2.4,
      ui_click: 0.06,
    };
    const dur = durMap[kind];
    const len = Math.floor(sr * dur);
    const buffer = this.ctx.createBuffer(1, len, sr);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * (kind === 'explosion' ? 3.2 : kind === 'shot_sniper' ? 7 : 18));
      const noise = Math.random() * 2 - 1;

      if (kind.startsWith('shot_')) {
        const punchFreq =
          kind === 'shot_sniper' ? 95 : kind === 'shot_shotgun' ? 80 : kind === 'shot_smg' ? 175 : 130;
        const punch = Math.sin(2 * Math.PI * punchFreq * Math.exp(-t * 14) * t);
        const crack = noise * env;
        const rocketWhoosh = kind === 'shot_rocket' ? noise * 0.6 * Math.exp(-t * 2.5) : 0;
        data[i] = Math.tanh((punch * 0.7 + crack * 0.8 + rocketWhoosh) * 1.4) * env;
      } else if (kind === 'explosion') {
        const sub = Math.sin(2 * Math.PI * (48 * Math.exp(-t * 2.2)) * t);
        data[i] = Math.tanh((sub * 0.9 + noise * 0.85) * 1.8) * Math.exp(-t * 2.8);
      } else if (kind === 'hit_marker') {
        data[i] = Math.sin(2 * Math.PI * 1650 * t) * Math.exp(-t * 45) * 0.45;
      } else if (kind === 'headshot') {
        data[i] = (Math.sin(2 * Math.PI * 2400 * t) + Math.sin(2 * Math.PI * 3200 * t) * 0.5) * Math.exp(-t * 32) * 0.55;
      } else if (kind === 'lock_beep') {
        data[i] = Math.sin(2 * Math.PI * 1180 * t) * Math.exp(-t * 25) * 0.4;
      } else if (kind === 'lock_ready') {
        data[i] = Math.sin(2 * Math.PI * 1960 * t) * Math.exp(-t * 14) * 0.5;
      } else if (kind === 'reload') {
        const click = t < 0.04 || (t > 0.14 && t < 0.19) ? 1 : 0.1;
        data[i] = (noise * 0.35 + Math.sin(2 * Math.PI * 620 * t) * 0.4) * click * Math.exp(-t * 12);
      } else if (kind === 'enemy_callout') {
        data[i] = (Math.sin(2 * Math.PI * (440 + Math.sin(t * 22) * 60) * t) * 0.3 + noise * 0.15) * env;
      } else if (kind === 'c4_place') {
        data[i] = (Math.sin(2 * Math.PI * 520 * t) * 0.45 + noise * 0.25) * Math.exp(-t * 18);
      } else if (kind === 'c4_beep') {
        data[i] = Math.sin(2 * Math.PI * 1950 * t) * Math.exp(-t * 28) * 0.38;
      } else if (kind === 'bomb_whistle') {
        const freq = 920 - t * 480;
        data[i] = Math.sin(2 * Math.PI * freq * t) * Math.sin((t / dur) * Math.PI) * 0.42;
      } else if (kind === 'nuke_siren') {
        const sweep = 420 + Math.sin(t * Math.PI * 2) * 180;
        data[i] = Math.sin(2 * Math.PI * sweep * t) * 0.45 * Math.sin((t / dur) * Math.PI);
      } else if (kind === 'nuke_detonation') {
        const sub = Math.sin(2 * Math.PI * (34 * Math.exp(-t * 1.1)) * t);
        data[i] = Math.tanh((sub * 1.1 + noise * 0.95) * 2.0) * Math.exp(-t * 1.25);
      } else if (kind === 'ui_click') {
        data[i] = Math.sin(2 * Math.PI * 980 * t) * Math.exp(-t * 60) * 0.35;
      } else {
        data[i] = noise * Math.exp(-t * 26) * 0.4;
      }
    }
    return buffer;
  }

  private createNoiseLoopBuffer(seconds: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buffer = this.ctx.createBuffer(1, len, sr);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04;
      data[i] = last * 2.5;
    }
    return buffer;
  }
}
