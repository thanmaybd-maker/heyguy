// Chrome native messaging protocol handler for browser agent sessions.
// Implements 32-bit framed message I/O, tab tracking, and DOM query/click coordination.
import { EventEmitter } from 'node:events';

export interface BrowserTab {
  id: number;
  url: string;
  title: string;
  active: boolean;
}

export interface BrowserCommand {
  id: string;
  action: 'query_tabs' | 'navigate' | 'extract_content' | 'click_element';
  params?: Record<string, unknown>;
}

export interface BrowserResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export class BrowserBridge extends EventEmitter {
  private pending = new Map<string, { resolve: (res: BrowserResponse) => void; reject: (err: Error) => void }>();

  /** Encode a JSON payload into Chrome native messaging 32-bit framed buffer */
  static encodeNativeMessage(payload: unknown): Buffer {
    const json = JSON.stringify(payload);
    const body = Buffer.from(json, 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]);
  }

  /** Decode incoming binary chunks with 32-bit framing into JSON payloads */
  static decodeNativeMessage(buffer: Buffer): { message: unknown; remaining: Buffer } | null {
    if (buffer.length < 4) return null;
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) return null;
    const body = buffer.subarray(4, 4 + len);
    const remaining = buffer.subarray(4 + len);
    try {
      const message = JSON.parse(body.toString('utf8'));
      return { message, remaining };
    } catch {
      return null;
    }
  }

  handleIncomingResponse(res: BrowserResponse): void {
    const promise = this.pending.get(res.id);
    if (promise) {
      this.pending.delete(res.id);
      promise.resolve(res);
    }
    this.emit('response', res);
  }

  async sendCommand(action: BrowserCommand['action'], params?: Record<string, unknown>, timeoutMs = 15000): Promise<BrowserResponse> {
    const id = Math.random().toString(36).slice(2);
    const cmd: BrowserCommand = { id, action, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Browser action "${action}" timed out.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.emit('outgoing', cmd);
    });
  }
}

