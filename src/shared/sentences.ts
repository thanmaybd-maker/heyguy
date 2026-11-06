// Splits streaming text into speakable sentences so text-to-speech can start
// before the whole reply has arrived.

const END_RE = /([.!?…]+["')\]]*)(\s+|$)|\n{1,}/g;
const MIN_CHARS = 24;

export class SentenceChunker {
  private buf = '';

  /** Add streamed text; returns zero or more complete sentences. */
  push(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    let cut = 0;
    END_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = END_RE.exec(this.buf)) !== null) {
      const end = m.index + m[0].length;
      // a terminator at the very end of the buffer might be "3." of "3.5" — wait for more text
      if (m[2] === '' && m[1] !== undefined) break;
      const candidate = this.buf.slice(cut, end).trim();
      if (candidate.length >= MIN_CHARS || m[0].includes('\n')) {
        if (candidate) out.push(candidate);
        cut = end;
      }
    }
    this.buf = this.buf.slice(cut);
    return out;
  }

  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = '';
    return rest ? [rest] : [];
  }
}

/** Light cleanup so TTS doesn't read markdown symbols aloud. */
export function speakable(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[*_#>]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
