// Deterministic layout for 2D scenes. The model only names nodes and links;
// positions come from here, so diagrams never overlap or run off the panel.
import type { Scene2D, SceneNode } from './scene';

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
}

export interface EdgePath {
  id: string;
  /** SVG path data */
  d: string;
  /** where the edge label sits */
  mid: { x: number; y: number };
}

export interface Layout {
  width: number;
  height: number;
  boxes: Map<string, Box>;
  edges: EdgePath[];
}

export type Measure = (text: string) => number;

const PAD_X = 16;
const LINE_H = 18;
const PAD_Y = 12;
const MAX_TEXT_W = 168;
const MIN_W = 92;
const GAP_RANK = 72;
const GAP_NODE = 26;
const MARGIN = 24;

/** Greedy word wrap into at most 3 lines. */
export function wrap(text: string, measure: Measure, maxW = MAX_TEXT_W): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxW || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > 3) {
    const kept = lines.slice(0, 3);
    kept[2] = kept[2]!.replace(/.$/, '…');
    return kept;
  }
  return lines;
}

function sizeNode(n: SceneNode, measure: Measure): Box {
  const lines = wrap(n.label, measure);
  const textW = Math.max(...lines.map(measure));
  let w = Math.max(MIN_W, textW + PAD_X * 2);
  let h = lines.length * LINE_H + PAD_Y * 2;
  if (n.shape === 'circle') w = h = Math.max(w, h, 84);
  if (n.shape === 'diamond') {
    w = w * 1.35;
    h = h * 1.5;
  }
  return { id: n.id, x: 0, y: 0, w: Math.round(w), h: Math.round(h), lines };
}

/** Rank nodes by longest path from sources; back edges (cycles) are ignored for ranking. */
function ranks(scene: Scene2D): Map<string, number> {
  const out = new Map<string, string[]>();
  scene.nodes.forEach((n) => out.set(n.id, []));
  for (const e of scene.edges) out.get(e.from)!.push(e.to);
  // DFS to find back edges
  const state = new Map<string, 0 | 1 | 2>();
  const forward = new Map<string, string[]>();
  scene.nodes.forEach((n) => forward.set(n.id, []));
  const visit = (id: string) => {
    state.set(id, 1);
    for (const t of out.get(id)!) {
      const s = state.get(t) ?? 0;
      if (s === 1) continue; // back edge
      forward.get(id)!.push(t);
      if (s === 0) visit(t);
    }
    state.set(id, 2);
  };
  scene.nodes.forEach((n) => {
    if (!state.get(n.id)) visit(n.id);
  });
  const rank = new Map<string, number>();
  const order = topo(scene.nodes.map((n) => n.id), forward);
  for (const id of order) rank.set(id, rank.get(id) ?? 0);
  for (const id of order) for (const t of forward.get(id)!) rank.set(t, Math.max(rank.get(t) ?? 0, rank.get(id)! + 1));
  return rank;
}

function topo(ids: string[], adj: Map<string, string[]>): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const id of ids) for (const t of adj.get(id)!) indeg.set(t, indeg.get(t)! + 1);
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const res: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    res.push(id);
    for (const t of adj.get(id)!) {
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  return res;
}

