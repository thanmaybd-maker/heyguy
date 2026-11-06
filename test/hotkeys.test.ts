import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HOTKEYS, acceleratorFromKey, prettyAccelerator, validateAccelerator } from '../src/shared/hotkeys';

const k = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

test('defaults are valid and never use Ctrl+Alt (HeyClicky / AltGr grab those)', () => {
  for (const accel of Object.values(DEFAULT_HOTKEYS)) {
    assert.equal(validateAccelerator(accel), null, accel);
    assert.ok(!(accel.includes('Control') && accel.includes('Alt')), accel);
  }
  assert.equal(new Set(Object.values(DEFAULT_HOTKEYS)).size, Object.keys(DEFAULT_HOTKEYS).length, 'no duplicates');
});

test('keydown -> accelerator', () => {
  assert.equal(acceleratorFromKey(k('Space', { ctrlKey: true, shiftKey: true })), 'Control+Shift+Space');
  assert.equal(acceleratorFromKey(k('KeyY', { altKey: true, metaKey: true })), 'Alt+Super+Y');
  assert.equal(acceleratorFromKey(k('F9', { ctrlKey: true })), 'Control+F9');
  assert.equal(acceleratorFromKey(k('Digit3', { ctrlKey: true })), 'Control+3');
  assert.equal(acceleratorFromKey(k('ShiftLeft', { shiftKey: true })), null);
});

test('validation rejects unusable combos', () => {
  assert.match(validateAccelerator('Y')!, /at least one/);
  assert.match(validateAccelerator('Shift+Y')!, /Shift alone/);
  assert.match(validateAccelerator('Control+Shift')!, /normal key/);
  assert.equal(validateAccelerator('Super+Shift+F2'), null);
});

test('pretty names', () => {
  assert.equal(prettyAccelerator('Control+Super+Space'), 'Ctrl+Win+Space');
});
