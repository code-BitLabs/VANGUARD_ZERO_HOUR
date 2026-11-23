export type MusicMood =
  | 'tactical_atmosphere'
  | 'calm_deployment'
  | 'atmospheric_exploration'
  | 'combat_intensity'
  | 'mission_climax';

export interface MusicTrackMetadata {
  readonly id: string;
  readonly title: string;
  readonly moodLabel: string;
  readonly mood: MusicMood;
  readonly bpm: number;
  readonly durationSec: number;
  readonly keySignature: string;
  readonly sourceType: 'procedural' | 'url';
  readonly url?: string;
}

export const MUSIC_TRACK_CATALOG: readonly MusicTrackMetadata[] = [
  {
    id: 'zero_hour_overture',
    title: 'Zero Hour Overture',
    moodLabel: 'Tactical Military',
    mood: 'tactical_atmosphere',
    bpm: 108,
    durationSec: 32,
    keySignature: 'D minor',
    sourceType: 'procedural',
  },
  {
    id: 'forward_base_dawn',
    title: 'Forward Base Dawn',
    moodLabel: 'Deployment Ambience',
    mood: 'calm_deployment',
    bpm: 84,
    durationSec: 32,
    keySignature: 'A minor',
    sourceType: 'procedural',
  },
  {
    id: 'ashen_recon',
    title: 'Ashen Recon',
    moodLabel: 'Atmospheric Exploration',
    mood: 'atmospheric_exploration',
    bpm: 94,
    durationSec: 32,
    keySignature: 'E minor',
    sourceType: 'procedural',
  },
  {
    id: 'nightfall_protocol',
    title: 'Nightfall Protocol',
    moodLabel: 'Covert Tactical',
    mood: 'tactical_atmosphere',
    bpm: 114,
    durationSec: 32,
    keySignature: 'C minor',
    sourceType: 'procedural',
  },
  {
    id: 'iron_advance',
    title: 'Iron Advance',
    moodLabel: 'Combat Intensity',
    mood: 'combat_intensity',
    bpm: 126,
    durationSec: 32,
    keySignature: 'F# minor',
    sourceType: 'procedural',
  },
  {
    id: 'redline_extraction',
    title: 'Redline Extraction',
    moodLabel: 'Mission Climax',
    mood: 'mission_climax',
    bpm: 134,
    durationSec: 32,
    keySignature: 'G minor',
    sourceType: 'procedural',
  },
] as const;

export function getMusicTrackById(id: string): MusicTrackMetadata | undefined {
  return MUSIC_TRACK_CATALOG.find((t) => t.id === id);
}

export function getDefaultTrackForMood(mood: MusicMood): MusicTrackMetadata {
  return MUSIC_TRACK_CATALOG.find((t) => t.mood === mood) ?? MUSIC_TRACK_CATALOG[0];
}

interface SynthArrangement {
  readonly rootHz: number;
  readonly progressionSemis: readonly number[];
  readonly arpPattern: readonly number[];
  readonly padGain: number;
  readonly bassGain: number;
  readonly pulseGain: number;
  readonly percussionGain: number;
  readonly shimmerGain: number;
  readonly pulseSubdivision: number;
}