function layered(scene: Scene2D, boxes: Map<string, Box>, horizontal: boolean, maxMain: number): void {
  const rank = ranks(scene);
  const layers: string[][] = [];
  for (const n of scene.nodes) {
    const r = rank.get(n.id) ?? 0;
    (layers[r] ??= []).push(n.id);
  }
  // barycenter ordering: a few sweeps reduce crossings
  const pos = new Map<string, number>();
  const setPos = () => layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  setPos();
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  scene.nodes.forEach((n) => (preds.set(n.id, []), succs.set(n.id, [])));
  for (const e of scene.edges) {
    preds.get(e.to)!.push(e.from);
    succs.get(e.from)!.push(e.to);
  }
  const bary = (id: string, nb: Map<string, string[]>) => {
    const ns = nb.get(id)!.filter((x) => pos.has(x));
    return ns.length ? ns.reduce((s, x) => s + pos.get(x)!, 0) / ns.length : pos.get(id)!;
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? layers : [...layers].reverse();
    for (const layer of order) {
      layer.sort((a, b) => bary(a, down ? preds : succs) - bary(b, down ? preds : succs));
      layer.forEach((id, i) => pos.set(id, i));
    }
  }
  // place: ranks along the main axis, nodes centred on the cross axis. Long
  // pipelines wrap into several bands (like lines of text) instead of shrinking.
  const crossSize = (id: string) => (horizontal ? boxes.get(id)!.h : boxes.get(id)!.w);
  const mainSize = (id: string) => (horizontal ? boxes.get(id)!.w : boxes.get(id)!.h);
  const present = layers.filter((l): l is string[] => !!l && l.length > 0);
  const thickness = present.map((l) => Math.max(...l.map(mainSize)));
  const crossOf = present.map((l) => l.reduce((s, id) => s + crossSize(id), 0) + GAP_NODE * (l.length - 1));
  const bands: number[][] = [[]];
  let used = MARGIN;
  present.forEach((_, r) => {
    const band = bands[bands.length - 1]!;
    if (band.length > 0 && used + thickness[r]! > maxMain - MARGIN) {
      bands.push([]);
      used = MARGIN;
    }
    bands[bands.length - 1]!.push(r);
    used += thickness[r]! + GAP_RANK;
  });
  let bandStart = MARGIN;
  for (const band of bands) {
    const bandCross = Math.max(...band.map((r) => crossOf[r]!));
    let main = MARGIN;
    for (const r of band) {
      const layer = present[r]!;
      let cross = bandStart + (bandCross - crossOf[r]!) / 2;
      for (const id of layer) {
        const b = boxes.get(id)!;
        if (horizontal) {
          b.x = main + (thickness[r]! - b.w) / 2;
          b.y = cross;
        } else {
          b.x = cross;
          b.y = main + (thickness[r]! - b.h) / 2;
        }
        cross += crossSize(id) + GAP_NODE;
      }
      main += thickness[r]! + GAP_RANK;
    }
    bandStart += bandCross + GAP_RANK;
  }
}

function radial(scene: Scene2D, boxes: Map<string, Box>): void {
  const degree = new Map(scene.nodes.map((n) => [n.id, 0]));
  for (const e of scene.edges) {
    degree.set(e.from, degree.get(e.from)! + 1);
    degree.set(e.to, degree.get(e.to)! + 1);
  }
  const hub = [...scene.nodes].sort((a, b) => degree.get(b.id)! - degree.get(a.id)!)[0]!.id;
  const others = scene.nodes.map((n) => n.id).filter((id) => id !== hub);
  const hubBox = boxes.get(hub)!;
  const maxDiag = Math.max(...others.map((id) => Math.hypot(boxes.get(id)!.w, boxes.get(id)!.h)), 0);
  // radius big enough that neighbours don't touch each other or the hub
  const circumference = others.length * (maxDiag + GAP_NODE);
  const R = Math.max(Math.hypot(hubBox.w, hubBox.h) / 2 + maxDiag / 2 + GAP_RANK * 0.6, circumference / (2 * Math.PI));
  const cx = MARGIN + R + maxDiag / 2;
  const cy = cx;
  hubBox.x = cx - hubBox.w / 2;
  hubBox.y = cy - hubBox.h / 2;
  others.forEach((id, i) => {
    const a = -Math.PI / 2 + (i / others.length) * Math.PI * 2;
    const b = boxes.get(id)!;
    b.x = cx + Math.cos(a) * R - b.w / 2;
    b.y = cy + Math.sin(a) * R - b.h / 2;
  });
}

