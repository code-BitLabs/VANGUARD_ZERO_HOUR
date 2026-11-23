import { ProceduralPattern, synthesizePbrPixels } from '@/src/core/pbrSynthesisCore';

interface PbrSynthRequest {
  requestId: number;
  pattern: ProceduralPattern;
  size: number;
}

interface PbrSynthResponse {
  requestId: number;
  pattern: ProceduralPattern;
  size: number;
  albedoData: Uint8Array;
  normalData: Uint8Array;
  rmData: Uint8Array;
  estimatedBytes: number;
}

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<PbrSynthRequest>) => void) | null;
  postMessage: (msg: PbrSynthResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (ev: MessageEvent<PbrSynthRequest>) => {
  const { requestId, pattern, size } = ev.data;
  const result = synthesizePbrPixels(pattern, size);
  const response: PbrSynthResponse = {
    requestId,
    pattern,
    size,
    albedoData: result.albedoData,
    normalData: result.normalData,
    rmData: result.rmData,
    estimatedBytes: result.estimatedBytes,
  };
  workerScope.postMessage(response, [
    result.albedoData.buffer,
    result.normalData.buffer,
    result.rmData.buffer,
  ]);
};
