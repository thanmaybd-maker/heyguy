// Claude Messages API, streamed over SSE. No SDK needed.
import { postJSON, ApiError } from './http';
import { readSSE } from './sse';
import type { ProviderConfig, VisionRequest } from './types';

const URL = 'https://api.anthropic.com/v1/messages';

interface StreamEvent {
  type: string;
  delta?: { type: string; text?: string };
  error?: { message?: string };
}

export async function* streamClaude(cfg: ProviderConfig, req: VisionRequest): AsyncGenerator<string> {
  const messages = [
    ...req.history.map((t) => ({ role: t.role, content: t.text })),
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: req.imageJpegBase64 } },
        { type: 'text', text: req.prompt },
      ],
    },
  ];
  const res = await postJSON(
    'Claude',
    URL,
    { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    { model: cfg.model, max_tokens: 4096, system: req.system, stream: true, messages },
    req.signal,
  );
  for await (const ev of readSSE(res)) {
    const data = JSON.parse(ev.data) as StreamEvent;
    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && data.delta.text) {
      yield data.delta.text;
    } else if (data.type === 'error') {
      throw new ApiError(`Claude error: ${data.error?.message ?? 'stream failed'}`, 500);
    } else if (data.type === 'message_stop') {
      return;
    }
  }
}

/** Cheap call used by Settings → "Test key". */
export async function pingClaude(cfg: ProviderConfig, signal: AbortSignal): Promise<void> {
  const res = await postJSON(
    'Claude',
    URL,
    { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    { model: cfg.model, max_tokens: 5, messages: [{ role: 'user', content: 'Say hi' }] },
    signal,
  );
  await res.text();
}
