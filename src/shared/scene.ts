// Scene protocol: the model describes an explanation as data (never code);
// we validate it here and our own renderers draw it. Unknown fields are dropped,
// sizes are capped, and anything malformed is rejected with readable errors.

export const SCENE_LIMITS = {
  nodes: 40,
  edges: 80,
  parts: 60,
  /** after mirror copies are added */
  partsWithMirrors: 90,
  widgets: 24,
  series: 16,
  columns: 8,
  rows: 24,
  items: 16,
  steps: 12,
  animations: 24,
  label: 60,
  detail: 400,
  code: 2400,
  title: 80,
  jsonChars: 24_000,
} as const;

export type NodeShape = 'box' | 'pill' | 'circle' | 'diamond' | 'note';
export type Layout2D = 'flow-right' | 'flow-down' | 'radial' | 'grid';
export type Tone = 'default' | 'accent' | 'warn' | 'good' | 'muted';

export interface SceneNode {
  id: string;
  label: string;
  detail: string;
  shape: NodeShape;
  tone: Tone;
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  dashed: boolean;
  /** draw moving dots along the edge (data / energy flow) */
  flow: boolean;
}

export interface SceneStep {
  caption: string;
  /** node, edge or part ids highlighted during this step */
  focus: string[];
}

export interface Scene2D {
  kind: '2d';
  id: string;
  title: string;
  layout: Layout2D;
  nodes: SceneNode[];
  edges: SceneEdge[];
  steps: SceneStep[];
}

export type PartShape =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'capsule' | 'tube' | 'ring' | 'prism' | 'wedge'
  /** sphere stretched to [rx, ry, rz]: canopies, fuselages, eggs */
  | 'ellipsoid'
  /** flat outline (top view, [x, z] points) extruded upward by size[0]: wings, fins, plates, brackets */
  | 'extrude'
  /** profile ([radius, y] points) spun around the y axis: noses, bottles, engine nacelles, vases */
  | 'lathe';
export const PART_SHAPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'tube', 'ring', 'prism', 'wedge', 'ellipsoid', 'extrude', 'lathe'] as const;
export type Vec3 = [number, number, number];

export interface ScenePart {
  id: string;
  label: string;
  detail: string;
  shape: PartShape;
  /** box: [w,h,d]; sphere: [r]; cylinder/cone: [rTop?, rBottom, height] as [r, h] or [rTop, rBottom, h]; torus: [r, tube]; capsule: [r, length] */
  size: number[];
  position: Vec3;
  /** degrees */
  rotation: Vec3;
  color: string;
  opacity: number;
  /** outline / profile points for 'extrude' and 'lathe' */
  points?: [number, number][];
  /** set on the automatic mirror copy of a part declared with "mirror": the renderer flips it across x */
  mirrored?: boolean;
  /** id of the part this one mirrors (selection maps back to it) */
  mirrorOf?: string;
}

export type AnimationKind = 'spin' | 'slide' | 'swing';

export interface SceneAnimation {
  part: string;
  kind: AnimationKind;
  axis: 'x' | 'y' | 'z';
  /** spin: turns per second; slide: distance; swing: degrees */
  amount: number;
  /** cycles per second (slide/swing) */
  speed: number;
  /** 0..1 phase offset so linked parts (e.g. pistons) move out of sync */
  phase: number;
}

export interface Scene3D {
  kind: '3d';
  id: string;
  title: string;
  parts: ScenePart[];
  animations: SceneAnimation[];
  steps: SceneStep[];
}

export type UIWidgetKind = 'metric' | 'chart' | 'table' | 'card' | 'code' | 'checklist' | 'slider' | 'callout' | 'comparison';
export type UILayout = 'dashboard' | 'stack' | 'split';
export type ChartType = 'bar' | 'line' | 'donut';

export interface UIChartPoint {
  label: string;
  value: number;
  color?: string;
}

export interface UIKeyValueItem {
  label: string;
  value: string;
  rightValue?: string;
  checked?: boolean;
  tone?: Tone;
}

