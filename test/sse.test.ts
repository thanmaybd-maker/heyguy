import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SSEParser } from '../src/main/ai/sse';

test('parses events split across chunks, CRLF, comments and multi-line data', () => {
  const p = new SSEParser();
  const stream = ': ping\r\n\r\nevent: content_block_delta\r\ndata: {"a":1}\r\n\r\ndata: line1\ndata: line2\n\n';
  const out = [];
  for (const ch of stream) out.push(...p.push(ch));
  assert.deepEqual(out, [
    { event: 'content_block_delta', data: '{"a":1}' },
    { event: 'message', data: 'line1\nline2' },
  ]);
});
