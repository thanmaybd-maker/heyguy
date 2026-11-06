// Image Generation Engine: OpenAI GPT Image (gpt-image-1) via POST /v1/images/generations,
// plus a deterministic high-craft vector illustration synthesizer fallback when offline or keyless.
import { postJSON, ApiError } from './http';

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations';

export type ImageSize = '1024x1024' | '1536x1024' | '1024x1536';
export type ImageQuality = 'low' | 'medium' | 'high' | 'auto';

export interface ImageGenRequest {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  background?: 'transparent' | 'opaque' | 'auto';
  model?: string;
}

export interface ImageGenResult {
  dataUrl: string;
  mimeType: 'image/png' | 'image/svg+xml';
  model: string;
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
}

interface OpenAIImageResponse {
  data?: { b64_json?: string; url?: string }[];
  error?: { message?: string };
}

/** Escape XML special characters for safe SVG synthesis. */
function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Deterministic hash from prompt string for consistent procedural visuals. */
function hashPrompt(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Generates a high-craft architectural/schematic SVG illustration when no live OpenAI key is provided
 * or when local instant synthesis is requested.
 */
export function synthesizeSvgIllustration(prompt: string, size: ImageSize = '1024x1024'): ImageGenResult {
  const [wStr, hStr] = size.split('x');
  const W = Number(wStr) || 1024;
  const H = Number(hStr) || 1024;
  const seed = hashPrompt(prompt || 'HeyGuy Visual');

  const palettes = [
    ['#38bdf8', '#818cf8', '#34d399', '#09090b', '#18181b'],
    ['#f59e0b', '#ec4899', '#6366f1', '#09090b', '#1e1b4b'],
    ['#10b981', '#06b6d4', '#3b82f6', '#09090b', '#0f172a'],
    ['#a855f7', '#38bdf8', '#f43f5e', '#09090b', '#18181b'],
  ];
  const pal = palettes[seed % palettes.length]!;
  const c1 = pal[0]!;
  const c2 = pal[1]!;
  const c3 = pal[2]!;
  const bg1 = pal[3]!;
  const bg2 = pal[4]!;

  const cleanTitle = escXml(prompt.trim().slice(0, 56) || 'Synthesized Concept Visual');
  const words = prompt
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4)
    .map((w) => escXml(w.slice(0, 18)));
  while (words.length < 4) words.push(`Module ${words.length + 1}`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg1}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
    <radialGradient id="glow1" cx="30%" cy="30%" r="55%">
      <stop offset="0%" stop-color="${c1}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${c1}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="75%" cy="70%" r="50%">
      <stop offset="0%" stop-color="${c2}" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="${c2}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#glow1)"/>
  <rect width="${W}" height="${H}" fill="url(#glow2)"/>
  <g transform="translate(${W / 2}, ${H / 2 - 30})">
    <circle r="210" fill="none" stroke="${c1}" stroke-opacity="0.22" stroke-width="1.5" stroke-dasharray="8 8"/>
    <circle r="145" fill="none" stroke="${c2}" stroke-opacity="0.35" stroke-width="2"/>
    <polygon points="0,-110 95,55 -95,55" fill="${c1}" fill-opacity="0.12" stroke="${c1}" stroke-width="2.5"/>
    <polygon points="0,110 95,-55 -95,-55" fill="${c2}" fill-opacity="0.12" stroke="${c2}" stroke-width="2.5"/>
    <circle r="38" fill="${bg1}" stroke="${c3}" stroke-width="3"/>
    <circle r="14" fill="${c3}"/>
    <g transform="translate(-260, -160)">
      <rect width="170" height="64" rx="12" fill="rgba(24,24,27,0.88)" stroke="${c1}" stroke-width="1.5"/>
      <text x="85" y="38" fill="#f4f4f5" font-family="Segoe UI, sans-serif" font-size="16" font-weight="600" text-anchor="middle">${words[0]}</text>
    </g>
    <g transform="translate(90, -160)">
      <rect width="170" height="64" rx="12" fill="rgba(24,24,27,0.88)" stroke="${c2}" stroke-width="1.5"/>
      <text x="85" y="38" fill="#f4f4f5" font-family="Segoe UI, sans-serif" font-size="16" font-weight="600" text-anchor="middle">${words[1]}</text>
    </g>
    <g transform="translate(-260, 110)">
      <rect width="170" height="64" rx="12" fill="rgba(24,24,27,0.88)" stroke="${c3}" stroke-width="1.5"/>
      <text x="85" y="38" fill="#f4f4f5" font-family="Segoe UI, sans-serif" font-size="16" font-weight="600" text-anchor="middle">${words[2]}</text>
    </g>
    <g transform="translate(90, 110)">
      <rect width="170" height="64" rx="12" fill="rgba(24,24,27,0.88)" stroke="${c1}" stroke-width="1.5"/>
      <text x="85" y="38" fill="#f4f4f5" font-family="Segoe UI, sans-serif" font-size="16" font-weight="600" text-anchor="middle">${words[3]}</text>
    </g>
  </g>
  <rect x="64" y="${H - 128}" width="${W - 128}" height="72" rx="14" fill="rgba(9,9,11,0.86)" stroke="rgba(255,255,255,0.14)"/>
  <text x="${W / 2}" y="${H - 85}" fill="#fafafa" font-family="Segoe UI, sans-serif" font-size="20" font-weight="600" text-anchor="middle">${cleanTitle}</text>
</svg>`;

  const b64 = Buffer.from(svg, 'utf8').toString('base64');
  return {
    dataUrl: `data:image/svg+xml;base64,${b64}`,
    mimeType: 'image/svg+xml',
    model: 'heyguy-svg-synth',
    prompt,
    size,
    quality: 'high',
  };
}

/**
 * Generates an image using OpenAI `gpt-image-1` (`POST /v1/images/generations`) when an API key is available,
 * or falls back cleanly to deterministic SVG synthesis when no key is provided.
 */
export async function generateImage(
  cfg: { openaiKey?: string },
  req: ImageGenRequest,
  signal?: AbortSignal,
): Promise<ImageGenResult> {
  const prompt = req.prompt.trim().slice(0, 4000) || 'Conceptual architectural blueprint';
  const size: ImageSize = req.size && ['1024x1024', '1536x1024', '1024x1536'].includes(req.size) ? req.size : '1024x1024';
  const quality: ImageQuality = req.quality && ['low', 'medium', 'high', 'auto'].includes(req.quality) ? req.quality : 'auto';
  const model = req.model?.trim() || 'gpt-image-1';

  const apiKey = cfg.openaiKey?.trim();
  if (!apiKey) {
    return synthesizeSvgIllustration(prompt, size);
  }

  const body: Record<string, unknown> = {
    model,
    prompt,
    size,
    quality,
    n: 1,
  };
  if (req.background && req.background !== 'auto') {
    body.background = req.background;
  }
  // Standard DALL-E models require response_format: 'b64_json'; gpt-image-1 returns b64_json by default
  if (!model.startsWith('gpt-image')) {
    body.response_format = 'b64_json';
  }

  const res = await postJSON(
    'OpenAI Images',
    OPENAI_IMAGES_URL,
    { Authorization: `Bearer ${apiKey}` },
    body,
    signal ?? AbortSignal.timeout(60_000),
  );

  const json = (await res.json()) as OpenAIImageResponse;
  if (json.error) {
    throw new ApiError(`OpenAI Image error: ${json.error.message ?? 'generation failed'}`, 500);
  }
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    throw new ApiError('OpenAI Image response did not contain b64_json image data.', 500);
  }

  return {
    dataUrl: `data:image/png;base64,${b64}`,
    mimeType: 'image/png',
    model,
    prompt,
    size,
    quality,
  };
}