export interface SceneUIWidget {
  id: string;
  kind: UIWidgetKind;
  label: string;
  detail: string;
  tone: Tone;
  span: 1 | 2;
  /** metric fields */
  value?: string;
  delta?: string;
  trend?: 'up' | 'down' | 'neutral';
  progress?: number;
  /** chart fields */
  chartType?: ChartType;
  unit?: string;
  series?: UIChartPoint[];
  /** table fields */
  columns?: string[];
  rows?: string[][];
  /** card / callout / checklist / comparison fields */
  body?: string;
  badge?: string;
  leftTitle?: string;
  rightTitle?: string;
  items?: UIKeyValueItem[];
  /** code fields */
  language?: string;
  code?: string;
  /** interactive slider / parameter tuner fields (no eval!) */
  min?: number;
  max?: number;
  step?: number;
  initial?: number;
  multiplier?: number;
  formulaLabel?: string;
}

export interface SceneUI {
  kind: 'ui';
  id: string;
  title: string;
  subtitle?: string;
  layout: UILayout;
  widgets: SceneUIWidget[];
  steps: SceneStep[];
}

export type Scene = Scene2D | Scene3D | SceneUI;

export interface ScenePatch2D {
  kind: '2d-patch';
  id: string;
  title?: string;
  addNodes?: SceneNode[];
  removeNodeIds?: string[];
  addEdges?: SceneEdge[];
  removeEdgeIds?: string[];
  steps?: SceneStep[];
}

export interface ScenePatch3D {
  kind: '3d-patch';
  id: string;
  title?: string;
  addParts?: ScenePart[];
  removePartIds?: string[];
  animations?: SceneAnimation[];
  steps?: SceneStep[];
}

export interface ScenePatchUI {
  kind: 'ui-patch';
  id: string;
  title?: string;
  subtitle?: string;
  addWidgets?: SceneUIWidget[];
  removeWidgetIds?: string[];
  steps?: SceneStep[];
}

export type ScenePatch = ScenePatch2D | ScenePatch3D | ScenePatchUI;

export type ValidationResult = { ok: true; scene: Scene; warnings: string[] } | { ok: false; errors: string[] };
export type ValidationPatchResult = { ok: true; patch: ScenePatch; warnings: string[] } | { ok: false; errors: string[] };

// ------------------------------------------------------------------ helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

function str(v: unknown, max: number, fallback = ''): string {
  if (typeof v !== 'string') return fallback;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function vec3(v: unknown, fallback: Vec3, lo = -100, hi = 100): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) return fallback;
  return [num(v[0], lo, hi, fallback[0]), num(v[1], lo, hi, fallback[1]), num(v[2], lo, hi, fallback[2])];
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const PALETTE = ['#60A5FA', '#F59E0B', '#34D399', '#F472B6', '#A78BFA', '#F87171', '#94A3B8', '#FBBF24'];

function slugId(raw: unknown, used: Set<string>, prefix: string, i: number): string {
  let id = typeof raw === 'string' && ID_RE.test(raw) ? raw : `${prefix}${i + 1}`;
  while (used.has(id)) id = `${id}_`;
  used.add(id);
  return id;
}

function steps(raw: unknown, known: Set<string>, warnings: string[]): SceneStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, SCENE_LIMITS.steps).flatMap((s, i) => {
    if (!isObj(s)) return [];
    const caption = str(s.caption, SCENE_LIMITS.detail);
    const focusRaw = Array.isArray(s.focus) ? s.focus : [];
    const focus = focusRaw.filter((f): f is string => typeof f === 'string' && known.has(f));
    if (focusRaw.length !== focus.length) warnings.push(`step ${i + 1}: dropped unknown focus ids`);
    return caption ? [{ caption, focus }] : [];
  });
}

// ------------------------------------------------------------------ validators

