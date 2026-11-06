// Text-to-speech using the OS voices (Windows SAPI via Chromium's speechSynthesis).
// Free, offline, and starts speaking sentence by sentence while the reply streams.
import { speakable } from '../../shared/sentences';

export interface SpeechCallbacks {
  onStart: () => void;
  onEnd: () => void;
  onBoundary: () => void;
  onSentenceStart?: (sentence: string, index: number, total: number) => void;
  onSentenceEnd?: (sentence: string, index: number, total: number) => void;
}

const PREFERRED = [/natural/i, /aria/i, /jenny/i, /heera/i, /zira/i, /neerja/i, /^Google US English/i];

export class Speaker {
  private pending = 0;
  /** bumped on stop() so callbacks from cancelled utterances are ignored */
  private generation = 0;
  private queuedSentences = 0;
  private voice: SpeechSynthesisVoice | null = null;
  enabled = true;
  rate = 1.05;
  private voiceName = '';

  constructor(private readonly cb: SpeechCallbacks) {
    speechSynthesis.addEventListener('voiceschanged', () => this.pickVoice());
    this.pickVoice();
  }

  setVoice(name: string): void {
    this.voiceName = name;
    this.pickVoice();
  }

  private pickVoice(): void {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    const named = this.voiceName ? voices.find((v) => v.name === this.voiceName) : undefined;
    if (named) {
      this.voice = named;
      return;
    }
    const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    for (const re of PREFERRED) {
      const v = english.find((x) => re.test(x.name));
      if (v) {
        this.voice = v;
        return;
      }
    }
    this.voice = english[0] ?? voices[0] ?? null;
  }

  get speaking(): boolean {
    return this.pending > 0;
  }

  say(text: string): void {
    if (!this.enabled) return;
    const clean = speakable(text);
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    if (this.voice) u.voice = this.voice;
    u.rate = this.rate;
    u.pitch = 1.05;
    const gen = this.generation;
    const sIndex = this.queuedSentences++;
    u.onstart = () => {
      if (gen === this.generation) {
        this.cb.onStart();
        this.cb.onSentenceStart?.(clean, sIndex, this.queuedSentences);
      }
    };
    u.onboundary = () => this.cb.onBoundary();
    const finish = () => {
      if (gen !== this.generation) return;
      this.cb.onSentenceEnd?.(clean, sIndex, this.queuedSentences);
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) {
        this.queuedSentences = 0;
        this.cb.onEnd();
      }
    };
    u.onend = finish;
    u.onerror = finish;
    this.pending++;
    speechSynthesis.speak(u);
  }

  stop(): void {
    const was = this.pending > 0;
    this.generation++;
    this.pending = 0;
    this.queuedSentences = 0;
    speechSynthesis.cancel();
    if (was) this.cb.onEnd();
  }
}
