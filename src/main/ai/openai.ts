// OpenAI Chat Completions API with vision, streamed over SSE. No SDK needed.
import { postJSON, ApiError } from './http';
import { readSSE } from './sse';
import type { ProviderConfig, VisionRequest } from './types';

const URL = 'https://api.openai.com/v1/chat/completions';

interface StreamChunk {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
  error?: { message?: string };
}

export async function* streamOpenAI(cfg: ProviderConfig, req: VisionRequest): AsyncGenerator<string> {
  const messages: unknown[] = [
    { role: 'system', content: req.system },
    ...req.history.map((t) => ({ role: t.role, content: t.text })),
    {
      role: 'user',
      content: [
        { type: 'text', text: req.prompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${req.imageJpegBase64}`,
            detail: 'auto',
          },
        },
      ],
    },
  ];

  const res = await postJSON(
    'OpenAI',
    URL,
    { Authorization: `Bearer ${cfg.apiKey}` },
    { model: cfg.model, max_tokens: 4096, stream: true, messages },
    req.signal,
  );

  for await (const ev of readSSE(res)) {
    if (ev.data === '[DONE]') return;
    try {
      const data = JSON.parse(ev.data) as StreamChunk;
      if (data.error) {
        throw new ApiError(`OpenAI error: ${data.error.message ?? 'stream failed'}`, 500);
      }
      const text = data.choices?.[0]?.delta?.content;
      if (text) yield text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // skip malformed chunks
    }
  }
}

/** Cheap call used by Settings → "Test key". */
export async function pingOpenAI(cfg: ProviderConfig, signal: AbortSignal): Promise<void> {
  const res = await postJSON(
    'OpenAI',
    URL,
    { Authorization: `Bearer ${cfg.apiKey}` },
    { model: cfg.model, max_tokens: 5, messages: [{ role: 'user', content: 'Say hi' }] },
    signal,
  );
  await res.text();
}

