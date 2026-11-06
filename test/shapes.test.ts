import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateScene } from '../src/shared/scene';
import { DEMO_F22 } from '../src/main/demo-scenes';

test('F-22 demo validates with mirrored twins and no warnings', () => {
  const r = validateScene(DEMO_F22);
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok || r.scene.kind !== '3d') return;
  assert.deepEqual(r.warnings, []);
  const twins = r.scene.parts.filter((p) => p.mirrored);
  assert.equal(twins.length, 5, 'wing, stab, tail, intake, nozzle get a right-hand twin');
  const wingR = r.scene.parts.find((p) => p.mirrorOf === 'wing')!;
  assert.equal(wingR.position[0], -0);
  assert.ok(wingR.points && wingR.points.length === 5, 'twin keeps the outline (renderer flips it)');
  const tailR = r.scene.parts.find((p) => p.mirrorOf === 'tail')!;
  assert.equal(tailR.position[0], -0.34);
});

test('extrude / lathe need points, otherwise fall back to a box with a warning', () => {
  const r = validateScene({
    kind: '3d',
    parts: [
      { id: 'a', label: 'Bad wing', shape: 'extrude', points: [[0, 0], ['x', 1]] },
      { id: 'b', label: 'Nose', shape: 'lathe', points: [[0, 1], [-5, 0], [0.3, -1]] },
      { id: 'c', label: 'Huge', shape: 'extrude', points: [[0, 0], [999, 0], [0, -999]], size: [0.1, 9] },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok || r.scene.kind !== '3d') return;
  assert.equal(r.scene.parts[0]!.shape, 'box');
  assert.match(r.warnings.join(' '), /needs 3\+ valid points/);
  assert.deepEqual(r.scene.parts[1]!.points, [[0, 1], [0, 0], [0.3, -1]], 'lathe radius clamped to >= 0');
  assert.deepEqual(r.scene.parts[2]!.points, [[0, 0], [20, 0], [0, -20]], 'points clamped to ±20');
  assert.equal(r.scene.parts[2]!.size[1], 0.05, 'bevel capped at half the thickness');
});

test('mirror copies never push the scene past the hard cap', () => {
  const parts = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, label: `P${i}`, mirror: 'x', position: [1, 0, 0] }));
  const r = validateScene({ kind: '3d', parts });
  assert.ok(r.ok && r.scene.kind === '3d' && r.scene.parts.length === 90);
});
