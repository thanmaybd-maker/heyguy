import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnManager } from '../src/main/turns';
import { decodeSecret, encodeSecret, type Cipher } from '../src/main/secrets';
import { userPreamble, systemPrompt } from '../src/main/ai/prompt';

import { pickSource } from '../src/main/capture-pick';

test('a newer turn makes the older one stale; only the owner can end', () => {
  const t = new TurnManager();
  const a = t.begin();
  const b = t.begin();
  assert.equal(a.controller.signal.aborted, true, 'starting B cancels A');
  assert.equal(t.isCurrent(a), false);
  assert.equal(t.isCurrent(b), true);
  assert.equal(t.end(a), false, 'A finishing late does not release B');
  assert.equal(t.isCurrent(b), true);
  assert.equal(t.end(b), true);
  assert.equal(t.active, null);
  const c = t.begin();
  t.cancel();
  assert.equal(c.controller.signal.aborted, true);
});

const fakeCipher = (available: boolean): Cipher => ({
  available: async () => available,
  encrypt: async (p) => Buffer.from([...Buffer.from(p)].map((x) => x ^ 0x5a)),
  decrypt: async (d) => Buffer.from([...d].map((x) => x ^ 0x5a)).toString(),
});

test('secrets: encrypted when possible, never persisted otherwise', async () => {
  const on = fakeCipher(true);
  const off = fakeCipher(false);
  const enc = (await encodeSecret('sk-123', on))!;
  assert.match(enc, /^enc:/);
  assert.ok(!enc.includes('sk-123'));
  assert.deepEqual(await decodeSecret(enc, on), { value: 'sk-123', legacyPlain: false });
  assert.equal(await encodeSecret('sk-123', off), null, 'no encryption -> refuse to persist');
  assert.equal(await encodeSecret('', off), '', 'clearing is always allowed');
  const legacy = 'raw:' + Buffer.from('sk-old').toString('base64');
  assert.deepEqual(await decodeSecret(legacy, off), { value: 'sk-old', legacyPlain: true });
  assert.equal((await decodeSecret(enc, off)).value, '', 'cannot decrypt without the OS key');
});

test('capture never falls back to a different screen on multi-monitor', () => {
  const sources = [{ display_id: '11' }, { display_id: '22' }];
  assert.deepEqual(pickSource(sources, 22, 2), { display_id: '22' });
  assert.equal(pickSource(sources, 33, 2), null);
  assert.equal(pickSource([{ display_id: '' }], 7, 1)?.display_id, '', 'single screen with blank id is fine');
  assert.equal(pickSource([{ display_id: '' }], 7, 2), null);
});

test('prompt carries the open scene and the selected part', () => {
  const p = userPreamble({ imageWidth: 100, imageHeight: 50, cursorX: 1, cursorY: 2 }, 'why does it move?', {
    scene: '{"id":"engine"}',
    selection: { sceneTitle: 'Engine', itemId: 'piston', label: 'Piston', detail: 'slides' },
  });
  assert.match(p, /\{"id":"engine"\}/);
  assert.match(p, /selected "Piston" \(id piston\)/);
  assert.match(p, /User: why does it move\?/);
});

test('prompt carries highlighted spatial screen region when user snips an area', () => {
  const p = userPreamble({ imageWidth: 1920, imageHeight: 1080, cursorX: 500, cursorY: 300 }, 'what is this?', {
    scene: null,
    selection: null,
    spatialSelection: { x: 200, y: 150, width: 400, height: 250 },
  });
  assert.match(p, /highlighted \/ circled a screen region: from \(200, 150\) to \(600, 400\) in screenshot pixels/);
  assert.match(p, /User: what is this\?/);
});

test('systemPrompt: documents marks, 2D/3D visual contract, extended shapes, and scene-patches', () => {
  const sp = systemPrompt();
  // Marks
  assert.match(sp, /\[POINT:x,y:short label\]/);
  assert.match(sp, /\[CIRCLE:x,y,radius:short label\]/);
  assert.match(sp, /\[BOX:x1,y1,x2,y2:short label\]/);
  assert.match(sp, /\[UNDERLINE:x1,y,x2:short label\]/);
  assert.match(sp, /\[ARROW:x1,y1,x2,y2:short label\]/);
  // Visual contract & scenes
  assert.match(sp, /<scene>\{ ...JSON... \}<\/scene>/);
  assert.match(sp, /"kind":"2d"/);
  assert.match(sp, /"kind":"3d"/);
  // Extended shapes
  assert.match(sp, /tube\|ring\|prism\|wedge/);
  // Scene patches
  assert.match(sp, /<scene-patch>/);
});
