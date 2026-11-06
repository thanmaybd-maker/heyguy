import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneJSON, parseScenePatchJSON, applyScenePatch, validateScene, SCENE_LIMITS, type Scene3D, type SceneUI } from '../src/shared/scene';
import { SceneBlockStream, stripSceneBlocks } from '../src/shared/blocks';
import { layoutScene2D, boxesOverlap } from '../src/shared/layout2d';
import { DEMO_DIAGRAM, DEMO_ENGINE, DEMO_UI } from '../src/main/demo-scenes';
import type { Scene2D } from '../src/shared/scene';

const measure = (t: string) => t.length * 7.2;

test('demo scenes validate cleanly', () => {
  for (const d of [DEMO_DIAGRAM, DEMO_ENGINE, DEMO_UI]) {
    const r = validateScene(d);
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) assert.deepEqual(r.warnings, []);
  }
});

test('rejects garbage, keeps the good parts of sloppy output', () => {
  assert.equal(parseSceneJSON('{not json').ok, false);
  assert.equal(validateScene({ kind: 'video' }).ok, false);
  assert.equal(validateScene({ kind: '2d', nodes: [] }).ok, false);
  const r = validateScene({
    kind: '2d',
    nodes: [{ id: 'a', label: 'A', shape: 'hexagon' }, { id: 'a', label: 'dup id' }, { label: '' }, 'junk'],
    edges: [{ from: 'a', to: 'ghost' }, { from: 'a', to: 'a_' }],
    steps: [{ caption: 'look', focus: ['a', 'nope'] }],
    evil: '<script>',
  });
  assert.ok(r.ok);
  if (!r.ok || r.scene.kind !== '2d') return;
  assert.equal(r.scene.nodes.length, 2);
  assert.equal(r.scene.nodes[0]!.shape, 'box', 'unknown shape falls back');
  assert.equal(r.scene.nodes[1]!.id, 'a_', 'duplicate ids are made unique');
  assert.equal(r.scene.edges.length, 1, 'edge to unknown node dropped');
  assert.deepEqual(r.scene.steps[0]!.focus, ['a']);
  assert.ok(!('evil' in r.scene));
  assert.ok(r.warnings.length >= 2);
});

test('3d parts are clamped and defaulted', () => {
  const r = validateScene({
    kind: '3d',
    parts: [
      { id: 'big', label: 'Big', shape: 'box', size: [999, -1, 'x'], position: [1e9, 0, 0], color: 'red' },
      { id: 'cone', label: 'Cone', shape: 'cone', size: [0.5, 2] },
    ],
    animations: [{ part: 'big', kind: 'spin', amount: 1e6 }, { part: 'ghost' }],
  });
  assert.ok(r.ok);
  if (!r.ok || r.scene.kind !== '3d') return;
  const big = r.scene.parts[0]!;
  assert.deepEqual(big.size, [50, 0.01, 1]);
  assert.equal(big.position[0], 100);
  assert.match(big.color, /^#[0-9A-F]{6}$/i);
  assert.deepEqual(r.scene.parts[1]!.size, [0, 0.5, 2], 'cone = cylinder with zero top radius');
  assert.equal(r.scene.animations.length, 1);
  assert.equal(r.scene.animations[0]!.amount, 50);
});

test('size limits hold', () => {
  const nodes = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }));
  const r = validateScene({ kind: '2d', nodes });
  assert.ok(r.ok && r.scene.kind === '2d' && r.scene.nodes.length === SCENE_LIMITS.nodes);
  assert.equal(parseSceneJSON('x'.repeat(SCENE_LIMITS.jsonChars + 1)).ok, false);
});

test('scene blocks are split out of the stream at any chunk size', () => {
  const json = JSON.stringify({ kind: '2d', nodes: [{ id: 'a', label: 'A' }] });
  const full = `Here you go. <scene>${json}</scene> Click it!`;
  for (let size = 1; size <= full.length; size += 3) {
    const s = new SceneBlockStream();
    let text = '';
    const blocks: string[] = [];
    for (let i = 0; i < full.length; i += size) {
      const r = s.push(full.slice(i, i + size));
      text += r.text;
      blocks.push(...r.blocks);
    }
    const end = s.flush();
    text += end.text;
    assert.equal(text, 'Here you go.  Click it!', `size ${size}`);
    assert.deepEqual(blocks, [json], `size ${size}`);
  }
  assert.equal(stripSceneBlocks(full), 'Here you go.  Click it!');
});

