// Minimal incremental Server-Sent Events parser (spec subset used by Anthropic and Gemini).

export interface SSEEvent {
  event: string;
  data: string;
}

export class SSEParser {
  private buf = '';
  /** a lone trailing "\r" may be the first half of a "\r\n" split across chunks */
  private heldCR = false;

  push(chunk: string): SSEEvent[] {
    let text = (this.heldCR ? '\r' : '') + chunk;
    this.heldCR = text.endsWith('\r');
    if (this.heldCR) text = text.slice(0, -1);
    this.buf += text.replace(/\r\n?/g, '\n');
    const out: SSEEvent[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf('\n\n')) !== -1) {
      const block = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
      if (data.length) out.push({ event, data: data.join('\n') });
    }
    return out;
  }
}

/** Read a fetch Response body as SSE events. */
export async function* readSSE(res: Response): AsyncGenerator<SSEEvent> {
  if (!res.body) throw new Error('Empty response body');
  const parser = new SSEParser();
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) yield ev;
    }
    for (const ev of parser.push(decoder.decode() + '\n\n')) yield ev;
  } finally {
    reader.releaseLock();
  }
}
