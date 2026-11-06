// Deterministic quality checks for validated 3D scenes (F09 / M4).
// scene.ts guarantees a 3D scene is *well-formed*; this module checks whether it is *legible*:
// parts that float away from the assembly, near-duplicate parts, degenerate or vanishingly small
// parts, and assemblies that sit far from the origin or at an unusable scale.
// It runs without a GPU: bounds are computed from the same size conventions scene3d.ts uses.
// D2 says layout is ours; this is the 3D half of that ownership. It never invents geometry.
import type { Scene3D, ScenePart, Vec3 } from './scene';

export type LintSeverity = 'error' | 'warn' | 'info';
export type LintCode = 'floating' | 'duplicate' | 'degenerate' | 'tiny' | 'off-origin' | 'scale' | 'empty';

export interface LintIssue {
  code: LintCode;
  severity: LintSeverity;
  /** ids of the parts involved (base ids for mirror copies) */
  parts: string[];
  message: string;
}

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export interface Lint3DReport {
  issues: LintIssue[];
  stats: {
    parts: number;
    /** connected groups of touching parts; 1 means one coherent assembly */
    components: number;
    bounds: AABB;
    /** length of the assembly bounding-box diagonal */
    diagonal: number;
  };
  /** 0-100, 100 = no issues. Errors cost 25, warnings 10, info 0. */
  score: number;
}

const DEG = Math.PI / 180;
/** assembly diagonal outside this range is reported and corrected by normalise3D */
export const SCALE_RANGE = { min: 0.5, max: 40, target: 6 } as const;

/** Local (unrotated) half-extents, matching geometryFor() in renderer/overlay/scene3d.ts. */
function localBox(p: ScenePart): AABB {
  const s = p.size;
  const box = (hx: number, hy: number, hz: number): AABB => ({ min: [-hx, -hy, -hz], max: [hx, hy, hz] });
  switch (p.shape) {
    case 'box':
      return box(s[0]! / 2, s[1]! / 2, s[2]! / 2);
    case 'sphere':
      return box(s[0]!, s[0]!, s[0]!);
    case 'cylinder':
    case 'cone': {
      const r = Math.max(s[0]!, s[1]!);
      return box(r, s[2]! / 2, r);
    }
    case 'torus': {
      // TorusGeometry lies in the XY plane
      const r = s[0]! + s[1]!;
      return box(r, r, s[1]!);
    }
    case 'capsule':
      return box(s[0]!, s[1]! / 2 + s[0]!, s[0]!);
    case 'ring':
      // RingGeometry: flat disc in the XY plane
      return box(s[1]!, s[1]!, 0);
    case 'prism':
      return box(s[0]!, s[1]! / 2, s[0]!);
    case 'wedge':
      return box(s[0]! / 2, s[1]! / 2, s[2]! / 2);
    case 'tube':
      return box(s[1]!, s[2]! / 2, s[1]!);
    case 'ellipsoid':
      return box(s[0]!, s[1]!, s[2]!);
    case 'extrude': {
      const pts = p.points ?? [];
      if (!pts.length) return box(0, 0, 0);
      const xs = pts.map((q) => q[0]);
      const zs = pts.map((q) => q[1]);
      return { min: [Math.min(...xs), -s[0]! / 2, Math.min(...zs)], max: [Math.max(...xs), s[0]! / 2, Math.max(...zs)] };
    }
    case 'lathe': {
      const pts = p.points ?? [];
      if (!pts.length) return box(0, 0, 0);
      const r = Math.max(...pts.map((q) => q[0]));
      const ys = pts.map((q) => q[1]);
      return { min: [-r, Math.min(...ys), -r], max: [r, Math.max(...ys), r] };
    }
  }
}

