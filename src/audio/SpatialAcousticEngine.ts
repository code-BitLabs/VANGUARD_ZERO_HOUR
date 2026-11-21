import { ImpactSurfaceMaterial } from '@/src/effects/SurfaceDecalManager';
import { AudioDynamicRange } from '@/src/schemas/settings.schema';

export type AcousticSpaceProfileId =
  | 'open_urban'
  | 'interior_room'
  | 'warehouse'
  | 'bunker'
  | 'jungle'
  | 'foundry'
  | 'enclosed_vehicle';

export interface AcousticSpaceSpec {
  id: AcousticSpaceProfileId;
  label: string;
  reverbDecaySec: number;
  wetGain: number;
  lowpassCutoffHz: number;
  earlyReflectionMs: number;
}

export const ACOUSTIC_SPACE_PROFILES: Record<AcousticSpaceProfileId, AcousticSpaceSpec> = {
  open_urban: {
    id: 'open_urban',
    label: 'Open Urban Canyon',
    reverbDecaySec: 1.15,
    wetGain: 0.24,
    lowpassCutoffHz: 11500,
    earlyReflectionMs: 28,
  },
  interior_room: {
    id: 'interior_room',
    label: 'Enclosed Interior Room',
    reverbDecaySec: 0.65,
    wetGain: 0.38,
    lowpassCutoffHz: 7800,
    earlyReflectionMs: 11,
  },
  warehouse: {
    id: 'warehouse',
    label: 'Industrial Warehouse',
    reverbDecaySec: 1.95,
    wetGain: 0.44,
    lowpassCutoffHz: 9400,
    earlyReflectionMs: 36,
  },
  bunker: {
    id: 'bunker',
    label: 'Reinforced Concrete Bunker',
    reverbDecaySec: 1.45,
    wetGain: 0.52,
    lowpassCutoffHz: 6200,
    earlyReflectionMs: 14,
  },
  jungle: {
    id: 'jungle',
    label: 'Dense Jungle Canopy',
    reverbDecaySec: 0.85,
    wetGain: 0.22,
    lowpassCutoffHz: 8400,
    earlyReflectionMs: 22,
  },
  foundry: {
    id: 'foundry',
    label: 'Cavernous Steel Foundry',
    reverbDecaySec: 2.35,
    wetGain: 0.5,
    lowpassCutoffHz: 10200,
    earlyReflectionMs: 42,
  },
  enclosed_vehicle: {
    id: 'enclosed_vehicle',
    label: 'Armored Vehicle Cabin',
    reverbDecaySec: 0.35,
    wetGain: 0.28,
    lowpassCutoffHz: 3200,
    earlyReflectionMs: 7,
  },
};

export interface MaterialAcousticSignature {
  surface: ImpactSurfaceMaterial;
  footstepPitchHz: number;
  footstepFilterHz: number;
  footstepDurationSec: number;
  impactRingHz: number;
  impactRicochetGain: number;
  impactNoiseDurationSec: number;
}

export const MATERIAL_ACOUSTIC_SIGNATURES: Record<
  ImpactSurfaceMaterial,
  MaterialAcousticSignature
> = {
  concrete: {
    surface: 'concrete',
    footstepPitchHz: 145,
    footstepFilterHz: 1400,
    footstepDurationSec: 0.085,
    impactRingHz: 920,
    impactRicochetGain: 0.14,
    impactNoiseDurationSec: 0.13,
  },
  asphalt: {
    surface: 'asphalt',
    footstepPitchHz: 130,
    footstepFilterHz: 1650,
    footstepDurationSec: 0.08,
    impactRingHz: 860,
    impactRicochetGain: 0.12,
    impactNoiseDurationSec: 0.12,
  },
  metal: {
    surface: 'metal',
    footstepPitchHz: 320,
    footstepFilterHz: 3400,
    footstepDurationSec: 0.11,
    impactRingHz: 2450,
    impactRicochetGain: 0.65,
    impactNoiseDurationSec: 0.24,
  },
  industrial: {
    surface: 'industrial',
    footstepPitchHz: 240,
    footstepFilterHz: 2800,
    footstepDurationSec: 0.1,
    impactRingHz: 1980,
    impactRicochetGain: 0.52,
    impactNoiseDurationSec: 0.22,
  },
  wood: {
    surface: 'wood',
    footstepPitchHz: 185,
    footstepFilterHz: 1150,
    footstepDurationSec: 0.095,
    impactRingHz: 620,
    impactRicochetGain: 0.08,
    impactNoiseDurationSec: 0.15,
  },
  sand: {
    surface: 'sand',
    footstepPitchHz: 95,
    footstepFilterHz: 950,
    footstepDurationSec: 0.12,
    impactRingHz: 380,
    impactRicochetGain: 0.02,
    impactNoiseDurationSec: 0.14,
  },
  mud: {
    surface: 'mud',
    footstepPitchHz: 82,
    footstepFilterHz: 780,
    footstepDurationSec: 0.14,
    impactRingHz: 310,
    impactRicochetGain: 0.02,
    impactNoiseDurationSec: 0.16,
  },
  glass: {
    surface: 'glass',
    footstepPitchHz: 480,
    footstepFilterHz: 4800,
    footstepDurationSec: 0.09,
    impactRingHz: 3850,
    impactRicochetGain: 0.72,
    impactNoiseDurationSec: 0.26,
  },
};