function validate2D(o: Obj, id: string, title: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rawNodes = Array.isArray(o.nodes) ? o.nodes : [];
  if (rawNodes.length === 0) errors.push('2d scene needs at least one node');
  if (rawNodes.length > SCENE_LIMITS.nodes) warnings.push(`only the first ${SCENE_LIMITS.nodes} nodes are shown`);
  const used = new Set<string>();
  const nodes: SceneNode[] = rawNodes.slice(0, SCENE_LIMITS.nodes).flatMap((n, i) => {
    if (!isObj(n)) return [];
    const label = str(n.label, SCENE_LIMITS.label);
    if (!label) {
      warnings.push(`node ${i + 1} has no label`);
      return [];
    }
    return [
      {
        id: slugId(n.id, used, 'n', i),
        label,
        detail: str(n.detail, SCENE_LIMITS.detail),
        shape: oneOf(n.shape, ['box', 'pill', 'circle', 'diamond', 'note'] as const, 'box'),
        tone: oneOf(n.tone, ['default', 'accent', 'warn', 'good', 'muted'] as const, 'default'),
      },
    ];
  });
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeIdsUsed = new Set<string>(nodeIds);
  const rawEdges = Array.isArray(o.edges) ? o.edges : [];
  const edges: SceneEdge[] = rawEdges.slice(0, SCENE_LIMITS.edges).flatMap((e, i) => {
    if (!isObj(e)) return [];
    const from = typeof e.from === 'string' ? e.from : '';
    const to = typeof e.to === 'string' ? e.to : '';
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) {
      warnings.push(`edge ${i + 1} (${from}→${to}) skipped: unknown or self-referencing node`);
      return [];
    }
    return [
      {
        id: slugId(e.id, edgeIdsUsed, 'e', i),
        from,
        to,
        label: str(e.label, SCENE_LIMITS.label),
        dashed: e.dashed === true,
        flow: e.flow === true,
      },
    ];
  });
  if (errors.length || nodes.length === 0) return { ok: false, errors: errors.length ? errors : ['no valid nodes'] };
  const known = new Set([...nodeIds, ...edges.map((e) => e.id)]);
  return {
    ok: true,
    warnings,
    scene: {
      kind: '2d',
      id,
      title,
      layout: oneOf(o.layout, ['flow-right', 'flow-down', 'radial', 'grid'] as const, 'flow-right'),
      nodes,
      edges,
      steps: steps(o.steps, known, warnings),
    },
  };
}

function partSize(shape: PartShape, raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw.map((v) => num(v, 0.01, 50, NaN)).filter((v) => Number.isFinite(v)) : [];
  const d = (i: number, f: number) => arr[i] ?? f;
  switch (shape) {
    case 'box':
      return [d(0, 1), d(1, 1), d(2, 1)];
    case 'sphere':
      return [d(0, 0.5)];
    case 'cylinder':
    case 'cone':
      // [r, h] or [rTop, rBottom, h]
      return arr.length >= 3 ? [d(0, 0.5), d(1, 0.5), d(2, 1)] : [shape === 'cone' ? 0 : d(0, 0.5), d(0, 0.5), d(1, 1)];
    case 'torus':
      return [d(0, 0.6), Math.min(d(1, 0.15), d(0, 0.6))];
    case 'capsule':
      return [d(0, 0.3), d(1, 1)];
    case 'ring': {
      const rIn = d(0, 0.4);
      const rOut = Math.max(rIn + 0.05, d(1, 0.8));
      return [rIn, rOut];
    }
    case 'prism': {
      const sides = Math.max(3, Math.min(16, Math.round(d(2, 6))));
      return [d(0, 0.5), d(1, 1), sides];
    }
    case 'wedge':
      return [d(0, 1), d(1, 0.5), d(2, 1)];
    case 'ellipsoid':
      return [d(0, 0.5), d(1, d(0, 0.5)), d(2, d(0, 0.5))];
    case 'extrude':
      // [thickness, bevel]
      return [d(0, 0.08), Math.min(d(1, 0), d(0, 0.08) / 2)];
    case 'lathe':
      return [];
    case 'tube': {
      const tIn = d(0, 0.3);
      const tOut = Math.max(tIn + 0.05, d(1, 0.5));
      return [tIn, tOut, d(2, 1)];
    }
  }
}

/** 3-64 finite [a, b] pairs, clamped to ±20. Lathe radii must be >= 0. */
function pointList(raw: unknown, shape: 'extrude' | 'lathe'): [number, number][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const pts = raw
    .slice(0, 64)
    .map((pt) => (Array.isArray(pt) && pt.length >= 2 ? [Number(pt[0]), Number(pt[1])] : [NaN, NaN]))
    .filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]))
    .map(([a, b]) => [Math.min(20, Math.max(shape === 'lathe' ? 0 : -20, a!)), Math.min(20, Math.max(-20, b!))] as [number, number]);
  return pts.length >= (shape === 'lathe' ? 2 : 3) ? pts : undefined;
}

