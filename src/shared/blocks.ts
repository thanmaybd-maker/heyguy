// Splits a streamed model reply into visible text and <scene>…</scene> or <scene-patch>…</scene-patch> blocks.
// Scene JSON is never shown or spoken; it is validated and rendered instead.

const TAGS = [
  { open: '<scene>', close: '</scene>' },
  { open: '<scene-patch>', close: '</scene-patch>' },
] as const;
const MAX_BLOCK = 24_000;

export interface BlockChunk {
  text: string;
  blocks: string[];
  /** true while inside an unfinished block (UI can show "drawing…") */
  inBlock: boolean;
}

/** Longest suffix of `s` that is a proper prefix of any tag open token. */
function partialSuffix(s: string): number {
  let maxHold = 0;
  for (const t of TAGS) {
    for (let n = Math.min(t.open.length - 1, s.length); n > 0; n--) {
      if (t.open.startsWith(s.slice(-n).toLowerCase())) {
        if (n > maxHold) maxHold = n;
      }
    }
  }
  return maxHold;
}

export class SceneBlockStream {
  private buf = '';
  private currentCloseTag: string | null = null;

  push(delta: string): BlockChunk {
    this.buf += delta;
    let text = '';
    const blocks: string[] = [];
    for (;;) {
      if (!this.currentCloseTag) {
        // Find whichever open tag occurs earliest
        let earliestAt = -1;
        let matchedTag: (typeof TAGS)[number] | null = null;
        for (const t of TAGS) {
          const at = this.buf.toLowerCase().indexOf(t.open);
          if (at !== -1 && (earliestAt === -1 || at < earliestAt)) {
            earliestAt = at;
            matchedTag = t;
          }
        }

        if (earliestAt === -1) {
          const hold = partialSuffix(this.buf);
          text += this.buf.slice(0, this.buf.length - hold);
          this.buf = this.buf.slice(this.buf.length - hold);
          break;
        }
        text += this.buf.slice(0, earliestAt);
        this.buf = this.buf.slice(earliestAt + matchedTag!.open.length);
        this.currentCloseTag = matchedTag!.close;
      } else {
        const end = this.buf.toLowerCase().indexOf(this.currentCloseTag);
        if (end === -1) {
          if (this.buf.length > MAX_BLOCK) {
            // runaway block: drop it rather than buffer forever
            this.buf = '';
            this.currentCloseTag = null;
          }
          break;
        }
        blocks.push(this.buf.slice(0, end));
        this.buf = this.buf.slice(end + this.currentCloseTag.length);
        this.currentCloseTag = null;
      }
    }
    return { text, blocks, inBlock: this.currentCloseTag !== null };
  }

  /** End of stream. An unterminated block is returned so the caller can try to salvage it. */
  flush(): { text: string; unterminated: string | null } {
    const rest = this.buf;
    this.buf = '';
    if (this.currentCloseTag !== null) {
      this.currentCloseTag = null;
      return { text: '', unterminated: rest };
    }
    return { text: rest, unterminated: null };
  }
}

/** Remove scene blocks from a finished string (history/speech). */
export function stripSceneBlocks(s: string): string {
  return s
    .replace(/<scene>[\s\S]*?(<\/scene>|$)/gi, '')
    .replace(/<scene-patch>[\s\S]*?(<\/scene-patch>|$)/gi, '')
    .trim();
}