test('unterminated scene is returned for salvage, "<" alone is text', () => {
  const s = new SceneBlockStream();
  assert.equal(s.push('a < b and <sc').text, 'a < b and ');
  assert.equal(s.push('ene>{"kind":"2d"').inBlock, true);
  assert.deepEqual(s.flush(), { text: '', unterminated: '{"kind":"2d"' });
});

for (const layout of ['flow-right', 'flow-down', 'radial', 'grid'] as const) {
  test(`layout ${layout}: no overlapping nodes, all inside the canvas`, () => {
    const r = validateScene({ ...DEMO_DIAGRAM, layout });
    assert.ok(r.ok);
    const scene = (r as { scene: Scene2D }).scene;
    const l = layoutScene2D(scene, measure);
    const boxes = [...l.boxes.values()];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= l.width && b.y + b.h <= l.height, `${b.id} inside`);
      for (let j = i + 1; j < boxes.length; j++) assert.ok(!boxesOverlap(b, boxes[j]!), `${b.id} vs ${boxes[j]!.id}`);
    }
    assert.equal(l.edges.length, scene.edges.length);
    for (const e of l.edges) assert.ok(!e.d.includes('NaN'), e.id);
  });
}

test('layered layout survives cycles and big random graphs', () => {
  for (let seed = 1; seed <= 30; seed++) {
    let x = seed;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    const n = 3 + Math.floor(rnd() * 20);
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Node number ${i}` }));
    const edges = Array.from({ length: n * 2 }, () => ({ from: `n${Math.floor(rnd() * n)}`, to: `n${Math.floor(rnd() * n)}` }));
    const r = validateScene({ kind: '2d', layout: seed % 2 ? 'flow-right' : 'flow-down', nodes, edges });
    assert.ok(r.ok);
    const l = layoutScene2D((r as { scene: Scene2D }).scene, measure);
    const boxes = [...l.boxes.values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!boxesOverlap(boxes[i]!, boxes[j]!), `seed ${seed}`);
  }
});

test('long flows wrap into bands within the requested width', () => {
  const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, label: `Stage ${i}` }));
  const edges = nodes.slice(1).map((n, i) => ({ from: `s${i}`, to: n.id }));
  const r = validateScene({ kind: '2d', layout: 'flow-right', nodes, edges });
  const scene = (r as { scene: Scene2D }).scene;
  const wide = layoutScene2D(scene, measure);
  const wrapped = layoutScene2D(scene, measure, { maxMain: 700 });
  assert.ok(wrapped.width <= 700, `width ${wrapped.width}`);
  assert.ok(wrapped.height > wide.height, 'wrapping adds rows');
  const boxes = [...wrapped.boxes.values()];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!boxesOverlap(boxes[i]!, boxes[j]!));
});

test('3d scene accepts extended shapes: ring, prism, wedge, tube', () => {
  const r = validateScene({
    kind: '3d',
    id: 'mech',
    title: 'Mechanical Assembly',
    parts: [
      { id: 'washer', label: 'Washer', shape: 'ring', size: [0.2, 0.5] },
      { id: 'nut', label: 'Hex Nut', shape: 'prism', size: [0.4, 0.2, 6] },
      { id: 'ramp', label: 'Ramp', shape: 'wedge', size: [0.5, 0.8] },
      { id: 'conduit', label: 'Conduit', shape: 'tube', size: [0.2, 0.3, 2] },
    ],
  });
  assert.ok(r.ok, JSON.stringify(r));
  const s = (r as { scene: Scene3D }).scene;
  assert.equal(s.parts.length, 4);
  assert.equal(s.parts[0]!.shape, 'ring');
  assert.equal(s.parts[1]!.shape, 'prism');
  assert.equal(s.parts[2]!.shape, 'wedge');
  assert.equal(s.parts[3]!.shape, 'tube');
});

test('scene patches: parses, validates and transactionally merges into 2D scenes', () => {
  const initial = validateScene({
    kind: '2d',
    id: 'arch',
    title: 'Pipeline V1',
    nodes: [
      { id: 'in', label: 'Input' },
      { id: 'proc', label: 'Processing' },
    ],
    edges: [{ id: 'e1', from: 'in', to: 'proc' }],
  });
  assert.ok(initial.ok);
  const s = (initial as { scene: Scene2D }).scene;

  const patchText = JSON.stringify({
    kind: '2d-patch',
    id: 'arch',
    title: 'Pipeline V2',
    addNodes: [{ id: 'out', label: 'Output', shape: 'pill' }],
    addEdges: [{ id: 'e2', from: 'proc', to: 'out', flow: true }],
  });

  const parsed = parseScenePatchJSON(patchText);
  assert.ok(parsed.ok);
  const merged = applyScenePatch(s, parsed.patch) as Scene2D;

  assert.equal(merged.title, 'Pipeline V2');
  assert.equal(merged.nodes.length, 3);
  assert.ok(merged.nodes.some((n) => n.id === 'out'));
  assert.equal(merged.edges.length, 2);
  assert.ok(merged.edges.some((e) => e.id === 'e2'));

  // Test node removal cascades to connected edges
  const removePatch = parseScenePatchJSON(
    JSON.stringify({
      kind: '2d-patch',
      id: 'arch',
      removeNodeIds: ['proc'],
    })
  );
  assert.ok(removePatch.ok);
  const afterRemove = applyScenePatch(merged, removePatch.patch) as Scene2D;
  assert.equal(afterRemove.nodes.length, 2);
  assert.ok(!afterRemove.nodes.some((n) => n.id === 'proc'));
  assert.equal(afterRemove.edges.length, 0); // Both e1 and e2 connect to proc, so removed!
});

test('scene patches: merges into 3D scenes', () => {
  const initial = validateScene({
    kind: '3d',
    id: 'engine',
    title: 'Engine V1',
    parts: [{ id: 'block', label: 'Cylinder Block', shape: 'box', size: [2, 2, 2] }],
  });
  assert.ok(initial.ok);
  const s = (initial as { scene: Scene3D }).scene;

  const patchParsed = parseScenePatchJSON(
    JSON.stringify({
      kind: '3d-patch',
      id: 'engine',
      addParts: [{ id: 'exhaust', label: 'Exhaust Pipe', shape: 'tube', size: [0.2, 0.3, 1] }],
    })
  );
  assert.ok(patchParsed.ok);
  const merged = applyScenePatch(s, patchParsed.patch) as Scene3D;
  assert.equal(merged.parts.length, 2);
  assert.ok(merged.parts.some((p) => p.id === 'exhaust'));
});

test('SceneBlockStream handles <scene-patch> tags and stripSceneBlocks removes them', () => {
  const stream = new SceneBlockStream();
  const res1 = stream.push('Updating your diagram now: <scene-patch>{"kind":"2d-patch"');
  assert.equal(res1.text, 'Updating your diagram now: ');
  assert.equal(res1.inBlock, true);
  assert.equal(res1.blocks.length, 0);

  const res2 = stream.push(',"id":"arch"}</scene-patch> Done!');
  assert.equal(res2.blocks.length, 1);
  assert.equal(res2.blocks[0], '{"kind":"2d-patch","id":"arch"}');
  assert.equal(res2.text, ' Done!');
  assert.equal(res2.inBlock, false);

  const stripped = stripSceneBlocks('Here is the plan: <scene-patch>{"id":"arch"}</scene-patch> Look at the screen.');
  assert.equal(stripped, 'Here is the plan:  Look at the screen.');
});

test('SceneUI (kind: "ui") validates widgets, clamps values, and supports ui-patch', () => {
  const r = validateScene({
    kind: 'ui',
    id: 'dash',
    title: 'System Dashboard',
    layout: 'dashboard',
    widgets: [
      { id: 'm1', kind: 'metric', label: 'Throughput', value: '140 req/s', progress: 180, trend: 'up' },
      { id: 'c1', kind: 'chart', label: 'Latency', chartType: 'bar', series: [{ label: 'P95', value: 42 }] },
      { id: 's1', kind: 'slider', label: 'Batch Size', min: 10, max: 100, step: 10, initial: 500 },
    ],
  });
  assert.ok(r.ok, JSON.stringify(r));
  const ui = (r as { scene: SceneUI }).scene;
  assert.equal(ui.layout, 'dashboard');
  assert.equal(ui.widgets.length, 3);
  assert.equal(ui.widgets[0]!.progress, 100);
  assert.equal(ui.widgets[2]!.initial, 100);

  const patchParsed = parseScenePatchJSON(
    JSON.stringify({
      kind: 'ui-patch',
      id: 'dash',
      title: 'System Dashboard V2',
      addWidgets: [{ id: 'chk', kind: 'checklist', label: 'Tasks', items: [{ label: 'Verify', value: 'Done', checked: true }] }],
      removeWidgetIds: ['c1'],
    }),
  );
  assert.ok(patchParsed.ok);
  const merged = applyScenePatch(ui, patchParsed.patch) as SceneUI;
  assert.equal(merged.title, 'System Dashboard V2');
  assert.equal(merged.widgets.length, 3);
  assert.ok(!merged.widgets.some((w) => w.id === 'c1'));
  assert.ok(merged.widgets.some((w) => w.id === 'chk'));
});