export interface SpatialAudioComputeInput {
  listenerPos: { x: number; y: number; z: number };
  listenerForward: { x: number; z: number };
  sourcePos: { x: number; y: number; z: number };
  occluded: boolean;
  maxDistanceM?: number;
}

export interface SpatialAudioSolution {
  gain: number;
  stereoPan: number; // -1..1
  lowpassHz: number;
  distanceM: number;
}

/**
 * Pure deterministic spatial audio math (distance attenuation, stereo azimuth pan,
 * and occlusion low-pass cutoff) used both by native Web Audio nodes and unit tests.
 */
export function computeSpatialAttenuation(input: SpatialAudioComputeInput): SpatialAudioSolution {
  const dx = input.sourcePos.x - input.listenerPos.x;
  const dy = input.sourcePos.y - input.listenerPos.y;
  const dz = input.sourcePos.z - input.listenerPos.z;
  const distanceM = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const maxDist = input.maxDistanceM ?? 140;

  // Inverse-distance rolloff with smooth tail cutoff
  const refDist = 4.5;
  const rawGain = distanceM <= refDist ? 1.0 : refDist / (refDist + (distanceM - refDist) * 0.42);
  const edgeFade = distanceM >= maxDist ? 0 : Math.max(0, 1 - Math.pow(distanceM / maxDist, 3));
  const occlusionFactor = input.occluded ? 0.52 : 1.0;
  const gain = Number(Math.max(0, Math.min(1, rawGain * edgeFade * occlusionFactor)).toFixed(4));

  // Right vector in XZ plane from forward (fx, fz) -> (-fz, fx)
  const fwdLen = Math.hypot(input.listenerForward.x, input.listenerForward.z) || 1;
  const fx = input.listenerForward.x / fwdLen;
  const fz = input.listenerForward.z / fwdLen;
  const rightX = -fz;
  const rightZ = fx;
  const horizDist = Math.hypot(dx, dz) || 1;
  const dotRight = (dx / horizDist) * rightX + (dz / horizDist) * rightZ;
  const stereoPan = Number(Math.max(-1, Math.min(1, dotRight)).toFixed(3));

  // Air absorption + wall occlusion low-pass
  const distCutoff = Math.max(1800, 14000 - distanceM * 85);
  const lowpassHz = Math.round(input.occluded ? Math.min(distCutoff, 1150) : distCutoff);

  return { gain, stereoPan, lowpassHz, distanceM: Number(distanceM.toFixed(2)) };
}

/**
 * TRN-53 Native Web Audio Spatial Acoustics & Material Foley Engine.
 * - Manages ONE shared ConvolverNode reverb bus (never spawns per-sound convolvers).
 * - Switches between 7 environmental acoustic spaces cleanly.
 * - Synthesizes material-aware footsteps & bullet impacts with dynamic-range compression and radio ducking.
 */
export class SpatialAcousticEngine {
  private activeSpace: AcousticSpaceProfileId = 'open_urban';
  private dynamicRange: AudioDynamicRange = 'tactical';
  private spatialEnabled = true;
  private reverbEnabled = true;
  private radioDuckingActive = false;

  private sharedConvolver: ConvolverNode | null = null;
  private sharedWetGain: GainNode | null = null;
  private sharedSpaceFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  public configure(opts: {
    spatialEnabled?: boolean;
    reverbEnabled?: boolean;
    dynamicRange?: AudioDynamicRange;
  }): void {
    if (opts.spatialEnabled !== undefined) this.spatialEnabled = opts.spatialEnabled;
    if (opts.reverbEnabled !== undefined) this.reverbEnabled = opts.reverbEnabled;
    if (opts.dynamicRange !== undefined) this.dynamicRange = opts.dynamicRange;
    this.applySpaceParameters();
  }

  public setAcousticSpace(space: AcousticSpaceProfileId, ctx?: AudioContext | null): void {
    this.activeSpace = space;
    if (ctx) {
      this.ensureSharedReverbBus(ctx);
      this.rebuildImpulseResponse(ctx, ACOUSTIC_SPACE_PROFILES[space]);
    }
    this.applySpaceParameters();
  }

  public getAcousticSpace(): AcousticSpaceSpec {
    return ACOUSTIC_SPACE_PROFILES[this.activeSpace];
  }

  public setRadioDucking(active: boolean): void {
    this.radioDuckingActive = active;
    this.applySpaceParameters();
  }

  public getEffectiveDynamicRangeRatio(): number {
    if (this.dynamicRange === 'night_mode') return 0.65;
    if (this.dynamicRange === 'cinema') return 1.15;
    return 1.0;
  }