/** Rotate the 8 corners (three.js default Euler order XYZ) and translate: world-space bounds. */
export function partBounds(p: ScenePart): AABB {
  const lb = localBox(p);
  const sign = p.mirrored ? -1 : 1;
  const [rx, ry, rz] = [p.rotation[0] * DEG, sign * p.rotation[1] * DEG, sign * p.rotation[2] * DEG];
  const [cx, sx] = [Math.cos(rx), Math.sin(rx)];
  const [cy, sy] = [Math.cos(ry), Math.sin(ry)];
  const [cz, sz] = [Math.cos(rz), Math.sin(rz)];
  // R = Rx * Ry * Rz (matrix for Euler 'XYZ')
  const m = [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
  ];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [lb.min[0], lb.max[0]]) {
    for (const y of [lb.min[1], lb.max[1]]) {
      for (const z of [lb.min[2], lb.max[2]]) {
        // the mirror copy is the base geometry flipped across x
        const lx = p.mirrored ? -x : x;
        for (let i = 0; i < 3; i++) {
          const v = m[i]![0]! * lx + m[i]![1]! * y + m[i]![2]! * z + p.position[i]!;
          if (v < min[i]!) min[i] = v;
          if (v > max[i]!) max[i] = v;
        }
      }
    }
  }
  return { min, max };
}

function union(boxes: AABB[]): AABB {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, b.min[i]!);
      max[i] = Math.max(max[i]!, b.max[i]!);
    }
  }
  return { min, max };
}

const extent = (b: AABB): Vec3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
const diag = (b: AABB) => Math.hypot(...extent(b));

/** Boxes touch if the gap on every axis is within the tolerance. */
function touches(a: AABB, b: AABB, tol: number): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.min[i]! - b.max[i]! > tol || b.min[i]! - a.max[i]! > tol) return false;
  }
  return true;
}

function volume(b: AABB, floor: number): number {
  const e = extent(b);
  return Math.max(e[0], floor) * Math.max(e[1], floor) * Math.max(e[2], floor);
}

function intersectionVolume(a: AABB, b: AABB, floor: number): number {
  let v = 1;
  for (let i = 0; i < 3; i++) {
    const lo = Math.max(a.min[i]!, b.min[i]!);
    const hi = Math.min(a.max[i]!, b.max[i]!);
    if (hi < lo) return 0;
    v *= Math.max(hi - lo, floor);
  }
  return v;
}