function validate3D(o: Obj, id: string, title: string): ValidationResult {
  const warnings: string[] = [];
  const rawParts = Array.isArray(o.parts) ? o.parts : [];
  if (rawParts.length === 0) return { ok: false, errors: ['3d scene needs at least one part'] };
  if (rawParts.length > SCENE_LIMITS.parts) warnings.push(`only the first ${SCENE_LIMITS.parts} parts are shown`);
  const used = new Set<string>();
  const parts: ScenePart[] = rawParts.slice(0, SCENE_LIMITS.parts).flatMap((p, i) => {
    if (!isObj(p)) return [];
    const label = str(p.label, SCENE_LIMITS.label);
    if (!label) {
      warnings.push(`part ${i + 1} has no label`);
      return [];
    }
    let shape: PartShape = oneOf(p.shape, PART_SHAPES, 'box');
    const points = shape === 'extrude' || shape === 'lathe' ? pointList(p.points, shape) : undefined;
    if ((shape === 'extrude' || shape === 'lathe') && !points) {
      warnings.push(`part ${i + 1} (${shape}) needs 3+ valid points; drawn as a box`);
      shape = 'box';
    }
    const base: ScenePart = {
        id: slugId(p.id, used, 'p', i),
        label,
        detail: str(p.detail, SCENE_LIMITS.detail),
        shape,
        size: partSize(shape, p.size),
        position: vec3(p.position, [0, 0, 0]),
        rotation: vec3(p.rotation, [0, 0, 0], -360, 360),
        color: typeof p.color === 'string' && COLOR_RE.test(p.color) ? p.color : PALETTE[i % PALETTE.length]!,
        opacity: num(p.opacity, 0.15, 1, 1),
        ...(points ? { points } : {}),
    };
    // "mirror": "x" -> add the matching part on the other side (left/right wing, both wheels...)
    if (p.mirror === 'x' || p.mirror === true) {
      const twin: ScenePart = {
        ...base,
        id: slugId(`${base.id}_r`, used, 'p', i),
        position: [-base.position[0], base.position[1], base.position[2]],
        mirrored: true,
        mirrorOf: base.id,
      };
      return [base, twin];
    }
    return [base];
  });
  if (parts.length > SCENE_LIMITS.partsWithMirrors) parts.length = SCENE_LIMITS.partsWithMirrors;
  if (parts.length === 0) return { ok: false, errors: ['no valid parts'] };
  const partIds = new Set(parts.map((p) => p.id));
  const rawAnims = Array.isArray(o.animations) ? o.animations : [];
  const animations: SceneAnimation[] = rawAnims.slice(0, SCENE_LIMITS.animations).flatMap((a, i) => {
    if (!isObj(a) || typeof a.part !== 'string' || !partIds.has(a.part)) {
      warnings.push(`animation ${i + 1} skipped: unknown part`);
      return [];
    }
    const kind = oneOf(a.kind, ['spin', 'slide', 'swing'] as const, 'spin');
    return [
      {
        part: a.part,
        kind,
        axis: oneOf(a.axis, ['x', 'y', 'z'] as const, 'y'),
        amount: num(a.amount, -50, 50, kind === 'spin' ? 0.5 : kind === 'slide' ? 0.5 : 30),
        speed: num(a.speed, 0, 5, 1),
        phase: num(a.phase, 0, 1, 0),
      },
    ];
  });
  return { ok: true, warnings, scene: { kind: '3d', id, title, parts, animations, steps: steps(o.steps, partIds, warnings) } };
}

const UI_WIDGET_KINDS = ['metric', 'chart', 'table', 'card', 'code', 'checklist', 'slider', 'callout', 'comparison'] as const;