  /**
   * Plays a surface-classified footstep or bullet-impact foley event using native Web Audio.
   */
  public playMaterialEvent(
    ctx: AudioContext | null,
    destination: AudioNode | null,
    kind: 'footstep' | 'impact',
    surface: ImpactSurfaceMaterial,
    spatial: SpatialAudioComputeInput | null,
    volumeScale = 1.0
  ): void {
    if (!ctx || !destination || ctx.state !== 'running') return;
    this.ensureSharedReverbBus(ctx, destination);

    const sig = MATERIAL_ACOUSTIC_SIGNATURES[surface] ?? MATERIAL_ACOUSTIC_SIGNATURES.concrete;
    const sol =
      this.spatialEnabled && spatial
        ? computeSpatialAttenuation(spatial)
        : { gain: 1.0, stereoPan: 0, lowpassHz: 12000, distanceM: 0 };
    if (sol.gain <= 0.01) return;

    const now = ctx.currentTime;
    const dur = kind === 'footstep' ? sig.footstepDurationSec : sig.impactNoiseDurationSec;
    const duckMul = this.radioDuckingActive ? 0.62 : 1.0;
    const finalGain = Math.min(
      0.95,
      sol.gain * volumeScale * duckMul * this.getEffectiveDynamicRangeRatio()
    );

    // 1. Filtered noise burst (textured surface transient)
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = this.getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = kind === 'footstep' ? 'bandpass' : 'lowpass';
    filter.frequency.setValueAtTime(
      Math.min(sol.lowpassHz, kind === 'footstep' ? sig.footstepFilterHz : sig.footstepFilterHz * 1.4),
      now
    );
    filter.Q.setValueAtTime(kind === 'footstep' ? 1.8 : 0.9, now);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(finalGain * (kind === 'footstep' ? 0.34 : 0.48), now + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, now + dur);

    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.setValueAtTime(sol.stereoPan, now);
      noiseSrc.connect(filter).connect(env).connect(panner).connect(destination);
      if (this.reverbEnabled && this.sharedConvolver) {
        panner.connect(this.sharedConvolver);
      }
    } else {
      noiseSrc.connect(filter).connect(env).connect(destination);
    }

    noiseSrc.start(now);
    noiseSrc.stop(now + dur + 0.02);

    // 2. Metallic / glass tonal ricochet resonance on hard surfaces
    if (kind === 'impact' && sig.impactRicochetGain > 0.1) {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = surface === 'glass' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(sig.impactRingHz, now);
      osc.frequency.exponentialRampToValueAtTime(sig.impactRingHz * 0.58, now + dur);
      oscGain.gain.setValueAtTime(finalGain * sig.impactRicochetGain * 0.28, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(oscGain).connect(panner ?? destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    }
  }

  public dispose(): void {
    try {
      this.sharedConvolver?.disconnect();
      this.sharedSpaceFilter?.disconnect();
      this.sharedWetGain?.disconnect();
    } catch {
      // Ignore already-disconnected nodes
    }
    this.sharedConvolver = null;
    this.sharedSpaceFilter = null;
    this.sharedWetGain = null;
    this.noiseBuffer = null;
  }

  private ensureSharedReverbBus(ctx: AudioContext, destination?: AudioNode): void {
    if (this.sharedConvolver) return;
    if (typeof ctx.createConvolver !== 'function') return;
    this.sharedConvolver = ctx.createConvolver();
    this.sharedSpaceFilter = ctx.createBiquadFilter();
    this.sharedSpaceFilter.type = 'lowpass';
    this.sharedWetGain = ctx.createGain();
    this.rebuildImpulseResponse(ctx, ACOUSTIC_SPACE_PROFILES[this.activeSpace]);
    this.sharedConvolver.connect(this.sharedSpaceFilter);
    this.sharedSpaceFilter.connect(this.sharedWetGain);
    this.sharedWetGain.connect(destination ?? ctx.destination);
    this.applySpaceParameters();
  }

  private rebuildImpulseResponse(ctx: AudioContext, spec: AcousticSpaceSpec): void {
    if (!this.sharedConvolver) return;
    const rate = ctx.sampleRate || 44100;
    const len = Math.max(1024, Math.floor(rate * Math.min(2.4, spec.reverbDecaySec)));
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
      }
    }
    this.sharedConvolver.buffer = ir;
  }

  private applySpaceParameters(): void {
    const spec = ACOUSTIC_SPACE_PROFILES[this.activeSpace];
    if (this.sharedSpaceFilter) {
      this.sharedSpaceFilter.frequency.value = spec.lowpassCutoffHz;
    }
    if (this.sharedWetGain) {
      this.sharedWetGain.gain.value = this.reverbEnabled
        ? spec.wetGain * (this.radioDuckingActive ? 0.55 : 1.0)
        : 0;
    }
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const len = Math.floor((ctx.sampleRate || 44100) * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate || 44100);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
    return buf;
  }
}
