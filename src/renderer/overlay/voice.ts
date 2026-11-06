// Push-to-talk microphone recorder with simple voice-activity detection.
// Produces a 16 kHz mono 16-bit WAV, which every speech model accepts.

const TARGET_RATE = 16_000;
const SPEECH_RMS = 0.025;
const END_SILENCE_MS = 1600;
const NO_SPEECH_TIMEOUT_MS = 8000;
const MAX_MS = 30_000;

export type StopReason = 'manual' | 'silence' | 'max' | 'no-speech';

export interface RecorderCallbacks {
  onLevel: (level: number) => void;
  onAutoStop: (reason: StopReason) => void;
}

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private heardSpeechAt = 0;
  private lastLoudAt = 0;
  private stopped = false;

  constructor(private readonly cb: RecorderCallbacks) {}

  get active(): boolean {
    return this.ctx !== null && !this.stopped;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule('recorder-worklet.js');
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'heyguy-recorder');
    this.node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; rms: number }>) => this.onFrame(e.data);
    src.connect(this.node);
    this.chunks = [];
    this.stopped = false;
    this.startedAt = performance.now();
    this.heardSpeechAt = 0;
    this.lastLoudAt = 0;
  }

  private onFrame({ samples, rms }: { samples: Float32Array; rms: number }): void {
    if (this.stopped) return;
    this.chunks.push(samples);
    const now = performance.now();
    this.cb.onLevel(Math.min(1, rms * 9));
    if (rms > SPEECH_RMS) {
      if (!this.heardSpeechAt) this.heardSpeechAt = now;
      this.lastLoudAt = now;
    }
    if (now - this.startedAt > MAX_MS) this.cb.onAutoStop('max');
    else if (this.heardSpeechAt && now - this.lastLoudAt > END_SILENCE_MS) this.cb.onAutoStop('silence');
    else if (!this.heardSpeechAt && now - this.startedAt > NO_SPEECH_TIMEOUT_MS) this.cb.onAutoStop('no-speech');
  }

  /** Stop and return the WAV bytes (null if nothing was said). */
  async stop(): Promise<Uint8Array | null> {
    if (this.stopped && !this.ctx) return null;
    this.stopped = true;
    const rate = this.ctx?.sampleRate ?? 48_000;
    const heard = this.heardSpeechAt !== 0;
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.node = null;
    this.stream = null;
    const chunks = this.chunks;
    this.chunks = [];
    if (!heard) return null;
    return encodeWav(downsample(concat(chunks), rate, TARGET_RATE), TARGET_RATE);
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Box-filter downsampling: average the source samples that fall in each target sample. */
export function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j]!;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}