function sanitizeUIWidget(w: Obj, used: Set<string>, i: number, warnings: string[]): SceneUIWidget | null {
  const label = str(w.label, SCENE_LIMITS.label);
  if (!label) {
    warnings.push(`widget ${i + 1} has no label`);
    return null;
  }
  const kind = oneOf(w.kind, UI_WIDGET_KINDS, 'card');
  const tone = oneOf(w.tone, ['default', 'accent', 'warn', 'good', 'muted'] as const, 'default');
  const span: 1 | 2 = w.span === 2 || kind === 'table' || kind === 'chart' || kind === 'code' || kind === 'comparison' ? (w.span === 1 ? 1 : 2) : 1;
  const widget: SceneUIWidget = {
    id: slugId(w.id, used, 'w', i),
    kind,
    label,
    detail: str(w.detail, SCENE_LIMITS.detail, `${label} interactive component.`),
    tone,
    span,
  };

  if (typeof w.value === 'string' || typeof w.value === 'number') widget.value = str(String(w.value), 40);
  if (typeof w.delta === 'string') widget.delta = str(w.delta, 40);
  if (w.trend === 'up' || w.trend === 'down' || w.trend === 'neutral') widget.trend = w.trend;
  if (typeof w.progress === 'number' || typeof w.progress === 'string') widget.progress = num(w.progress, 0, 100, 0);

  if (kind === 'chart' || Array.isArray(w.series)) {
    widget.chartType = oneOf(w.chartType, ['bar', 'line', 'donut'] as const, 'bar');
    if (typeof w.unit === 'string') widget.unit = str(w.unit, 16);
    const rawSeries = Array.isArray(w.series) ? w.series : [];
    widget.series = rawSeries.slice(0, SCENE_LIMITS.series).flatMap((pt, idx) => {
      if (!isObj(pt)) return [];
      const ptLabel = str(pt.label, 32, `Item ${idx + 1}`);
      const val = num(pt.value, -1_000_000_000, 1_000_000_000, 0);
      const color = typeof pt.color === 'string' && COLOR_RE.test(pt.color) ? pt.color : PALETTE[idx % PALETTE.length];
      return [{ label: ptLabel, value: val, color }];
    });
  }

  if (kind === 'table' || Array.isArray(w.columns)) {
    const rawCols = Array.isArray(w.columns) ? w.columns : [];
    widget.columns = rawCols.slice(0, SCENE_LIMITS.columns).map((c, idx) => str(String(c ?? ''), 32, `Col ${idx + 1}`));
    const colCount = Math.max(1, widget.columns.length);
    const rawRows = Array.isArray(w.rows) ? w.rows : [];
    widget.rows = rawRows.slice(0, SCENE_LIMITS.rows).flatMap((r) => {
      if (!Array.isArray(r)) return [];
      return [r.slice(0, colCount).map((cell) => str(String(cell ?? ''), 80))];
    });
  }

  if (typeof w.body === 'string') widget.body = str(w.body, SCENE_LIMITS.detail);
  if (typeof w.badge === 'string') widget.badge = str(w.badge, 24);
  if (typeof w.leftTitle === 'string') widget.leftTitle = str(w.leftTitle, 40);
  if (typeof w.rightTitle === 'string') widget.rightTitle = str(w.rightTitle, 40);

  if (Array.isArray(w.items)) {
    widget.items = w.items.slice(0, SCENE_LIMITS.items).flatMap((it) => {
      if (!isObj(it)) return [];
      const itemLabel = str(it.label, 60);
      if (!itemLabel) return [];
      return [
        {
          label: itemLabel,
          value: str(String(it.value ?? ''), 120),
          rightValue: typeof it.rightValue === 'string' ? str(it.rightValue, 120) : undefined,
          checked: it.checked === true,
          tone: oneOf(it.tone, ['default', 'accent', 'warn', 'good', 'muted'] as const, 'default'),
        },
      ];
    });
  }

  if (kind === 'code' || typeof w.code === 'string') {
    widget.language = str(w.language, 20, 'typescript');
    const rawCode = typeof w.code === 'string' ? w.code : '';
    widget.code = rawCode.length > SCENE_LIMITS.code ? rawCode.slice(0, SCENE_LIMITS.code) + '\n// …truncated' : rawCode;
  }

  if (kind === 'slider') {
    const min = num(w.min, -100_000, 100_000, 0);
    const max = Math.max(min + 1, num(w.max, -100_000, 100_000, 100));
    const step = Math.max(0.01, num(w.step, 0.01, max - min, 1));
    widget.min = min;
    widget.max = max;
    widget.step = step;
    widget.initial = num(w.initial, min, max, Math.round((min + max) / 2));
    widget.multiplier = num(w.multiplier, -10_000, 10_000, 1);
    if (typeof w.unit === 'string') widget.unit = str(w.unit, 16);
    if (typeof w.formulaLabel === 'string') widget.formulaLabel = str(w.formulaLabel, 40);
  }

  return widget;
}

