import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserBridge } from '../src/main/browser/bridge';

test('BrowserBridge: encodes and decodes Chrome 32-bit framed native messages', () => {
  const payload = { action: 'query_tabs', params: { activeOnly: true } };

  // 1. Encode
  const encoded = BrowserBridge.encodeNativeMessage(payload);
  assert.ok(encoded.length > 4);

  // Check 32-bit length header
  const expectedLen = Buffer.from(JSON.stringify(payload), 'utf8').length;
  const headerLen = encoded.readUInt32LE(0);
  assert.equal(headerLen, expectedLen);

  // 2. Decode
  const decoded = BrowserBridge.decodeNativeMessage(encoded);
  assert.ok(decoded);
  assert.deepEqual(decoded.message, payload);
  assert.equal(decoded.remaining.length, 0);

  // Partial buffer returns null
  assert.equal(BrowserBridge.decodeNativeMessage(encoded.subarray(0, 3)), null);
  assert.equal(BrowserBridge.decodeNativeMessage(encoded.subarray(0, 8)), null);
});

