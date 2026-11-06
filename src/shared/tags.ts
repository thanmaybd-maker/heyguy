// Streaming parser for the drawing tags the model embeds in its reply, e.g.
//   [POINT:640,380:Save button]   [CIRCLE:300,200,40:error icon]
//   [BOX:10,20,300,90:menu]       [ARROW:100,100,400,300:drag here]
//   [UNDERLINE:120,410,380:this line]
// Tags are removed from the visible/spoken text and returned separately.
import type { RawAnnotation } from './types';

const TAG_RE = /\[\s*(POINT|CIRCLE|BOX|ARROW|UNDERLINE)\s*:([^\]\n]{0,300})\]/gi;
/** Something that could still grow into a tag: "[", "[POI", "[POINT:12,3" ... */
const PARTIAL_RE = /^\[\s*[A-Za-z]*\s*(:[^\]\n]*)?$/;
const MAX_PARTIAL = 320;

const ARITY: Record<RawAnnotation['kind'], number> = {
  point: 2,
  circle: 3,
  box: 4,
  arrow: 4,
  underline: 3,
};

/** Parse one tag body ("640,380:Save button") for a given kind. Returns null if malformed. */
export function parseTagBody(kindRaw: string, body: string): RawAnnotation | null {
  const kind = kindRaw.toLowerCase() as RawAnnotation['kind'];
  const n = ARITY[kind];
  if (n === undefined) return null;
  const colon = body.indexOf(':');
  const numsPart = colon === -1 ? body : body.slice(0, colon);
  const label = colon === -1 ? '' : body.slice(colon + 1).trim();
  const nums = numsPart.split(',').map((s) => Number(s.trim()));
  if (nums.length !== n || nums.some((v) => !Number.isFinite(v))) return null;
  switch (kind) {
    case 'point':
      return { kind, x: nums[0]!, y: nums[1]!, label };
    case 'circle':
      return { kind, x: nums[0]!, y: nums[1]!, r: Math.abs(nums[2]!), label };
    case 'box':
      return { kind, x1: nums[0]!, y1: nums[1]!, x2: nums[2]!, y2: nums[3]!, label };
    case 'arrow':
      return { kind, x1: nums[0]!, y1: nums[1]!, x2: nums[2]!, y2: nums[3]!, label };
    case 'underline':
      return { kind, x1: nums[0]!, y: nums[1]!, x2: nums[2]!, label };
  }
}

export interface TagChunk {
  text: string;
  tags: RawAnnotation[];
}

/** Incremental parser: feed model deltas, get clean text plus any completed tags. */
export class TagStream {
  private pending = '';

  push(delta: string): TagChunk {
    this.pending += delta;
    const tags: RawAnnotation[] = [];
    let text = '';
    let last = 0;
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(this.pending)) !== null) {
      text += this.pending.slice(last, m.index);
      const parsed = parseTagBody(m[1]!, m[2]!);
      if (parsed) tags.push(parsed);
      last = m.index + m[0].length;
    }
    let rest = this.pending.slice(last);
    // Hold back a trailing fragment that may be the start of a tag.
    const open = rest.lastIndexOf('[');
    if (open !== -1) {
      const tail = rest.slice(open);
      if (tail.length <= MAX_PARTIAL && PARTIAL_RE.test(tail)) {
        text += rest.slice(0, open);
        this.pending = tail;
        return { text, tags };
      }
    }
    text += rest;
    this.pending = '';
    return { text, tags };
  }

  /** End of stream: whatever is held back is plain text. */
  flush(): TagChunk {
    const text = this.pending;
    this.pending = '';
    return { text, tags: [] };
  }
}

/** Remove all tags from a finished string (used for history and speech). */
export function stripTags(s: string): string {
  return s.replace(TAG_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?;:])/g, '$1').trim();
}