function grid(scene: Scene2D, boxes: Map<string, Box>): void {
  const n = scene.nodes.length;
  const cols = Math.ceil(Math.sqrt(n));
  const cellW = Math.max(...[...boxes.values()].map((b) => b.w)) + GAP_NODE * 1.5;
  const cellH = Math.max(...[...boxes.values()].map((b) => b.h)) + GAP_NODE * 1.5;
  scene.nodes.forEach((node, i) => {
    const b = boxes.get(node.id)!;
    b.x = MARGIN + (i % cols) * cellW + (cellW - b.w) / 2;
    b.y = MARGIN + Math.floor(i / cols) * cellH + (cellH - b.h) / 2;
  });
}

/** Point where the ray from the box centre towards (tx,ty) leaves the box. */
function exitPoint(b: Box, tx: number, ty: number): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx !== 0 ? b.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? b.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

const f = (n: number) => Math.round(n * 10) / 10;

function routeEdges(scene: Scene2D, boxes: Map<string, Box>, layout: Scene2D['layout']): EdgePath[] {
  return scene.edges.map((e) => {
    const a = boxes.get(e.from)!;
    const b = boxes.get(e.to)!;
    const horizontal = layout === 'flow-right';
    const vertical = layout === 'flow-down';
    const forward = horizontal ? b.x > a.x + a.w : vertical ? b.y > a.y + a.h : false;
    if ((horizontal || vertical) && forward) {
      const p1 = horizontal ? { x: a.x + a.w, y: a.y + a.h / 2 } : { x: a.x + a.w / 2, y: a.y + a.h };
      const p2 = horizontal ? { x: b.x, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y };
      const k = horizontal ? (p2.x - p1.x) / 2 : (p2.y - p1.y) / 2;
      const c1 = horizontal ? { x: p1.x + k, y: p1.y } : { x: p1.x, y: p1.y + k };
      const c2 = horizontal ? { x: p2.x - k, y: p2.y } : { x: p2.x, y: p2.y - k };
      return {
        id: e.id,
        d: `M${f(p1.x)},${f(p1.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`,
        mid: { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 },
      };
    }
    // straight or gently curved line between box borders (radial, grid, back edges)
    const p1 = exitPoint(a, b.x + b.w / 2, b.y + b.h / 2);
    const p2 = exitPoint(b, a.x + a.w / 2, a.y + a.h / 2);
    const back = horizontal || vertical;
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const bend = back ? Math.min(90, len * 0.35) : 0;
    const c = { x: (p1.x + p2.x) / 2 + ((p2.y - p1.y) / len) * bend, y: (p1.y + p2.y) / 2 - ((p2.x - p1.x) / len) * bend };
    return {
      id: e.id,
      d: `M${f(p1.x)},${f(p1.y)} Q${f(c.x)},${f(c.y)} ${f(p2.x)},${f(p2.y)}`,
      mid: { x: (p1.x + 2 * c.x + p2.x) / 4, y: (p1.y + 2 * c.y + p2.y) / 4 },
    };
  });
}

export interface LayoutOptions {
  /** wrap long flows so the diagram stays about this wide/tall (main axis) */
  maxMain?: number;
}

export function layoutScene2D(scene: Scene2D, measure: Measure, opts: LayoutOptions = {}): Layout {
  const boxes = new Map(scene.nodes.map((n) => [n.id, sizeNode(n, measure)] as const));
  if (scene.layout === 'radial' && scene.nodes.length > 2) radial(scene, boxes);
  else if (scene.layout === 'grid') grid(scene, boxes);
  else layered(scene, boxes, scene.layout !== 'flow-down', opts.maxMain ?? Number.POSITIVE_INFINITY);
  const all = [...boxes.values()];
  const width = Math.max(...all.map((b) => b.x + b.w)) + MARGIN;
  const height = Math.max(...all.map((b) => b.y + b.h)) + MARGIN;
  return { width, height, boxes, edges: routeEdges(scene, boxes, scene.layout) };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
