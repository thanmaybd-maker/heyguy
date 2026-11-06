import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_ANTIGRAVITY_MODELS,
  normalizeAntigravityModel,
  parseAgyStreamLine,
  streamAntigravity,
  runHeadlessCodeGen,
  antigravityUsage,
  type AgyLineRunner,
} from '../src/main/ai/antigravity';
import { validateScene } from '../src/shared/scene';

test('normalizeAntigravityModel maps gemini-3.8-flash shorthand to gemini-3.8-flash-high', () => {
  assert.equal(normalizeAntigravityModel('gemini-3.8-flash'), 'gemini-3.8-flash-high');
  assert.equal(normalizeAntigravityModel('gemini-3.8-flash-medium'), 'gemini-3.8-flash-medium');
  assert.equal(normalizeAntigravityModel('gemini-4-argon'), 'gemini-4-argon-high');
});

test('parseAgyStreamLine parses init, step_update text_delta, and result usage telemetry', () => {
  const init = parseAgyStreamLine('{"event":"init","conversation_id":"conv-1","init":{"model":"gemini-3.8-flash-high"}}');
  assert.equal(init?.model, 'gemini-3.8-flash-high');
  assert.equal(init?.conversationId, 'conv-1');

  const delta = parseAgyStreamLine(
    '{"event":"step_update","step_update":{"conversation_id":"conv-1","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"Hello from Gemini 3.8 Flash"}}',
  );
  assert.equal(delta?.textDelta, 'Hello from Gemini 3.8 Flash');

  const res = parseAgyStreamLine(
    '{"event":"result","result":{"conversation_id":"conv-1","status":"SUCCESS","response":"Hello","duration_seconds":2.4,"usage":{"input_tokens":1200,"output_tokens":80,"thinking_tokens":40,"total_tokens":1320}}}',
  );
  assert.equal(res?.durationSeconds, 2.4);
  assert.deepEqual(res?.usage, {
    inputTokens: 1200,
    outputTokens: 80,
    thinkingTokens: 40,
    totalTokens: 1320,
  });
});

test('streamAntigravity streams text deltas and records Google Account usage telemetry', async () => {
  const mockRunner: AgyLineRunner = async (args, _signal, onLine) => {
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('gemini-3.8-flash-high'));
    onLine('{"event":"init","conversation_id":"c-42","init":{"model":"gemini-3.8-flash-high"}}');
    onLine('{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"Part 1 "}}');
    onLine('{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"Part 2"}}');
    onLine(
      '{"event":"result","result":{"conversation_id":"c-42","status":"SUCCESS","duration_seconds":1.5,"usage":{"input_tokens":500,"output_tokens":50,"thinking_tokens":10,"total_tokens":560}}}',
    );
  };

  const before = antigravityUsage.snapshot('thanmaybd@gmail.com', 'gemini-3.8-flash');
  let out = '';
  for await (const chunk of streamAntigravity(
    { accountEmail: 'thanmaybd@gmail.com', model: 'gemini-3.8-flash' },
    { system: 'sys', history: [], imageJpegBase64: '', prompt: 'test', signal: new AbortController().signal },
    mockRunner,
  )) {
    out += chunk;
  }
  assert.equal(out, 'Part 1 Part 2');

  const after = antigravityUsage.snapshot();
  assert.equal(after.accountEmail, 'thanmaybd@gmail.com');
  assert.equal(after.activeModel, 'gemini-3.8-flash-high');
  assert.equal(after.totalRequests, before.totalRequests + 1);
  assert.equal(after.totalTokens, before.totalTokens + 560);
});

test('runHeadlessCodeGen generates code and a validated SceneUI harness without a code editor', async () => {
  const mockRunner: AgyLineRunner = async (_args, _signal, onLine) => {
    onLine('{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"export const ready = true;\\n"}}');
    onLine('{"event":"result","result":{"conversation_id":"c-99","status":"SUCCESS","duration_seconds":1.1,"usage":{"input_tokens":300,"output_tokens":40,"thinking_tokens":15,"total_tokens":355}}}');
  };

  const res = await runHeadlessCodeGen(
    {
      prompt: 'Build a token limiter component',
      language: 'typescript',
      accountEmail: 'thanmaybd@gmail.com',
      model: 'gemini-3.8-flash',
    },
    new AbortController().signal,
    mockRunner,
  );

  assert.equal(res.code, 'export const ready = true;');
  assert.equal(res.usage.accountEmail, 'thanmaybd@gmail.com');
  assert.equal(res.scene.kind, 'ui');
  const validated = validateScene(res.scene);
  assert.ok(validated.ok, JSON.stringify(validated));
});


test('runHeadlessCodeGen fails loudly instead of inventing code when the model returns nothing', async () => {
  const silentRunner: AgyLineRunner = async () => undefined;
  await assert.rejects(
    runHeadlessCodeGen(
      { prompt: 'anything', accountEmail: 'a@example.com', model: 'gemini-3.8-flash' },
      new AbortController().signal,
      silentRunner,
    ),
    /returned no code/,
  );
});

test('every listed model id is already in exact agy form', () => {
  for (const id of DEFAULT_ANTIGRAVITY_MODELS) assert.equal(normalizeAntigravityModel(id), id);
});

test('antigravity adapter never embeds Google client secrets or private Cloud Code endpoints', () => {
  const src = readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai', 'antigravity.ts'), 'utf8');
  for (const banned of ['GOCSPX', 'client_secret', 'cloudcode-pa', 'oauth2.googleapis.com', 'refresh_token']) {
    assert.ok(!src.includes(banned), 'found banned string: ' + banned);
  }
});
