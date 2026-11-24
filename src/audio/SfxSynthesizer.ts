/**
 * Procedural SFX & Reverb Impulse-Response Synthesizer extracted from AudioManager.
 * Pure Web Audio buffer synthesis — owns sound IDs, category sets, stereo canyon/urban IR
 * generation, and 4-layer weapon/ordnance/foley procedural waveform synthesis.
 */

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
  | 'shot_suppressed'
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
  | 'enemy_bark_flank'
  | 'enemy_bark_frag'
  | 'hit_marker'
  | 'headshot'
  | 'armor_hit'
  | 'armor_break'
  | 'kill_confirm'
  | 'bullet_crack'
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

export const RELOAD_FOLEY_SOUNDS: ReadonlySet<SoundId> = new Set<SoundId>([
  'reload',
  'mag_out',
  'mag_in',
  'chamber',
  'bolt_cycle',
  'pump_cycle',
  'drum_index',
]);

export const WEAPON_SHOT_SOUNDS: ReadonlySet<SoundId> = new Set<SoundId>([
  'shot_pistol',
  'shot_smg',
  'shot_rifle',
  'shot_lmg',
  'shot_shotgun',
  'shot_sniper',
  'shot_grenade_launcher',
  'shot_rocket',
  'shot_missile',
  'shot_suppressed',
]);

