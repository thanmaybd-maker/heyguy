import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateImage, synthesizeSvgIllustration } from '../src/main/ai/image-gen';

test('generateImage falls back to deterministic SVG illustration when no OpenAI key is provided', async () => {
  const res = await generateImage(
    { openaiKey: '' },
    { prompt: 'Neural telemetry dashboard with glowing nodes', size: '1536x1024' },
    new AbortController().signal,
  );
  assert.equal(res.model, 'heyguy-svg-synth');
  assert.equal(res.size, '1536x1024');
  assert.equal(res.mimeType, 'image/svg+xml');
  assert.ok(res.dataUrl.startsWith('data:image/svg+xml;base64,'));

  const synth = synthesizeSvgIllustration('Quantum circuit layout', '1024x1024');
  assert.equal(synth.mimeType, 'image/svg+xml');
  assert.ok(synth.dataUrl.startsWith('data:image/svg+xml;base64,'));
});

test('generateImage calls OpenAI gpt-image-1 when API key is present and returns PNG dataUrl', async () => {
  const realFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    capturedBody = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const res = await generateImage(
      { openaiKey: 'sk-openai-key' },
      { prompt: 'A glassmorphic widget', size: '1024x1024', quality: 'high' },
      new AbortController().signal,
    );
    assert.equal(res.model, 'gpt-image-1');
    assert.equal(res.mimeType, 'image/png');
    assert.ok(res.dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(capturedBody!['model'], 'gpt-image-1');
    assert.equal(capturedBody!['quality'], 'high');
  } finally {
    globalThis.fetch = realFetch;
  }
});
