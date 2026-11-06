// Shared HTTP helpers: retries for transient failures, readable error messages.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504, 529]);

function friendly(provider: string, status: number, body: string): string {
  let detail = '';
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    detail = j.error?.message ?? '';
  } catch {
    detail = body.slice(0, 200);
  }
  if (status === 401 || status === 403) return `${provider} rejected the API key. Open Settings and check it. ${detail}`.trim();
  if (status === 404) return `${provider} model not found — check the model name in Settings. ${detail}`.trim();
  if (status === 429) return `${provider} rate limit hit. Wait a moment and try again. ${detail}`.trim();
  return `${provider} error ${status}: ${detail || 'request failed'}`;
}

/** POST JSON with up to 2 retries on transient errors (before any streaming starts). */
export async function postJSON(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
    if (res.ok) return res;
    const text = await res.text();
    if (TRANSIENT.has(res.status) && attempt < 2) {
      attempt++;
      await new Promise((r) => setTimeout(r, 1200 * attempt));
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      continue;
    }
    throw new ApiError(friendly(provider, res.status, text), res.status);
  }
}
