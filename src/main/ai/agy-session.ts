// A warm, long-lived Antigravity CLI process (`agy --input-format stream-json
// --output-format stream-json`). Starting `agy` costs several seconds and the
// first turn re-reads a ~30k-token agent prompt; a kept-alive session answers
// follow-up turns in about a second (documented "Stream prompts from stdin").
// Auth stays inside the official CLI: we only write prompts to its stdin and
// read its documented NDJSON stdout.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAgyStreamLine } from './antigravity';

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  durationSeconds?: number;
  conversationId?: string;
}

interface PendingTurn {
  onDelta: (text: string) => void;
  resolve: (r: { text: string; usage?: TurnUsage }) => void;
  reject: (err: Error) => void;
  text: string;
}

export type Spawner = (bin: string, args: string[], cwd: string) => ChildProcessWithoutNullStreams;

const defaultSpawner: Spawner = (bin, args, cwd) => spawn(bin, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

/** Restart after this many turns so the CLI-side conversation doesn't grow without bound. */
const MAX_TURNS_PER_PROCESS = 24;

export class AgySession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private stderr = '';
  private pending: PendingTurn | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private turnsInProcess = 0;
  /** true once the system prompt has been delivered to the current process */
  primed = false;
  readonly cwd: string;

  constructor(
    private readonly bin: string,
    private model: string,
    private readonly spawner: Spawner = defaultSpawner,
  ) {
    this.cwd = path.join(os.tmpdir(), 'heyguy-agy');
    mkdirSync(this.cwd, { recursive: true });
  }

  get alive(): boolean {
    return this.child !== null;
  }

  setModel(model: string): void {
    if (model !== this.model) {
      this.model = model;
      this.stop();
    }
  }

  private start(): void {
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--model', this.model, '--add-dir', this.cwd];
    const child = this.spawner(this.bin, args, this.cwd);
    this.child = child;
    this.buf = '';
    this.stderr = '';
    this.primed = false;
    this.turnsInProcess = 0;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4000);
    });
    const onGone = (why: string) => {
      if (this.child !== child) return;
      this.child = null;
      this.primed = false;
      const p = this.pending;
      this.pending = null;
      p?.reject(new Error(this.stderr.trim().split('\n').slice(-3).join(' ') || why));
    };
    child.on('error', (err) => onGone(err.message));
    child.on('close', (code) => onGone(`Antigravity CLI stopped (exit ${code ?? 'signal'})`));
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      this.onLine(line);
    }
  }

  private onLine(line: string): void {
    const p = this.pending;
    if (!p) return;
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let ev: { event?: string; result?: { status?: string; error?: string } };
    try {
      ev = JSON.parse(trimmed);
    } catch {
      return;
    }
    const parsed = parseAgyStreamLine(trimmed);
    if (parsed?.textDelta) {
      p.text += parsed.textDelta;
      p.onDelta(parsed.textDelta);
    }
    if (ev.event === 'result') {
      this.pending = null;
      if (ev.result?.status && ev.result.status !== 'SUCCESS') {
        p.reject(new Error(ev.result.error || `Antigravity turn ended with ${ev.result.status}`));
        return;
      }
      const text = p.text || parsed?.finalResponse || '';
      p.resolve({
        text,
        usage: parsed?.usage ? { ...parsed.usage, durationSeconds: parsed.durationSeconds, conversationId: parsed.conversationId } : undefined,
      });
    }
  }

  /**
   * Run one turn. Turns are serialized. Aborting kills the process (a running
   * agent turn can't be interrupted over stdin); the next turn starts a fresh one.
   */
  turn(content: string, signal: AbortSignal, onDelta: (text: string) => void): Promise<{ text: string; usage?: TurnUsage }> {
    const run = () =>
      new Promise<{ text: string; usage?: TurnUsage }>((resolve, reject) => {
        if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        if (this.turnsInProcess >= MAX_TURNS_PER_PROCESS) this.stop();
        if (!this.child) this.start();
        const onAbort = () => {
          if (this.pending === pending) this.pending = null;
          this.stop();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        const pending: PendingTurn = {
          onDelta,
          text: '',
          resolve: (r) => {
            signal.removeEventListener('abort', onAbort);
            resolve(r);
          },
          reject: (e) => {
            signal.removeEventListener('abort', onAbort);
            reject(e);
          },
        };
        this.pending = pending;
        signal.addEventListener('abort', onAbort, { once: true });
        this.turnsInProcess++;
        const msg = JSON.stringify({ event: 'user', message: { content } }) + '\n';
        this.child!.stdin.write(msg);
      });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  stop(): void {
    const c = this.child;
    this.child = null;
    this.primed = false;
    if (c) {
      try {
        c.stdin.end();
        c.kill();
      } catch {
        // already gone
      }
    }
  }
}
