// AudioWorklet that forwards raw mono Float32 frames + an RMS level to the main thread.
// Minimal declarations: AudioWorkletGlobalScope isn't in TypeScript's DOM lib.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (ch && ch.length) {
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!;
      const copy = new Float32Array(ch);
      this.port.postMessage({ samples: copy, rms: Math.sqrt(sum / ch.length) }, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor('heyguy-recorder', RecorderProcessor);