const TRACK_ARRANGEMENTS: Record<string, SynthArrangement> = {
  zero_hour_overture: {
    rootHz: 73.42, // D2
    progressionSemis: [0, -2, -4, -2, 0, 3, 2, -2],
    arpPattern: [0, 7, 12, 10, 7, 3, 7, 12],
    padGain: 0.24,
    bassGain: 0.3,
    pulseGain: 0.14,
    percussionGain: 0.14,
    shimmerGain: 0.08,
    pulseSubdivision: 4,
  },
  forward_base_dawn: {
    rootHz: 55.0, // A1
    progressionSemis: [0, 5, 3, 7, 0, -2, 3, 5],
    arpPattern: [0, 7, 12, 15, 12, 7, 5, 7],
    padGain: 0.3,
    bassGain: 0.18,
    pulseGain: 0.07,
    percussionGain: 0.04,
    shimmerGain: 0.11,
    pulseSubdivision: 2,
  },
  ashen_recon: {
    rootHz: 82.41, // E2
    progressionSemis: [0, 3, -2, 2, 0, 5, 3, -2],
    arpPattern: [0, 3, 7, 10, 12, 10, 7, 3],
    padGain: 0.26,
    bassGain: 0.22,
    pulseGain: 0.11,
    percussionGain: 0.08,
    shimmerGain: 0.1,
    pulseSubdivision: 4,
  },
  nightfall_protocol: {
    rootHz: 65.41, // C2
    progressionSemis: [0, 0, 3, -2, 0, 5, 3, -1],
    arpPattern: [0, 7, 10, 12, 15, 12, 10, 7],
    padGain: 0.22,
    bassGain: 0.32,
    pulseGain: 0.16,
    percussionGain: 0.15,
    shimmerGain: 0.09,
    pulseSubdivision: 4,
  },
  iron_advance: {
    rootHz: 92.5, // F#2
    progressionSemis: [0, 0, 3, 5, 0, -2, 3, 7],
    arpPattern: [0, 7, 12, 7, 15, 12, 10, 7],
    padGain: 0.19,
    bassGain: 0.34,
    pulseGain: 0.19,
    percussionGain: 0.2,
    shimmerGain: 0.07,
    pulseSubdivision: 4,
  },
  redline_extraction: {
    rootHz: 98.0, // G2
    progressionSemis: [0, 3, 5, 7, 0, -2, 3, 5],
    arpPattern: [0, 7, 12, 15, 19, 15, 12, 7],
    padGain: 0.2,
    bassGain: 0.36,
    pulseGain: 0.21,
    percussionGain: 0.22,
    shimmerGain: 0.09,
    pulseSubdivision: 4,
  },
};

function semiToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

export interface SynthesizedMusicPcm {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
  readonly durationSec: number;
}

/**
 * Pure deterministic stereo PCM synthesizer with zero DOM/WebAudio dependencies.
 * Can run identically inside a Web Worker (zero-copy ArrayBuffer transfer) or synchronously in tests.
 */
