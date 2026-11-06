import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downsample, encodeWav } from '../src/renderer/overlay/voice';

test('downsample 48k -> 16k keeps duration', () => {
  const input = new Float32Array(48_000).fill(0.5);
  const out = downsample(input, 48_000, 16_000);
  assert.equal(out.length, 16_000);
  assert.ok(Math.abs(out[100]! - 0.5) < 1e-6);
});

test('encodeWav writes a valid PCM header', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1]), 16_000);
  const v = new DataView(wav.buffer);
  const tag = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(v.getUint32(24, true), 16_000);
  assert.equal(v.getUint32(40, true), 6);
  assert.equal(v.getInt16(46, true), 32767);
  assert.equal(v.getInt16(48, true), -32768);
  assert.equal(wav.byteLength, 50);
});