function validateUI(o: Obj, id: string, title: string): ValidationResult {
  const warnings: string[] = [];
  const rawWidgets = Array.isArray(o.widgets) ? o.widgets : [];
  if (rawWidgets.length === 0) return { ok: false, errors: ['ui scene needs at least one widget'] };
  if (rawWidgets.length > SCENE_LIMITS.widgets) warnings.push(`only the first ${SCENE_LIMITS.widgets} widgets are shown`);
  const used = new Set<string>();
  const widgets: SceneUIWidget[] = rawWidgets
    .slice(0, SCENE_LIMITS.widgets)
    .flatMap((w, i) => (isObj(w) ? [sanitizeUIWidget(w, used, i, warnings)].filter((x): x is SceneUIWidget => x !== null) : []));
  if (widgets.length === 0) return { ok: false, errors: ['no valid widgets'] };
  const widgetIds = new Set(widgets.map((w) => w.id));
  return {
    ok: true,
    warnings,
    scene: {
      kind: 'ui',
      id,
      title,
      subtitle: typeof o.subtitle === 'string' ? str(o.subtitle, 120) : undefined,
      layout: oneOf(o.layout, ['dashboard', 'stack', 'split'] as const, 'dashboard'),
      widgets,
      steps: steps(o.steps, widgetIds, warnings),
    },
  };
}

/** Validate an untrusted scene object (already JSON-parsed). */
export function validateScene(raw: unknown): ValidationResult {
  if (!isObj(raw)) return { ok: false, errors: ['scene must be a JSON object'] };
  const kind = raw.kind === '3d' ? '3d' : raw.kind === 'ui' ? 'ui' : raw.kind === '2d' || raw.kind === undefined ? '2d' : null;
  if (!kind) return { ok: false, errors: [`unknown scene kind "${String(raw.kind)}"`] };
  const id = typeof raw.id === 'string' && ID_RE.test(raw.id) ? raw.id : 'scene';
  const defaultTitle = kind === '3d' ? '3D model' : kind === 'ui' ? 'Interactive UI' : 'Diagram';
  const title = str(raw.title, SCENE_LIMITS.title, defaultTitle);
  if (kind === '3d') return validate3D(raw, id, title);
  if (kind === 'ui') return validateUI(raw, id, title);
  return validate2D(raw, id, title);
}