export function synthesizeMusicTrackPcm(
  track: MusicTrackMetadata,
  targetSampleRate = 22050
): SynthesizedMusicPcm {
  const arr = TRACK_ARRANGEMENTS[track.id] ?? TRACK_ARRANGEMENTS.zero_hour_overture;
  const sampleRate = Math.min(22050, Math.max(11025, Math.round(targetSampleRate || 22050)));
  const totalSamples = Math.max(sampleRate, Math.floor(sampleRate * track.durationSec));
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  const beatsPerSec = track.bpm / 60;
  const chordBars = arr.progressionSemis.length;
  const secPerChord = track.durationSec / chordBars;
  const twoPi = Math.PI * 2;
  const fadeSamples = Math.floor(sampleRate * 0.12);

  // Subtle low-pass smoothing state for warm cinematic pad & bass tone (avoids harsh aliasing)
  let lpL = 0;
  let lpR = 0;
  let noiseSeed = track.id.split('').reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 17) >>> 0;
  const nextNoise = (): number => {
    noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
    return (noiseSeed / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const chordFloat = t / secPerChord;
    const chordIdx = Math.floor(chordFloat) % chordBars;
    const chordLocal = chordFloat - Math.floor(chordFloat);
    const rootSemi = arr.progressionSemis[chordIdx];
    const bassFreq = arr.rootHz * semiToRatio(rootSemi);

    // 1. Warm minor-triad + 9th atmospheric pad (gentle stereo detune)
    const padFreq1 = bassFreq * 2;
    const padFreq2 = padFreq1 * semiToRatio(3); // minor 3rd
    const padFreq3 = padFreq1 * semiToRatio(7); // 5th
    const padFreq4 = padFreq1 * semiToRatio(14); // 9th shimmer
    const padEnv = 0.72 + 0.28 * Math.sin(twoPi * chordLocal * 0.5);
    const padL =
      (Math.sin(twoPi * padFreq1 * t) * 0.42 +
        Math.sin(twoPi * padFreq2 * 1.002 * t) * 0.3 +
        Math.sin(twoPi * padFreq3 * 0.998 * t) * 0.28) *
      padEnv *
      arr.padGain;
    const padR =
      (Math.sin(twoPi * padFreq1 * 0.999 * t + 0.3) * 0.42 +
        Math.sin(twoPi * padFreq2 * 0.998 * t + 0.6) * 0.3 +
        Math.sin(twoPi * padFreq3 * 1.002 * t + 0.9) * 0.28) *
      padEnv *
      arr.padGain;

    // 2. Driving tactical bassline pulse (sub + warm 2nd harmonic)
    const beatPos = t * beatsPerSec;
    const stepPos = beatPos * arr.pulseSubdivision;
    const stepFrac = stepPos - Math.floor(stepPos);
    const stepIdx = Math.floor(stepPos);
    const bassEnv = Math.exp(-stepFrac * 4.4);
    const bassTone =
      Math.sin(twoPi * bassFreq * t) * 0.72 +
      Math.sin(twoPi * bassFreq * 2 * t) * 0.22 +
      Math.sin(twoPi * bassFreq * 3 * t) * 0.06;
    const bassSample = bassTone * bassEnv * arr.bassGain;

    // 3. Tactical ostinato arpeggio (panned subtly L/R by step parity)
    const arpSemi = arr.arpPattern[stepIdx % arr.arpPattern.length];
    const arpFreq = bassFreq * 4 * semiToRatio(arpSemi);
    const arpEnv = Math.exp(-stepFrac * 6.8) * (stepIdx % 2 === 0 ? 1.0 : 0.68);
    const arpRaw =
      (Math.sin(twoPi * arpFreq * t) * 0.7 + Math.sin(twoPi * arpFreq * 2 * t) * 0.3) *
      arpEnv *
      arr.pulseGain;
    const pan = stepIdx % 2 === 0 ? 0.62 : 0.38;

    // 4. Subtle muted percussion (low kick on beats 1/3, filtered rim/shaker on off-beats)
    const beatFrac = beatPos - Math.floor(beatPos);
    const beatIdx = Math.floor(beatPos) % 4;
    let perc = 0;
    if (beatIdx === 0 || beatIdx === 2) {
      const kickEnv = Math.exp(-beatFrac * 18);
      const kickFreq = 46 + 52 * Math.exp(-beatFrac * 24);
      perc += Math.sin(twoPi * kickFreq * beatFrac / beatsPerSec) * kickEnv * 0.85;
    }
    if (beatIdx === 1 || beatIdx === 3) {
      const snareEnv = Math.exp(-beatFrac * 22);
      perc += nextNoise() * snareEnv * 0.24;
    }
    const hatFrac = (beatPos * 2) - Math.floor(beatPos * 2);
    perc += nextNoise() * Math.exp(-hatFrac * 42) * 0.08;
    const percSample = perc * arr.percussionGain;

    // 5. High ambient shimmer motif
    const shimmer =
      Math.sin(twoPi * padFreq4 * t) *
      (0.5 + 0.5 * Math.sin(twoPi * t * 0.25)) *
      arr.shimmerGain;

    const rawL = padL + bassSample + arpRaw * pan + percSample + shimmer * 0.7;
    const rawR = padR + bassSample + arpRaw * (1 - pan) + percSample + shimmer * 0.9;

    // Gentle 1-pole low-pass warmth filter (~2.8 kHz) so score sits cleanly behind combat SFX
    lpL += (rawL - lpL) * 0.34;
    lpR += (rawR - lpR) * 0.34;

    // Smooth fade-in/fade-out envelope at loop boundary to eliminate any clicks
    let edgeGain = 1.0;
    if (i < fadeSamples) {
      edgeGain = i / fadeSamples;
    } else if (i > totalSamples - fadeSamples) {
      edgeGain = (totalSamples - i) / fadeSamples;
    }

    left[i] = Math.tanh(lpL * 1.15) * 0.68 * edgeGain;
    right[i] = Math.tanh(lpR * 1.15) * 0.68 * edgeGain;
  }

  return {
    left,
    right,
    sampleRate,
    durationSec: totalSamples / sampleRate,
  };
}

/**
 * Synthesizes an original, subtle, seamlessly loopable stereo tactical score AudioBuffer.
 * Uses a compact 22050 Hz sample rate (~2.8 MB per stereo 32s track) and deterministic phase math
 * with smooth loop-boundary crossfade so there are zero clicks or pops.
 */
export function synthesizeMusicTrackBuffer(
  ctx: Pick<AudioContext, 'createBuffer' | 'sampleRate'>,
  track: MusicTrackMetadata
): AudioBuffer {
  const pcm = synthesizeMusicTrackPcm(track, ctx.sampleRate || 22050);
  const buffer = ctx.createBuffer(2, pcm.left.length, pcm.sampleRate);
  buffer.getChannelData(0).set(pcm.left);
  buffer.getChannelData(1).set(pcm.right);
  return buffer;
}
