import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithin, mapAnnotation, focusPoint } from '../src/shared/geometry';

const img = { width: 1568, height: 882 };
const overlay = { width: 1920, height: 1080 };

test('maps screenshot pixels to overlay DIPs', () => {
  const a = mapAnnotation({ kind: 'point', x: 784, y: 441, label: 'c' }, img, overlay);
  assert.equal(a.kind, 'point');
  if (a.kind === 'point') {
    assert.ok(Math.abs(a.at.x - 960) < 1e-6);
    assert.ok(Math.abs(a.at.y - 540) < 1e-6);
  }
});

test('clamps out-of-range coordinates and normalizes boxes', () => {
  const b = mapAnnotation({ kind: 'box', x1: 2000, y1: 900, x2: -5, y2: 0, label: '' }, img, overlay);
  assert.equal(b.kind, 'box');
  if (b.kind === 'box') {
    assert.deepEqual(b.from, { x: 0, y: 0 });
    assert.ok(Math.abs(b.to.x - 1920) < 1e-6 && Math.abs(b.to.y - 1080) < 1e-6);
  }
});

test('circle radius has a visible minimum', () => {
  const c = mapAnnotation({ kind: 'circle', x: 10, y: 10, r: 1, label: '' }, img, overlay);
  assert.ok(c.kind === 'circle' && c.radius >= 14);
  assert.ok(focusPoint(c).x > 0);
});

test('fitWithin keeps aspect ratio', () => {
  assert.deepEqual(fitWithin({ width: 3840, height: 2160 }, 1568), { width: 1568, height: 882 });
  assert.deepEqual(fitWithin({ width: 800, height: 600 }, 1568), { width: 800, height: 600 });
});

import { annotationBounds, intersects } from '../src/shared/geometry';

test('annotation bounds include the label and intersect correctly', () => {
  const r = annotationBounds({ kind: 'box', from: { x: 100, y: 100 }, to: { x: 200, y: 150 }, label: 'x' });
  assert.ok(r.y < 100 - 30, 'room for label above');
  assert.ok(intersects(r, { x: 150, y: 120, width: 10, height: 10 }));
  assert.ok(!intersects(r, { x: 300, y: 300, width: 10, height: 10 }));
});
