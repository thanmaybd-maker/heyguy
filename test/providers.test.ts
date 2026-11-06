import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamClaude } from '../src/main/ai/anthropic';
import { streamGemini } from '../src/main/ai/gemini';
import { streamOpenAI } from '../src/main/ai/openai';
import { streamDeepSeek } from '../src/main/ai/deepseek';

function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

const req = { system: 's', history: [], imageJpegBase64: 'AAAA', prompt: 'p', signal: new AbortController().signal };

test('Claude stream yields text deltas and sends image + headers', async () => {
  const realFetch = globalThis.fetch;
  let sent: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return sseResponse([
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\nevent: content_block_delta\ndata: {"type":"content_block_d',
      'elta","delta":{"type":"text_delta","text":"lo [POINT:1,2:x]"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
  }) as typeof fetch;
  try {
    let out = '';
    for await (const t of streamClaude({ apiKey: 'k', model: 'm' }, req)) out += t;
    assert.equal(out, 'Hello [POINT:1,2:x]');
    const headers = sent!.init.headers as Record<string, string>;
    assert.equal(headers['x-api-key'], 'k');
    const body = JSON.parse(String(sent!.init.body));
    assert.equal(body.messages[0].content[0].type, 'image');
    assert.equal(body.stream, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Gemini stream skips thought parts', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    sseResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"hmm","thought":true}]}}]}\r\n\r\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"Answer"}]}}]}\r\n\r\n',
    ])) as typeof fetch;
  try {
    let out = '';
    for await (const t of streamGemini({ apiKey: 'k', model: 'm' }, req)) out += t;
    assert.equal(out, 'Answer');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('401 becomes a readable error', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(async () => {
      for await (const _ of streamClaude({ apiKey: 'bad', model: 'm' }, req)) void _;
    }, /rejected the API key/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('OpenAI stream yields text deltas and formats vision message', async () => {
  const realFetch = globalThis.fetch;
  let sent: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"Here "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"is an engine"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
  }) as typeof fetch;
  try {
    let out = '';
    for await (const t of streamOpenAI({ apiKey: 'sk-test', model: 'gpt-4o' }, req)) out += t;
    assert.equal(out, 'Here is an engine');
    const headers = sent!.init.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer sk-test');
    const body = JSON.parse(String(sent!.init.body));
    assert.equal(body.model, 'gpt-4o');
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[1].content[1].type, 'image_url');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('DeepSeek stream skips reasoning_content and yields content deltas', async () => {
  const realFetch = globalThis.fetch;
  let sent: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent = { url, init };
    return sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"thinking step 1..."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"DeepSeek "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"UI ready"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
  }) as typeof fetch;
  try {
    let out = '';
    for await (const t of streamDeepSeek({ apiKey: 'sk-ds', model: 'deepseek-reasoner' }, req)) out += t;
    assert.equal(out, 'DeepSeek UI ready');
    assert.equal(sent!.url, 'https://api.deepseek.com/chat/completions');
    const headers = sent!.init.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer sk-ds');
  } finally {
    globalThis.fetch = realFetch;
  }
});
