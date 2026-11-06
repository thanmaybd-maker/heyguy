// Antigravity harness: HeyGuy runs the user's own, already signed-in, unmodified Antigravity CLI
// (`agy --print --output-format stream-json`). HeyGuy never holds Google credentials: sign-in happens
// inside `agy` itself (documented first-run flow), which is the sanctioned route described in
// docs/FULL-PRODUCT-PLAN.md section 6 ("user-authenticated, unmodified CLI"; "never scrape session files";
// "do not implement our own login"). If `agy` is missing, an optional Gemini API key is used instead.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VisionRequest } from './types';
import { streamGemini } from './gemini';
import { AgySession } from './agy-session';
import type { SceneUI } from '../../shared/scene';

export interface AntigravityConfig {
  accountEmail: string;
  model: string;
  geminiKeyFallback?: string;
  /** model used only when the Gemini API key fallback is active */
  geminiModel?: string;
  /** force a fresh `agy --print` process instead of the warm session (pings, code generation) */
  oneShot?: boolean;
}

export interface AntigravityUsageStats {
  accountEmail: string;
  activeModel: string;
  cliAvailable: boolean;
  cliPath: string;
  totalRequests: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  lastDurationSeconds: number;
  lastConversationId: string;
  lastUpdatedAt: number;
  availableModels: string[];
}

export interface AgyStreamEvent {
  event?: 'init' | 'step_update' | 'result' | string;
  conversation_id?: string;
  init?: {
    model?: string;
    cwd?: string;
  };
  step_update?: {
    conversation_id?: string;
    step_index?: number;
    state?: 'ACTIVE' | 'DONE' | string;
    step_type?: 'user_input' | 'agent_response' | string;
    text_delta?: string;
    duration_seconds?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      thinking_tokens?: number;
      cache_read_tokens?: number;
      total_tokens?: number;
    };
  };
  result?: {
    conversation_id?: string;
    status?: 'SUCCESS' | 'ERROR' | string;
    response?: string;
    duration_seconds?: number;
    num_turns?: number;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      thinking_tokens?: number;
      cache_read_tokens?: number;
      total_tokens?: number;
    };
  };
}

/** Exactly the ids printed by `agy models` on this PC (checked 2026-11-05). */
export const DEFAULT_ANTIGRAVITY_MODELS = [
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'gemini-4-argon-high',
  'gemini-4-argon-medium',
  'gemini-4-argon-low',
  'claude-opus-5-5-high',
  'claude-opus-5-5-medium',
  'claude-opus-5-5-low',
  'claude-sonnet-5-5-high',
  'claude-sonnet-5-5-medium',
  'claude-sonnet-5-5-low',
  'gpt-oss-120b-medium',
];

/** Normalizes friendly model names like `gemini-3.8-flash` to exact `agy` model IDs (`gemini-3.8-flash-high`). */
export function normalizeAntigravityModel(raw: string): string {
  const m = raw.trim().toLowerCase();
  if (!m || m === 'gemini-3.8-flash' || m === 'gemini-3.8') return 'gemini-3.8-flash-high';
  if (m === 'gemini-4-argon' || m === 'argon') return 'gemini-4-argon-high';
  if (m === 'claude-sonnet-5-5') return 'claude-sonnet-5-5-high';
  if (m === 'claude-opus-5-5') return 'claude-opus-5-5-high';
  return raw.trim();
}

/**
 * Opens the Antigravity CLI in its own terminal window so the user can complete its documented
 * first-run sign-in ("On first run, follow the on-screen prompts to authenticate"). HeyGuy never sees
 * or stores the credentials; they stay inside `agy`. Windows only (HeyGuy's target platform).
 */