/** Parse + validate the text inside a <scene>…</scene> block. */
export function parseSceneJSON(text: string): ValidationResult {
  if (text.length > SCENE_LIMITS.jsonChars) return { ok: false, errors: ['scene too large'] };
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    return validateScene(JSON.parse(body));
  } catch (err) {
    return { ok: false, errors: [`scene JSON invalid: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

/** Compact description of a scene for the model's context on follow-ups. */
export function sceneForPrompt(scene: Scene): string {
  const json = JSON.stringify(scene);
  return json.length > 6000 ? json.slice(0, 6000) + '…(truncated)' : json;
}

/** Applies a validated ScenePatch to an existing Scene transactionally. */
export function applyScenePatch(scene: Scene, patch: ScenePatch): Scene {
  if (scene.id !== patch.id) return scene;

  if (scene.kind === '2d' && patch.kind === '2d-patch') {
    const removeNodes = new Set(patch.removeNodeIds ?? []);
    const removeEdges = new Set(patch.removeEdgeIds ?? []);

    // Filter surviving nodes
    let nodes = scene.nodes.filter((n) => !removeNodes.has(n.id));

    // Update or add new nodes
    if (patch.addNodes) {
      for (const added of patch.addNodes) {
        const idx = nodes.findIndex((n) => n.id === added.id);
        if (idx !== -1) nodes[idx] = added;
        else nodes.push(added);
      }
    }
    nodes = nodes.slice(0, SCENE_LIMITS.nodes);
    const validNodeIds = new Set(nodes.map((n) => n.id));

    // Filter surviving edges
    let edges = scene.edges.filter((e) => !removeEdges.has(e.id) && validNodeIds.has(e.from) && validNodeIds.has(e.to));
    if (patch.addEdges) {
      for (const added of patch.addEdges) {
        if (validNodeIds.has(added.from) && validNodeIds.has(added.to)) {
          const idx = edges.findIndex((e) => e.id === added.id);
          if (idx !== -1) edges[idx] = added;
          else edges.push(added);
        }
      }
    }
    edges = edges.slice(0, SCENE_LIMITS.edges);

    const merged: Scene2D = {
      kind: '2d',
      id: scene.id,
      title: patch.title ? str(patch.title, SCENE_LIMITS.title) : scene.title,
      layout: scene.layout,
      nodes,
      edges,
      steps: patch.steps ? steps(patch.steps, new Set([...validNodeIds, ...edges.map((e) => e.id)]), []) : scene.steps,
    };
    return merged;
  }

  if (scene.kind === '3d' && patch.kind === '3d-patch') {
    const removeParts = new Set(patch.removePartIds ?? []);

    // Filter surviving parts
    let parts = scene.parts.filter((p) => !removeParts.has(p.id));

    // Update or add new parts
    if (patch.addParts) {
      for (const added of patch.addParts) {
        const idx = parts.findIndex((p) => p.id === added.id);
        if (idx !== -1) parts[idx] = added;
        else parts.push(added);
      }
    }
    parts = parts.slice(0, SCENE_LIMITS.parts);
    const validPartIds = new Set(parts.map((p) => p.id));

    let animations = scene.animations.filter((a) => validPartIds.has(a.part));
    if (patch.animations) {
      for (const added of patch.animations) {
        if (validPartIds.has(added.part)) {
          const idx = animations.findIndex((a) => a.part === added.part);
          if (idx !== -1) animations[idx] = added;
          else animations.push(added);
        }
      }
    }
    animations = animations.slice(0, SCENE_LIMITS.animations);

    const merged: Scene3D = {
      kind: '3d',
      id: scene.id,
      title: patch.title ? str(patch.title, SCENE_LIMITS.title) : scene.title,
      parts,
      animations,
      steps: patch.steps ? steps(patch.steps, validPartIds, []) : scene.steps,
    };
    return merged;
  }

  if (scene.kind === 'ui' && patch.kind === 'ui-patch') {
    const removeWidgets = new Set(patch.removeWidgetIds ?? []);
    let widgets = scene.widgets.filter((w) => !removeWidgets.has(w.id));

    if (patch.addWidgets) {
      for (const added of patch.addWidgets) {
        const idx = widgets.findIndex((w) => w.id === added.id);
        if (idx !== -1) widgets[idx] = added;
        else widgets.push(added);
      }
    }
    widgets = widgets.slice(0, SCENE_LIMITS.widgets);
    const validWidgetIds = new Set(widgets.map((w) => w.id));

    const merged: SceneUI = {
      kind: 'ui',
      id: scene.id,
      title: patch.title ? str(patch.title, SCENE_LIMITS.title) : scene.title,
      subtitle: patch.subtitle ? str(patch.subtitle, 120) : scene.subtitle,
      layout: scene.layout,
      widgets,
      steps: patch.steps ? steps(patch.steps, validWidgetIds, []) : scene.steps,
    };
    return merged;
  }

  return scene;
}

/** Parses and validates a <scene-patch>…</scene-patch> block. */
export function parseScenePatchJSON(text: string): ValidationPatchResult {
  if (text.length > SCENE_LIMITS.jsonChars) return { ok: false, errors: ['patch too large'] };
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    const parsed = JSON.parse(body);
    if (!isObj(parsed)) return { ok: false, errors: ['patch must be an object'] };
    const kind =
      parsed.kind === '3d-patch' ? '3d-patch' :
      parsed.kind === 'ui-patch' ? 'ui-patch' :
      parsed.kind === '2d-patch' || parsed.kind === undefined ? '2d-patch' : null;
    if (!kind) return { ok: false, errors: [`unknown patch kind "${String(parsed.kind)}"`] };
    const id = typeof parsed.id === 'string' && ID_RE.test(parsed.id) ? parsed.id : '';
    if (!id) return { ok: false, errors: ['patch requires a valid target scene id'] };

    if (kind === '2d-patch') {
      const patch: ScenePatch2D = {
        kind: '2d-patch',
        id,
        title: typeof parsed.title === 'string' ? str(parsed.title, SCENE_LIMITS.title) : undefined,
        removeNodeIds: Array.isArray(parsed.removeNodeIds) ? parsed.removeNodeIds.filter((x): x is string => typeof x === 'string') : undefined,
        removeEdgeIds: Array.isArray(parsed.removeEdgeIds) ? parsed.removeEdgeIds.filter((x): x is string => typeof x === 'string') : undefined,
        addNodes: Array.isArray(parsed.addNodes) ? parsed.addNodes.filter(isObj).map((n, i) => ({
          id: typeof n.id === 'string' && ID_RE.test(n.id) ? n.id : `n_${i}`,
          label: str(n.label, SCENE_LIMITS.label, 'Node'),
          detail: str(n.detail, SCENE_LIMITS.detail),
          shape: oneOf(n.shape, ['box', 'pill', 'circle', 'diamond', 'note'] as const, 'box'),
          tone: oneOf(n.tone, ['default', 'accent', 'warn', 'good', 'muted'] as const, 'default'),
        })) : undefined,
        addEdges: Array.isArray(parsed.addEdges) ? parsed.addEdges.filter(isObj).map((e, i) => ({
          id: typeof e.id === 'string' && ID_RE.test(e.id) ? e.id : `e_${i}`,
          from: typeof e.from === 'string' ? e.from : '',
          to: typeof e.to === 'string' ? e.to : '',
          label: str(e.label, SCENE_LIMITS.label),
          dashed: e.dashed === true,
          flow: e.flow === true,
        })) : undefined,
      };
      return { ok: true, patch, warnings: [] };
    } else if (kind === '3d-patch') {
      const patch: ScenePatch3D = {
        kind: '3d-patch',
        id,
        title: typeof parsed.title === 'string' ? str(parsed.title, SCENE_LIMITS.title) : undefined,
        removePartIds: Array.isArray(parsed.removePartIds) ? parsed.removePartIds.filter((x): x is string => typeof x === 'string') : undefined,
        addParts: Array.isArray(parsed.addParts) ? parsed.addParts.filter(isObj).map((p, i) => {
          const shape = oneOf(p.shape, ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'tube', 'ring', 'prism', 'wedge'] as const, 'box');
          return {
            id: typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : `p_${i}`,
            label: str(p.label, SCENE_LIMITS.label, 'Part'),
            detail: str(p.detail, SCENE_LIMITS.detail),
            shape,
            size: partSize(shape, p.size),
            position: vec3(p.position, [0, 0, 0]),
            rotation: vec3(p.rotation, [0, 0, 0], -360, 360),
            color: typeof p.color === 'string' && COLOR_RE.test(p.color) ? p.color : '#60A5FA',
            opacity: num(p.opacity, 0.15, 1, 1),
          };
        }) : undefined,
      };
      return { ok: true, patch, warnings: [] };
    } else {
      const warnings: string[] = [];
      const used = new Set<string>();
      const patch: ScenePatchUI = {
        kind: 'ui-patch',
        id,
        title: typeof parsed.title === 'string' ? str(parsed.title, SCENE_LIMITS.title) : undefined,
        subtitle: typeof parsed.subtitle === 'string' ? str(parsed.subtitle, 120) : undefined,
        removeWidgetIds: Array.isArray(parsed.removeWidgetIds) ? parsed.removeWidgetIds.filter((x): x is string => typeof x === 'string') : undefined,
        addWidgets: Array.isArray(parsed.addWidgets)
          ? parsed.addWidgets.filter(isObj).flatMap((w, i) => [sanitizeUIWidget(w, used, i, warnings)].filter((x): x is SceneUIWidget => x !== null))
          : undefined,
      };
      return { ok: true, patch, warnings };
    }
  } catch (err) {
    return { ok: false, errors: [`patch JSON invalid: ${err instanceof Error ? err.message : String(err)}`] };
  }
}