const baseId = (p: ScenePart) => p.mirrorOf ?? p.id;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function lint3D(scene: Scene3D): Lint3DReport {
  const parts = scene.parts;
  const issues: LintIssue[] = [];
  if (!parts.length) {
    return {
      issues: [{ code: 'empty', severity: 'error', parts: [], message: 'the scene has no parts' }],
      stats: { parts: 0, components: 0, bounds: { min: [0, 0, 0], max: [0, 0, 0] }, diagonal: 0 },
      score: 75,
    };
  }

  const boxes = parts.map(partBounds);
  const bounds = union(boxes);
  const d = Math.max(diag(bounds), 1e-6);
  const tol = Math.max(0.02, d * 0.02);
  const floor = d * 0.005;

  // degenerate / tiny
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.mirrored) continue; // reported once, on the base part
    const size = diag(boxes[i]!);
    if (size < 0.02) {
      issues.push({ code: 'degenerate', severity: 'error', parts: [p.id], message: `"${p.label}" has almost no size and will not be visible` });
    } else if (parts.length > 1 && size < d * 0.015) {
      issues.push({ code: 'tiny', severity: 'warn', parts: [p.id], message: `"${p.label}" is under 1.5% of the model's size and will be hard to see or click` });
    }
  }

  // near-duplicates: two different parts occupying almost the same box
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i]!;
      const b = parts[j]!;
      if (baseId(a) === baseId(b)) continue;
      const inter = intersectionVolume(boxes[i]!, boxes[j]!, floor);
      if (!inter) continue;
      const iou = inter / (volume(boxes[i]!, floor) + volume(boxes[j]!, floor) - inter);
      if (iou > 0.9) {
        issues.push({
          code: 'duplicate',
          severity: 'warn',
          parts: [baseId(a), baseId(b)],
          message: `"${a.label}" and "${b.label}" occupy the same space (overlap ${Math.round(iou * 100)}%); one hides the other`,
        });
      }
    }
  }

  // connectivity: union-find over touching boxes
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (touches(boxes[i]!, boxes[j]!, tol)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  parts.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length || volume(union(b.map((k) => boxes[k]!)), floor) - volume(union(a.map((k) => boxes[k]!)), floor));
  for (const g of sorted.slice(1)) {
    const ids = [...new Set(g.map((k) => baseId(parts[k]!)))];
    const labels = [...new Set(g.map((k) => parts[k]!.label))].slice(0, 3).map((l) => `"${l}"`).join(', ');
    issues.push({
      code: 'floating',
      severity: 'warn',
      parts: ids,
      message: `${labels}${ids.length > 3 ? '…' : ''} ${g.length === 1 ? 'floats' : 'float'} apart from the main assembly`,
    });
  }

  // placement and scale of the whole assembly
  const center: Vec3 = [0, 1, 2].map((i) => (bounds.min[i]! + bounds.max[i]!) / 2) as Vec3;
  const offset = Math.hypot(...center);
  if (offset > d * 0.5) {
    issues.push({ code: 'off-origin', severity: 'info', parts: [], message: `assembly centre is ${r2(offset)} units from the origin (normalised automatically)` });
  }
  if (d < SCALE_RANGE.min || d > SCALE_RANGE.max) {
    issues.push({ code: 'scale', severity: 'info', parts: [], message: `assembly is ${r2(d)} units across (normalised to ${SCALE_RANGE.target})` });
  }

  const cost = issues.reduce((n, x) => n + (x.severity === 'error' ? 25 : x.severity === 'warn' ? 10 : 0), 0);
  return {
    issues,
    stats: { parts: parts.length, components: groups.size, bounds, diagonal: r2(d) },
    score: Math.max(0, 100 - cost),
  };
}

function scalePart(p: ScenePart, k: number, shift: Vec3): ScenePart {
  // prism size[2] is a side count, not a length
  const size = p.size.map((v, i) => (p.shape === 'prism' && i === 2 ? v : v * k));
  return {
    ...p,
    size,
    position: [(p.position[0] - shift[0]) * k, (p.position[1] - shift[1]) * k, (p.position[2] - shift[2]) * k],
    points: p.points?.map(([a, b]) => [a * k, b * k] as [number, number]),
  };
}

/**
 * Centre the assembly on the origin and, if its size is outside SCALE_RANGE, rescale it to the target.
 * Mirror copies stay mirror images because x is centred on 0 only when the assembly is not symmetric
 * about x = 0 already (mirrored scenes keep their mirror plane).
 * Returns the same object when nothing needs to change.
 */
export function normalise3D(scene: Scene3D): Scene3D {
  if (!scene.parts.length) return scene;
  const bounds = union(scene.parts.map(partBounds));
  const d = diag(bounds);
  const hasMirror = scene.parts.some((p) => p.mirrored);
  const center: Vec3 = [0, 1, 2].map((i) => (bounds.min[i]! + bounds.max[i]!) / 2) as Vec3;
  if (hasMirror) center[0] = 0; // the mirror plane is x = 0 by construction
  const off = Math.hypot(...center);
  const k = d < SCALE_RANGE.min || d > SCALE_RANGE.max ? SCALE_RANGE.target / Math.max(d, 1e-6) : 1;
  if (k === 1 && off <= d * 0.5) return scene;
  const shift: Vec3 = off > d * 0.5 ? center : [0, 0, 0];
  return {
    ...scene,
    parts: scene.parts.map((p) => scalePart(p, k, shift)),
    animations: scene.animations.map((a) => (a.kind === 'slide' ? { ...a, amount: a.amount * k } : a)),
  };
}

/** One line per issue, for logs and the model's repair context. */
export function formatLint(report: Lint3DReport): string[] {
  return report.issues.map((i) => `[3d-lint ${i.severity}] ${i.code}: ${i.message}`);
}

