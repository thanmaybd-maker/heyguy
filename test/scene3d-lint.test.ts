import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateScene, type Scene3D } from '../src/shared/scene';
import { lint3D, normalise3D, partBounds } from '../src/shared/scene3d-lint';
import { DEMO_ENGINE, DEMO_F22 } from '../src/main/demo-scenes';

function scene3d(raw: unknown): Scene3D {
  const r = validateScene(raw);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.ok && r.scene.kind === '3d');
  return r.scene as Scene3D;
}

const part = (id: string, position: number[], size: number[] = [1, 1, 1], extra: object = {}) => ({
  id,
  label: id,
  shape: 'box',
  size,
  position,
  ...extra,
});

test('shipped 3D demos pass the lint as one coherent assembly', () => {
  for (const demo of [DEMO_ENGINE, DEMO_F22]) {
    const r = lint3D(scene3d(demo));
    const bad = r.issues.filter((i) => i.severity !== 'info');
    assert.deepEqual(bad, [], `${demo.title}: ${JSON.stringify(bad)}`);
    assert.equal(r.stats.components, 1);
    assert.equal(r.score, 100);
  }
});

test('bounds follow rotation: a 4x1x1 box turned 90 degrees about y is long in z', () => {
  const s = scene3d({ kind: '3d', title: 't', parts: [part('a', [0, 0, 0], [4, 1, 1], { rotation: [0, 90, 0] })] });
  const b = partBounds(s.parts[0]!);
  assert.ok(Math.abs(b.max[2] - 2) < 1e-9 && Math.abs(b.max[0] - 0.5) < 1e-9, JSON.stringify(b));
});

test('a part far from the assembly is reported as floating', () => {
  const s = scene3d({
    kind: '3d',
    title: 'stray',
    parts: [part('body', [0, 0, 0], [2, 1, 1]), part('wing', [1.5, 0, 0]), part('lost', [30, 0, 0])],
  });
  const r = lint3D(s);
  const f = r.issues.filter((i) => i.code === 'floating');
  assert.equal(f.length, 1);
  assert.deepEqual(f[0]!.parts, ['lost']);
  assert.equal(r.stats.components, 2);
  assert.ok(r.score < 100);
});

test('two parts in the same place are reported as duplicates', () => {
  const s = scene3d({ kind: '3d', title: 'dup', parts: [part('a', [0, 0, 0]), part('b', [0.01, 0, 0])] });
  const d = lint3D(s).issues.filter((i) => i.code === 'duplicate');
  assert.equal(d.length, 1);
  assert.deepEqual(d[0]!.parts, ['a', 'b']);
});

test('vanishingly small parts are reported, normal small parts are not', () => {
  const s = scene3d({
    kind: '3d',
    title: 'tiny',
    parts: [part('hull', [0, 0, 0], [20, 4, 4]), part('rivet', [0, 2.01, 0], [0.05, 0.05, 0.05]), part('hatch', [0, 2.2, 0], [2, 0.4, 2])],
  });
  const codes = lint3D(s).issues.map((i) => `${i.code}:${i.parts.join()}`);
  assert.ok(codes.includes('tiny:rivet'), codes.join());
  assert.ok(!codes.some((c) => c.endsWith(':hatch')), codes.join());
});

test('a mirror twin is not a duplicate or a floating part of its own base', () => {
  const s = scene3d({
    kind: '3d',
    title: 'wings',
    parts: [part('body', [0, 0, 0], [1, 1, 4]), part('wing', [1.5, 0, 0], [2, 0.1, 1], { mirror: 'x' })],
  });
  const r = lint3D(s);
  assert.deepEqual(r.issues, []);
  assert.equal(r.stats.components, 1);
});

test('normalise3D recentres an off-origin assembly and leaves a good one untouched', () => {
  const good = scene3d(DEMO_ENGINE);
  assert.equal(normalise3D(good), good);

  const s = scene3d({ kind: '3d', title: 'far', parts: [part('a', [40, 10, 0]), part('b', [41, 10, 0])] });
  const n = normalise3D(s);
  const after = lint3D(n);
  assert.ok(!after.issues.some((i) => i.code === 'off-origin'), JSON.stringify(after.issues));
  const c = [0, 1, 2].map((i) => (after.stats.bounds.min[i]! + after.stats.bounds.max[i]!) / 2);
  assert.ok(c.every((v) => Math.abs(v) < 1e-9), JSON.stringify(c));
});

test('normalise3D rescales a microscopic assembly into the usable range, keeping prism side counts', () => {
  const s = scene3d({
    kind: '3d',
    title: 'micro',
    parts: [part('a', [0, 0, 0], [0.05, 0.05, 0.05]), { id: 'p', label: 'p', shape: 'prism', size: [0.02, 0.05, 6], position: [0.05, 0, 0] }],
    animations: [{ part: 'a', kind: 'slide', axis: 'x', amount: 0.01, speed: 1 }],
  });
  const before = lint3D(s);
  assert.ok(before.issues.some((i) => i.code === 'scale'));
  const n = normalise3D(s);
  const after = lint3D(n);
  assert.ok(Math.abs(after.stats.diagonal - 6) < 0.05, String(after.stats.diagonal));
  assert.equal(n.parts.find((p) => p.id === 'p')!.size[2], 6);
  assert.ok(n.animations[0]!.amount > 0.01);
});

