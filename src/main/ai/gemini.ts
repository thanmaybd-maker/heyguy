// Gemini generateContent / streamGenerateContent over REST. Also used for speech-to-text.
import { postJSON } from './http';
import { readSSE } from './sse';
import { TRANSCRIBE_PROMPT } from './prompt';
import type { ProviderConfig, VisionRequest } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface Part {
  text?: string;
  thought?: boolean;
}
interface GenResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

function textOf(r: GenResponse): string {
  const parts = r.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

export async function* streamGemini(cfg: ProviderConfig, req: VisionRequest): AsyncGenerator<string> {
  const contents = [
    ...req.history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
    {
      role: 'user',
      parts: [{ inlineData: { mimeType: 'image/jpeg', data: req.imageJpegBase64 } }, { text: req.prompt }],
    },
  ];
  const res = await postJSON(
    'Gemini',
    `${BASE}/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`,
    { 'x-goog-api-key': cfg.apiKey },
    { systemInstruction: { parts: [{ text: req.system }] }, contents, generationConfig: { maxOutputTokens: 8192 } },
    req.signal,
  );
  for await (const ev of readSSE(res)) {
    const data = JSON.parse(ev.data) as GenResponse;
    if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request (${data.promptFeedback.blockReason}).`);
    const t = textOf(data);
    if (t) yield t;
  }
}

/** Speech-to-text: send a 16 kHz mono WAV, get back the transcript ('' if silence). */
export async function transcribeGemini(cfg: ProviderConfig, wav: Uint8Array, signal: AbortSignal): Promise<string> {
  const res = await postJSON(
    'Gemini',
    `${BASE}/${encodeURIComponent(cfg.model)}:generateContent`,
    { 'x-goog-api-key': cfg.apiKey },
    {
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: 'audio/wav', data: Buffer.from(wav).toString('base64') } }, { text: TRANSCRIBE_PROMPT }],
        },
      ],
      generationConfig: { maxOutputTokens: 1024, temperature: 0 },
    },
    signal,
  );
  const text = textOf((await res.json()) as GenResponse).trim();
  return text === '<silence>' ? '' : text;
}

export async function pingGemini(cfg: ProviderConfig, signal: AbortSignal): Promise<void> {
  const res = await postJSON(
    'Gemini',
    `${BASE}/${encodeURIComponent(cfg.model)}:generateContent`,
    { 'x-goog-api-key': cfg.apiKey },
    { contents: [{ role: 'user', parts: [{ text: 'Say hi' }] }], generationConfig: { maxOutputTokens: 16 } },
    signal,
  );
  await res.text();
}