export function openAgySignIn(): { ok: boolean; message: string } {
  const bin = resolveAgyBinary();
  if (!bin) {
    return { ok: false, message: 'Antigravity CLI (agy) was not found. Install it from antigravity.google first.' };
  }
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Run "agy" in a terminal and sign in there.' };
  }
  const child = spawn('cmd.exe', ['/c', 'start', '', bin], { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
  return {
    ok: true,
    message: 'A terminal opened with Antigravity. Sign in there if it asks, close it, then press Test.',
  };
}

/**
 * Opens an interactive terminal running an agy command (e.g. `/logout` or interactive mode).
 * This allows the user to complete actions that agy refuses in non-interactive/print mode.
 */
export function openAgyInteractive(initialArg?: string): { ok: boolean; message: string } {
  const bin = resolveAgyBinary();
  if (!bin) {
    return { ok: false, message: 'Antigravity CLI (agy) was not found on this PC.' };
  }
  if (process.platform !== 'win32') {
    return { ok: false, message: `Run "agy ${initialArg ?? ''}" in a terminal.` };
  }
  const args = initialArg ? ['/c', 'start', '', bin, initialArg] : ['/c', 'start', '', bin];
  const child = spawn('cmd.exe', args, { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
  // `start` resolves once the terminal is launched, not once agy has run the command, and agy may
  // treat a slash argument as a prompt rather than a slash command. Tell the user the fallback so a
  // sign-out can never silently do nothing.
  const command = initialArg === '/logout' ? 'If /logout did not run by itself, type /logout and press Enter. ' : '';
  return {
    ok: true,
    message: `A terminal opened with Antigravity. ${command}When you are done there, close the window and press Connect Google to sign in with another account.`,
  };
}

/** Resolves the `agy` binary path on Windows/macOS/Linux. */
export function resolveAgyBinary(): string | null {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const winCandidate = path.join(localAppData, 'agy', 'bin', 'agy.exe');
  if (process.platform === 'win32' && existsSync(winCandidate)) {
    return winCandidate;
  }
  const pathEnv = process.env.PATH || '';
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, `agy${ext}`);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

class UsageTracker {
  private stats: AntigravityUsageStats = {
    accountEmail: 'thanmaybd@gmail.com',
    activeModel: 'gemini-3.8-flash-high',
    cliAvailable: false,
    cliPath: '',
    totalRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    lastDurationSeconds: 0,
    lastConversationId: '',
    lastUpdatedAt: Date.now(),
    availableModels: [...DEFAULT_ANTIGRAVITY_MODELS],
  };

  configure(accountEmail: string, model: string): void {
    if (accountEmail.trim()) this.stats.accountEmail = accountEmail.trim();
    if (model.trim()) this.stats.activeModel = normalizeAntigravityModel(model);
    const bin = resolveAgyBinary();
    this.stats.cliAvailable = !!bin;
    this.stats.cliPath = bin ?? '';
  }

  recordUsage(u: {
    model?: string;
    conversationId?: string;
    durationSeconds?: number;
    inputTokens?: number;
    outputTokens?: number;
    thinkingTokens?: number;
    totalTokens?: number;
  }): void {
    this.stats.totalRequests += 1;
    if (u.model) this.stats.activeModel = u.model;
    if (u.conversationId) this.stats.lastConversationId = u.conversationId;
    if (typeof u.durationSeconds === 'number') {
      this.stats.lastDurationSeconds = Math.round(u.durationSeconds * 100) / 100;
    }
    const inTok = u.inputTokens ?? 0;
    const outTok = u.outputTokens ?? 0;
    const thinkTok = u.thinkingTokens ?? 0;
    const totTok = u.totalTokens ?? inTok + outTok + thinkTok;
    this.stats.inputTokens += inTok;
    this.stats.outputTokens += outTok;
    this.stats.thinkingTokens += thinkTok;
    this.stats.totalTokens += totTok;
    this.stats.lastUpdatedAt = Date.now();
  }

  snapshot(accountEmail?: string, model?: string): AntigravityUsageStats {
    if (accountEmail || model) {
      this.configure(accountEmail ?? this.stats.accountEmail, model ?? this.stats.activeModel);
    } else {
      const bin = resolveAgyBinary();
      this.stats.cliAvailable = !!bin;
      this.stats.cliPath = bin ?? '';
    }
    return { ...this.stats, availableModels: [...this.stats.availableModels] };
  }
}

export const antigravityUsage = new UsageTracker();

// ---------------------------------------------------------------- Local `agy` CLI Stream Parser & Runner

/**
 * Parses a single NDJSON line from `agy --print --output-format stream-json`.
 * Returns any text delta and optional completed usage telemetry.
 */
export function parseAgyStreamLine(line: string): {
  textDelta?: string;
  model?: string;
  conversationId?: string;
  finalResponse?: string;
  durationSeconds?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    totalTokens: number;
  };
} | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;
  try {
    const ev = JSON.parse(trimmed) as AgyStreamEvent;
    if (ev.event === 'init') {
      return {
        model: ev.init?.model,
        conversationId: ev.conversation_id,
      };
    }
    if (ev.event === 'step_update' && ev.step_update) {
      const su = ev.step_update;
      const out: ReturnType<typeof parseAgyStreamLine> = {
        conversationId: su.conversation_id,
      };
      if (su.step_type === 'agent_response' && typeof su.text_delta === 'string' && su.text_delta.length > 0) {
        out.textDelta = su.text_delta;
      }
      return out;
    }
    if (ev.event === 'result' && ev.result) {
      const r = ev.result;
      const u = r.usage;
      return {
        conversationId: r.conversation_id,
        finalResponse: typeof r.response === 'string' ? r.response : undefined,
        durationSeconds: r.duration_seconds,
        usage: u
          ? {
              inputTokens: u.input_tokens ?? 0,
              outputTokens: u.output_tokens ?? 0,
              thinkingTokens: u.thinking_tokens ?? 0,
              totalTokens: u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
            }
          : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Spawn runner abstraction so unit tests can mock the `agy` CLI process deterministically. */
export type AgyLineRunner = (
  args: string[],
  signal: AbortSignal,
  onLine: (line: string) => void,
) => Promise<void>;

const defaultAgyRunner: AgyLineRunner = (args, signal, onLine) =>
  new Promise<void>((resolve, reject) => {
    const bin = resolveAgyBinary();
    if (!bin) {
      reject(new Error('Antigravity CLI (agy) was not found on this PC.'));
      return;
    }
    const child = spawn(bin, args, {
      cwd: os.tmpdir(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutBuf += chunk;
      let idx: number;
      while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        onLine(line);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrBuf += chunk;
    });

    child.on('error', (err) => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (stdoutBuf.trim()) {
        onLine(stdoutBuf);
      }
      if (code !== 0 && code !== null) {
        reject(new Error(stderrBuf.trim() || `Antigravity CLI exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });

/**
 * Streams a HeyGuy screen-companion turn through the user's signed-in Antigravity CLI
 * (`agy --print --model <id> --output-format stream-json`). If the CLI is not installed, an optional
 * Gemini API key is used. Nothing is simulated: a failure is reported as an error.
 */
export async function* streamAntigravity(
  cfg: AntigravityConfig,
  req: VisionRequest,
  runner: AgyLineRunner = defaultAgyRunner,
): AsyncGenerator<string> {
  const model = normalizeAntigravityModel(cfg.model);
  antigravityUsage.configure(cfg.accountEmail, model);

  const bin = resolveAgyBinary();
  if (!bin && runner === defaultAgyRunner) {
    if (cfg.geminiKeyFallback) {
      const t0 = performance.now();
      for await (const delta of streamGemini({ apiKey: cfg.geminiKeyFallback, model: cfg.geminiModel || 'gemini-3.8-flash' }, req)) {
        yield delta;
      }
      // The Gemini API adapter does not report token counts, so none are invented: count the request only.
      antigravityUsage.recordUsage({ model: cfg.geminiModel || 'gemini-3.8-flash', durationSeconds: (performance.now() - t0) / 1000 });
      return;
    }
    throw new Error(
      'Antigravity CLI (agy) was not found. Install it from antigravity.google, run "agy" once and sign in, or add a Gemini API key in Settings.',
    );
  }

  if (runner === defaultAgyRunner && bin && !cfg.oneShot) {
    yield* streamViaSession(bin, model, req);
    return;
  }

  let tempShotPath: string | null = null;
  if (req.imageJpegBase64 && runner === defaultAgyRunner) {
    try {
      tempShotPath = path.join(os.tmpdir(), `heyguy-shot-${Date.now()}.jpg`);
      writeFileSync(tempShotPath, Buffer.from(req.imageJpegBase64, 'base64'));
    } catch {
      tempShotPath = null;
    }
  }

  const historyText = req.history.length
    ? req.history.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n') + '\n\n'
    : '';
  const shotNote = tempShotPath
    ? `[Screenshot of the user's screen is at ${tempShotPath} — you may view it with view_file if needed to get exact button coordinates, then answer.]\n`
    : '';
  const combinedPrompt = [
    req.system,
    '',
    historyText + shotNote + req.prompt,
    '',
    'IMPORTANT: Reply as HeyGuy (the desktop screen companion) in short plain text + [POINT:x,y:label] / [CIRCLE:x,y,r:label] / [BOX:x1,y1,x2,y2:label] screen marks + optional <scene>{...}</scene> visual JSON block.',
  ].join('\n');

  const args = [
    '--print',
    combinedPrompt,
    '--model',
    model,
    '--output-format',
    'stream-json',
    '--disable-slash-commands',
  ];
  if (tempShotPath) {
    args.push('--add-dir', os.tmpdir());
  }

  const queue: string[] = [];
  let notifyQueue: (() => void) | null = null;
  let done = false;
  let runError: unknown = null;
  let yieldedAny = false;
  let fallbackFullResponse = '';

  const pushDelta = (text: string) => {
    yieldedAny = true;
    queue.push(text);
    if (notifyQueue) {
      const fn = notifyQueue;
      notifyQueue = null;
      fn();
    }
  };

  const runPromise = runner(args, req.signal, (line) => {
    const parsed = parseAgyStreamLine(line);
    if (!parsed) return;
    if (parsed.textDelta) {
      pushDelta(parsed.textDelta);
    }
    if (parsed.finalResponse) {
      fallbackFullResponse = parsed.finalResponse;
    }
    if (parsed.usage) {
      antigravityUsage.recordUsage({
        model: parsed.model ?? model,
        conversationId: parsed.conversationId,
        durationSeconds: parsed.durationSeconds,
        inputTokens: parsed.usage.inputTokens,
        outputTokens: parsed.usage.outputTokens,
        thinkingTokens: parsed.usage.thinkingTokens,
        totalTokens: parsed.usage.totalTokens,
      });
    }
  })
    .catch((err) => {
      runError = err;
    })
    .finally(() => {
      done = true;
      if (tempShotPath) {
        try {
          unlinkSync(tempShotPath);
        } catch {
          // ignore cleanup failure
        }
      }
      if (notifyQueue) {
        const fn = notifyQueue;
        notifyQueue = null;
        fn();
      }
    });

  while (!done || queue.length > 0) {
    if (queue.length > 0) {
      yield queue.shift()!;
      continue;
    }
    await new Promise<void>((r) => {
      notifyQueue = r;
    });
  }

  await runPromise;
  if (runError) throw runError;
  if (!yieldedAny && fallbackFullResponse) {
    yield fallbackFullResponse;
  }
}

// ---------------------------------------------------------------- warm session

let session: AgySession | null = null;

function getSession(bin: string, model: string): AgySession {
  if (!session) session = new AgySession(bin, model);
  session.setModel(model);
  return session;
}

/** Start the warm process and hand it the system prompt now, so the first real question is fast. */
export async function warmAntigravity(cfg: AntigravityConfig, system: string): Promise<void> {
  const bin = resolveAgyBinary();
  if (!bin) return;
  const s = getSession(bin, normalizeAntigravityModel(cfg.model));
  if (s.primed) return;
  await s.turn(primer(system), AbortSignal.timeout(120_000), () => undefined);
  s.primed = true;
}

/** Forget the CLI-side conversation (new HeyGuy conversation, sign-out, model change). */
export function resetAntigravitySession(): void {
  session?.stop();
}

function primer(system: string): string {
  return [
    system,
    '',
    'You are running inside the HeyGuy desktop companion. For every following message, answer as HeyGuy in short plain text with the screen tags and an optional <scene> block exactly as described above. Do not edit files or run commands unless the user explicitly asks. Reply to this setup message with only: OK',
  ].join('\n');
}

async function* streamViaSession(bin: string, model: string, req: VisionRequest): AsyncGenerator<string> {
  const s = getSession(bin, model);
  if (!s.primed) {
    await s.turn(primer(req.system), req.signal, () => undefined);
    s.primed = true;
  }
  let shotPath: string | null = null;
  if (req.imageJpegBase64) {
    shotPath = path.join(s.cwd, `screen-${Date.now()}.jpg`);
    writeFileSync(shotPath, Buffer.from(req.imageJpegBase64, 'base64'));
  }
  const content = [
    shotPath ? `[The user's screen right now: ${shotPath} — open it with your file viewer before answering if the question is about the screen.]` : '',
    req.prompt,
  ]
    .filter(Boolean)
    .join('\n\n');

  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: unknown = null;
  const done = s
    .turn(content, req.signal, (t) => {
      queue.push(t);
      wake?.();
    })
    .then(
      (r) => {
        if (r.usage) antigravityUsage.recordUsage({ model, ...r.usage });
        else antigravityUsage.recordUsage({ model });
      },
      (e) => {
        failure = e;
      },
    )
    .finally(() => {
      finished = true;
      wake?.();
      if (shotPath) {
        try {
          unlinkSync(shotPath);
        } catch {
          // already gone
        }
      }
    });
  while (!finished || queue.length) {
    if (queue.length) {
      yield queue.shift()!;
      continue;
    }
    await new Promise<void>((r) => (wake = r));
    wake = null;
  }
  await done;
  if (failure) throw failure;
}

/** Run a slash command the CLI answers itself, e.g. `/usage`, as its own `--print` call. */
export async function runAgyCommand(command: '/usage' | '/logout', signal: AbortSignal): Promise<string> {
  const bin = resolveAgyBinary();
  if (!bin) throw new Error('Antigravity CLI (agy) was not found on this PC.');
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['--print', command], { cwd: os.tmpdir(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (err += c));
    const onAbort = () => child.kill();
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `agy ${command} exited with ${code}`));
    });
  });
}

/** Verifies that the signed-in Antigravity CLI (or the Gemini key fallback) really answers with the chosen model. */
export async function pingAntigravity(
  cfg: AntigravityConfig,
  signal: AbortSignal,
  runner: AgyLineRunner = defaultAgyRunner,
): Promise<string> {
  const model = normalizeAntigravityModel(cfg.model);
  const t0 = performance.now();
  let out = '';
  for await (const delta of streamAntigravity(
    { ...cfg, oneShot: true },
    {
      system: 'You are a connectivity check.',
      history: [],
      imageJpegBase64: '',
      prompt: 'Reply with the single word OK.',
      signal,
    },
    runner,
  )) {
    out += delta;
  }
  if (!out.trim()) {
    throw new Error('Antigravity harness returned an empty response.');
  }
  const via = resolveAgyBinary() ? 'Antigravity CLI' : 'Gemini API key';
  return `${via} answered (${model}, ${((performance.now() - t0) / 1000).toFixed(1)}s)`;
}

export interface HeadlessCodeGenRequest {
  prompt: string;
  language?: 'typescript' | 'react-tsx' | 'python' | 'html-app';
  accountEmail: string;
  model: string;
  geminiKeyFallback?: string;
  geminiModel?: string;
}

export interface HeadlessCodeGenResult {
  title: string;
  language: string;
  code: string;
  summary: string;
  scene: SceneUI;
  usage: AntigravityUsageStats;
}

/**
 * Generates an interactive `SceneUI` (`kind: 'ui'`) companion visual + artifact powered by the
 * Google Account Antigravity harness (`gemini-3.8-flash`).
 */
export async function runHeadlessCodeGen(
  req: HeadlessCodeGenRequest,
  signal: AbortSignal,
  runner?: AgyLineRunner,
): Promise<HeadlessCodeGenResult> {
  const model = normalizeAntigravityModel(req.model);
  const lang = req.language ?? 'react-tsx';
  const cleanPrompt = req.prompt.trim() || 'Build a real-time token & latency telemetry component';
  const title = cleanPrompt.slice(0, 56);

  const codePrompt = [
    `Generate complete, production-ready, zero-placeholder ${lang} code for: "${cleanPrompt}".`,
    'Return ONLY the raw source code without markdown triple-backtick fences.',
  ].join('\n');

  let generatedCode = '';
  for await (const delta of streamAntigravity(
    {
      accountEmail: req.accountEmail,
      model,
      geminiKeyFallback: req.geminiKeyFallback,
      geminiModel: req.geminiModel,
      oneShot: true,
    },
    {
      system: 'Output only clean, complete, production-ready source code.',
      history: [],
      imageJpegBase64: '',
      prompt: codePrompt,
      signal,
    },
    runner,
  )) {
    generatedCode += delta;
  }
  generatedCode = generatedCode
    .replace(/^```[a-zA-Z0-9_-]*\r?\n/, '')
    .replace(/\r?\n```\s*$/, '')
    .trim();
  if (!generatedCode) throw new Error('The model returned no code. Nothing was saved.');

  const stats = antigravityUsage.snapshot(req.accountEmail, model);
  const lineCount = generatedCode.split(/\r?\n/).length;

  const scene: SceneUI = {
    kind: 'ui',
    id: `agy-harness-${Date.now().toString(36).slice(-5)}`,
    title: `Antigravity (${stats.activeModel}): ${title}`,
    subtitle: `Google Account: ${stats.accountEmail} · ${stats.totalTokens.toLocaleString()} tokens used`,
    layout: 'dashboard',
    widgets: [
      {
        id: 'w-status',
        kind: 'metric',
        label: 'Active Brain',
        detail: `Connected as ${stats.accountEmail} running ${stats.activeModel}.`,
        tone: 'good',
        span: 1,
        value: stats.activeModel,
        badge: stats.cliAvailable ? 'Antigravity CLI' : 'Gemini API key',
        body: `Last response took ${stats.lastDurationSeconds}s.`,
      },
      {
        id: 'w-usage',
        kind: 'metric',
        label: 'Google Account Usage',
        detail: `Session token utilization for ${stats.accountEmail} across ${stats.totalRequests} turns.`,
        tone: 'accent',
        span: 1,
        value: `${stats.totalTokens.toLocaleString()} tok`,
        delta: `${stats.totalRequests} turns`,
        trend: 'up',
        progress: Math.min(100, Math.max(8, Math.round((stats.totalTokens / 100_000) * 100))),
        badge: stats.accountEmail,
        body: `In: ${stats.inputTokens.toLocaleString()} · Out: ${stats.outputTokens.toLocaleString()} · Think: ${stats.thinkingTokens.toLocaleString()}`,
      },
      {
        id: 'w-code',
        kind: 'code',
        label: `Generated Output (${lineCount} lines)`,
        detail: `Saved to Workspace Artifacts.`,
        tone: 'default',
        span: 2,
        language: lang,
        code: generatedCode.slice(0, 1600),
        badge: 'Artifact',
      },
    ],
    steps: [
      { caption: `Connected to ${stats.accountEmail} on ${stats.activeModel}.`, focus: ['w-status', 'w-usage'] },
      { caption: 'The generated code is saved to Workspace Artifacts.', focus: ['w-code'] },
    ],
  };

  return {
    title: `Harness: ${title}`,
    language: lang,
    code: generatedCode,
    summary: `Completed with ${stats.activeModel} (${stats.accountEmail}).`,
    scene,
    usage: stats,
  };
}
