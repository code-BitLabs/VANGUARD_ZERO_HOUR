import { MusicTrackMetadata, synthesizeMusicTrackPcm } from '@/src/audio/MusicCatalog';

export interface AudioSynthWorkerRequest {
  readonly requestId: number;
  readonly track: MusicTrackMetadata;
  readonly sampleRate: number;
}

export interface AudioSynthWorkerResponse {
  readonly requestId: number;
  readonly left?: Float32Array;
  readonly right?: Float32Array;
  readonly sampleRate?: number;
  readonly error?: string;
}

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<AudioSynthWorkerRequest>) => void) | null;
  postMessage: (message: AudioSynthWorkerResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (ev: MessageEvent<AudioSynthWorkerRequest>) => {
  const { requestId, track, sampleRate } = ev.data;
  try {
    const pcm = synthesizeMusicTrackPcm(track, sampleRate);
    workerScope.postMessage(
      {
        requestId,
        left: pcm.left,
        right: pcm.right,
        sampleRate: pcm.sampleRate,
      },
      [pcm.left.buffer, pcm.right.buffer]
    );
  } catch (err) {
    workerScope.postMessage({
      requestId,
      error: err instanceof Error ? err.message : 'Procedural audio synthesis failed',
    });
  }
};