export const ORDNANCE_SOUNDS: ReadonlySet<SoundId> = new Set<SoundId>([
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

const SOUND_DURATIONS: Record<SoundId, number> = {
  shot_pistol: 0.28,
  shot_smg: 0.22,
  shot_rifle: 0.34,
  shot_lmg: 0.36,
  shot_shotgun: 0.52,
  shot_sniper: 0.78,
  shot_grenade_launcher: 0.48,
  shot_rocket: 0.68,
  shot_missile: 0.72,
  shot_suppressed: 0.19,
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
  enemy_bark_flank: 0.32,
  enemy_bark_frag: 0.36,
  hit_marker: 0.08,
  headshot: 0.14,
  armor_hit: 0.12,
  armor_break: 0.26,
  kill_confirm: 0.16,
  bullet_crack: 0.15,
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

export function buildImpulseResponseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
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

export function synthesizeLayeredSound(ctx: AudioContext, id: SoundId): AudioBuffer {
  const sr = ctx.sampleRate;
  const dur = SOUND_DURATIONS[id] ?? 0.25;
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

    if (id === 'shot_suppressed') {
      // Distinct baffled suppressor signature: tight pressurized gas puff + crisp mechanical bolt cycle
      const mechClick =
        (Math.sin(2 * Math.PI * 2950 * t) * 0.52 + nMono * 0.48) * Math.exp(-t * 115) * 0.48;
      const baffleThump =
        (Math.sin(2 * Math.PI * 195 * Math.exp(-t * 16) * t) * 0.62 + nMono * 0.38) *
        Math.exp(-t * 44) *
        0.52;
      const gasHiss = (nL * 0.5 + nR * 0.5) * Math.exp(-t * 28) * 0.22;
      sampleL = Math.tanh((mechClick + baffleThump + gasHiss * (0.9 + 0.1 * nL)) * 1.25);
      sampleR = Math.tanh((mechClick + baffleThump + gasHiss * (0.9 + 0.1 * nR)) * 1.25);
    } else if (WEAPON_SHOT_SOUNDS.has(id)) {
      // 4-Layer Weapon Synthesis:
      // Layer 1: Mechanical action transient (bolt/sear click & high-frequency metallic ring)
      const mechEnv =
        Math.exp(-t * 95) +
        (t > 0.022 && t < 0.048 ? Math.exp(-(t - 0.022) * 110) * 0.45 : 0);
      const mechFreq = id === 'shot_sniper' ? 3400 : id === 'shot_shotgun' ? 2600 : 3100;
      const layer1Mech =
        (Math.sin(2 * Math.PI * mechFreq * t) * 0.55 + nMono * 0.45) * mechEnv * 0.28;

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
      const subFreq =
        id === 'shot_sniper' || id === 'shot_shotgun'
          ? 68
          : id === 'shot_grenade_launcher'
            ? 58
            : 88;
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
      const click = t < 0.03 ? Math.sin(2 * Math.PI * 1650 * t) * Math.exp(-t * 110) * 0.65 : 0;
      const slide =
        t >= 0.03
          ? (nMono * 0.6 + Math.sin(2 * Math.PI * 420 * t) * 0.4) *
            Math.exp(-(t - 0.03) * 18) *
            0.42
          : 0;
      sampleL = sampleR = click + slide;
    } else if (id === 'mag_in') {
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
      const pull = t < 0.08 ? Math.sin(2 * Math.PI * 680 * t) * Math.exp(-t * 30) * 0.48 : 0;
      const snap =
        t >= 0.08
          ? (Math.sin(2 * Math.PI * 1920 * (t - 0.08)) * 0.65 + nMono * 0.35) *
            Math.exp(-(t - 0.08) * 40) *
            0.72
          : 0;
      sampleL = sampleR = pull + snap;
    } else if (id === 'bolt_cycle') {
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
      const beep2 =
        t >= 0.09 ? Math.sin(2 * Math.PI * 1680 * (t - 0.09)) * Math.exp(-(t - 0.09) * 26) : 0;
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
      sampleL = sampleR =
        (Math.sin(2 * Math.PI * f * t) * 0.55 + nMono * 0.35) * Math.exp(-t * 11) * 0.55;
    } else if (id === 'enemy_bark_flank') {
      // Two-syllable urgent radio-clipped flanking vocal cadence
      const syll = t < 0.12 ? 1 : t > 0.15 && t < 0.29 ? 1 : 0;
      const f0 = t < 0.14 ? 225 : 275;
      const formant = Math.sin(2 * Math.PI * (f0 * 3.1) * t) * 0.35;
      sampleL = sampleR =
        (Math.sin(2 * Math.PI * f0 * t) * 0.5 + formant + nMono * 0.22) *
        syll *
        Math.exp(-t * 5.2) *
        0.58;
    } else if (id === 'enemy_bark_frag') {
      // Sharp urgent 2-burst grenade flush warning cadence ("Frag out!")
      const burst = t < 0.11 ? 1 : t > 0.14 && t < 0.33 ? 1 : 0;
      const f0 = t < 0.12 ? 340 : 290;
      const formant = Math.sin(2 * Math.PI * (f0 * 2.8) * t) * 0.42;
      sampleL = sampleR =
        Math.tanh((Math.sin(2 * Math.PI * f0 * t) * 0.55 + formant + nMono * 0.25) * 1.4) *
        burst *
        Math.exp(-t * 4.2) *
        0.66;
    } else if (id === 'hit_marker') {
      // Crisp grounded flesh impact thud + subtle confirmation tick
      const tick = Math.sin(2 * Math.PI * 1650 * t) * Math.exp(-t * 52) * 0.52;
      const thud = Math.sin(2 * Math.PI * 175 * Math.exp(-t * 22) * t) * Math.exp(-t * 42) * 0.38;
      sampleL = sampleR = tick + thud;
    } else if (id === 'armor_hit') {
      // Metallic steel/ceramic plate deflection ping
      const env = Math.exp(-t * 34);
      const clang =
        Math.sin(2 * Math.PI * 1420 * t) * 0.48 +
        Math.sin(2 * Math.PI * 3180 * t) * 0.36 +
        nMono * Math.exp(-t * 95) * 0.32;
      sampleL = sampleR = Math.tanh(clang * env * 1.35) * 0.72;
    } else if (id === 'armor_break') {
      // Ceramic/plate shatter + descending metallic clatter
      const crack = nMono * Math.exp(-t * 26) * 0.58;
      const ring1 = Math.sin(2 * Math.PI * (2650 - t * 3200) * t) * Math.exp(-t * 18) * 0.45;
      const clatter =
        t > 0.06
          ? Math.sin(2 * Math.PI * 1120 * (t - 0.06)) * Math.exp(-(t - 0.06) * 24) * 0.42
          : 0;
      sampleL = Math.tanh((crack + ring1 + clatter + nL * 0.15 * Math.exp(-t * 16)) * 1.35) * 0.78;
      sampleR = Math.tanh((crack + ring1 + clatter + nR * 0.15 * Math.exp(-t * 16)) * 1.35) * 0.78;
    } else if (id === 'kill_confirm') {
      // Grounded tight sub-bass thump + crisp tactical confirmation transient
      const sub = Math.sin(2 * Math.PI * 118 * Math.exp(-t * 14) * t) * Math.exp(-t * 22) * 0.68;
      const snap = Math.sin(2 * Math.PI * 2150 * t) * Math.exp(-t * 64) * 0.42;
      sampleL = sampleR = Math.tanh((sub + snap) * 1.3) * 0.76;
    } else if (id === 'bullet_crack') {
      // Supersonic ballistic whip-crack (0-18ms) followed by brief Doppler air whiz
      const whip =
        t < 0.022
          ? (nMono * 0.72 + Math.sin(2 * Math.PI * 4200 * Math.exp(-t * 60) * t) * 0.48) *
            Math.exp(-t * 115) *
            0.95
          : 0;
      const whizFreq = 1900 * Math.exp(-t * 14) + 320;
      const whizEnv = Math.sin(Math.min(1, t / 0.15) * Math.PI) * Math.exp(-t * 16);
      const whiz = (Math.sin(2 * Math.PI * whizFreq * t) * 0.35 + nMono * 0.45) * whizEnv * 0.52;
      sampleL = Math.tanh((whip + whiz * (1 + 0.18 * nL)) * 1.35);
      sampleR = Math.tanh((whip + whiz * (1 + 0.18 * nR)) * 1.35);
    } else if (id === 'headshot') {
      // Crisp ballistic helmet ping + decisive upper harmonic
      const env = Math.exp(-t * 28);
      sampleL =
        sampleR =
          (Math.sin(2 * Math.PI * 2450 * t) * 0.65 +
            Math.sin(2 * Math.PI * 3720 * t) * 0.45 +
            Math.sin(2 * Math.PI * 155 * t) * Math.exp(-t * 36) * 0.4) *
          env *
          0.78;
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
      sampleL = sampleR =
        (nMono * 0.5 + Math.sin(2 * Math.PI * 140 * t) * 0.5) * Math.exp(-t * 10) * 0.8;
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
      const pulse = t < 0.18 || (t >= 0.24 && t < 0.42) ? 1 : 0;
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
