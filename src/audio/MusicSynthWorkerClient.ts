import { MusicTrackMetadata, synthesizeMusicTrackPcm } from './MusicCatalog';
import type { AudioSynthWorkerResponse } from '@/src/workers/audioSynth.worker';

interface PendingSynthJob {
  resolve: (result: { left: Float32Array; right: Float32Array; sampleRate: number }) => void;
  reject: (err: Error) => void;
}

/**
 * Off-thread procedural music synthesizer client.
 * - Lazily spawns `audioSynth.worker.ts` in browser runtimes so 32s stereo DSP never blocks combat frames.
 * - Transfers Float32Array PCM buffers with O(1) zero-copy ownership transfer.
 * - Falls back cleanly to deterministic synchronous synthesis in headless/Node environments.
 */
export class MusicSynthWorkerClient {
  private worker: Worker | null = null;
  private workerFailed = false;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingSynthJob>();

  public async synthesizeTrackBuffer(
    ctx: Pick<AudioContext, 'createBuffer' | 'sampleRate'>,
    track: MusicTrackMetadata
  ): Promise<AudioBuffer> {
    const targetRate = ctx.sampleRate || 22050;
    const pcm = await this.synthesizePcm(track, targetRate);
    const buffer = ctx.createBuffer(2, pcm.left.length, pcm.sampleRate);
    buffer.getChannelData(0).set(pcm.left);
    buffer.getChannelData(1).set(pcm.right);
    return buffer;
  }

  public async synthesizePcm(
    track: MusicTrackMetadata,
    sampleRate = 22050
  ): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number }> {
    const worker = this.ensureWorker();
    if (!worker) {
      const pcm = synthesizeMusicTrackPcm(track, sampleRate);
      return { left: pcm.left, right: pcm.right, sampleRate: pcm.sampleRate };
    }

    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        worker.postMessage({ requestId, track, sampleRate });
      } catch {
        this.pending.delete(requestId);
        this.workerFailed = true;
        this.terminateWorker();
        const pcm = synthesizeMusicTrackPcm(track, sampleRate);
        resolve({ left: pcm.left, right: pcm.right, sampleRate: pcm.sampleRate });
      }
    });
  }

  private ensureWorker(): Worker | null {
    if (this.workerFailed) return null;
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') return null;

    try {
      const w = new Worker(new URL('../workers/audioSynth.worker.ts', import.meta.url), {
        type: 'module',
      });
      w.onmessage = (ev: MessageEvent<AudioSynthWorkerResponse>) => {
        const msg = ev.data;
        const job = this.pending.get(msg.requestId);
        if (!job) return;
        this.pending.delete(msg.requestId);
        if (msg.error || !msg.left || !msg.right || !msg.sampleRate) {
          job.reject(new Error(msg.error ?? 'Invalid worker audio buffer'));
        } else {
          job.resolve({ left: msg.left, right: msg.right, sampleRate: msg.sampleRate });
        }
      };
      w.onerror = () => {
        this.workerFailed = true;
        this.rejectPending('Audio synthesizer worker failed');
        this.terminateWorker();
      };
      this.worker = w;
      return w;
    } catch {
      this.workerFailed = true;
      return null;
    }
  }

  private rejectPending(reason: string): void {
    const err = new Error(reason);
    for (const job of this.pending.values()) {
      job.reject(err);
    }
    this.pending.clear();
  }

  private terminateWorker(): void {
    if (!this.worker) return;
    try {
      this.worker.terminate();
    } catch {
      // ignore
    }
    this.worker = null;
  }

  public dispose(): void {
    this.rejectPending('MusicSynthWorkerClient disposed');
    this.terminateWorker();
  }
}
