// DeepSeek Chat Completions API (deepseek-chat / deepseek-reasoner), streamed over SSE.
// Supports instant UI harness generation, structured scenes, and reasoning_content filtering.
import { postJSON, ApiError } from './http';
import { readSSE } from './sse';
import type { ProviderConfig, VisionRequest } from './types';

const URL = 'https://api.deepseek.com/chat/completions';

interface DeepSeekChunk {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }[];
  error?: { message?: string };
}

export async function* streamDeepSeek(cfg: ProviderConfig, req: VisionRequest): AsyncGenerator<string> {
  // DeepSeek chat/reasoner accepts standard OpenAI-compatible text messages.
  // Screen metadata and spatial context are already embedded in req.prompt via userPreamble.
  const messages: unknown[] = [
    { role: 'system', content: req.system },
    ...req.history.map((t) => ({ role: t.role, content: t.text })),
    { role: 'user', content: req.prompt },
  ];

  const res = await postJSON(
    'DeepSeek',
    URL,
    { Authorization: `Bearer ${cfg.apiKey}` },
    { model: cfg.model || 'deepseek-chat', max_tokens: 4096, stream: true, messages },
    req.signal,
  );

  for await (const ev of readSSE(res)) {
    if (ev.data === '[DONE]') return;
    try {
      const data = JSON.parse(ev.data) as DeepSeekChunk;
      if (data.error) {
        throw new ApiError(`DeepSeek error: ${data.error.message ?? 'stream failed'}`, 500);
      }
      // Skip internal chain-of-thought reasoning_content so only final speakable/visual output streams
      const text = data.choices?.[0]?.delta?.content;
      if (text) yield text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
    }
  }
}

/** Cheap call used by Settings → "Test key". */
export async function pingDeepSeek(cfg: ProviderConfig, signal: AbortSignal): Promise<void> {
  const res = await postJSON(
    'DeepSeek',
    URL,
    { Authorization: `Bearer ${cfg.apiKey}` },
    { model: cfg.model || 'deepseek-chat', max_tokens: 5, messages: [{ role: 'user', content: 'Say hi' }] },
    signal,
  );
  await res.text();
}

