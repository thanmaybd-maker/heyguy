// Hand-drawn-looking annotations (circle, box, underline, arrow, point) that
// animate in like a marker stroke, show a label pill, then fade out.
import type { Annotation, Pt } from '../../shared/types';

const STROKE = '#3B82F6';
const STROKE_SOFT = 'rgba(59,130,246,0.20)';
const GLOW = 'rgba(59,130,246,0.85)';
const DRAW_MS = 520;
const FADE_MS = 450;

interface Item {
  ann: Annotation;
  path: Pt[];
  born: number;
  fadeAt: number | null;
  seed: number;
}

/** Deterministic wobble so each stroke looks hand-drawn but doesn't jitter per frame. */
function wobble(seed: number, t: number, amp: number): number {
  return Math.sin(seed * 12.9898 + t * 6.1) * amp * 0.6 + Math.sin(seed * 78.233 + t * 13.7) * amp * 0.4;
}

function circlePath(c: Pt, r: number, seed: number): Pt[] {
  const pts: Pt[] = [];
  const start = -Math.PI * 0.6;
  const sweep = Math.PI * 2 + 0.45; // overshoot like a real pen
  const steps = Math.max(48, Math.round(r * 1.2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + sweep * t;
    const rr = r * (1.08 + t * 0.06) + wobble(seed, t, r * 0.05);
    pts.push({ x: c.x + Math.cos(a) * rr * 1.06, y: c.y + Math.sin(a) * rr * 0.94 });
  }
  return pts;
}

function linePath(a: Pt, b: Pt, seed: number, amp: number): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(8, Math.round(len / 6));
  const nx = -(b.y - a.y) / (len || 1);
  const ny = (b.x - a.x) / (len || 1);
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const w = wobble(seed, t, amp);
    pts.push({ x: a.x + (b.x - a.x) * t + nx * w, y: a.y + (b.y - a.y) * t + ny * w });
  }
  return pts;
}

function boxPath(from: Pt, to: Pt, seed: number): Pt[] {
  const pad = 6;
  const a = { x: from.x - pad, y: from.y - pad };
  const b = { x: to.x + pad, y: to.y + pad };
  const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, { x: a.x + 14, y: a.y - 2 }];
  const pts: Pt[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const seg = linePath(corners[i]!, corners[i + 1]!, seed + i, 1.6);
    pts.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return pts;
}

function arrowPath(from: Pt, to: Pt): Pt[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(80, len * 0.22);
  const ctrl = { x: (from.x + to.x) / 2 + (dy / len) * bend, y: (from.y + to.y) / 2 - (dx / len) * bend };
  const steps = Math.max(16, Math.round(len / 6));
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({ x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x, y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y });
  }
  return pts;
}

function buildPath(a: Annotation, seed: number): Pt[] {
  switch (a.kind) {
    case 'circle':
      return circlePath(a.center, a.radius, seed);
    case 'box':
      return boxPath(a.from, a.to, seed);
    case 'underline':
      return linePath({ x: a.from.x, y: a.from.y + 6 }, { x: a.to.x, y: a.to.y + 6 }, seed, 2.2);
    case 'arrow':
      return arrowPath(a.from, a.to);
    case 'point':
      return [];
  }
}

/** Where to put the label pill, and whether it sits above or below. */
function labelAnchor(a: Annotation): { at: Pt; above: boolean } {
  switch (a.kind) {
    case 'point':
      return { at: { x: a.at.x + 26, y: a.at.y + 40 }, above: false };
    case 'circle':
      return { at: { x: a.center.x, y: a.center.y - a.radius * 1.15 - 10 }, above: true };
    case 'box':
      return { at: { x: (a.from.x + a.to.x) / 2, y: a.from.y - 16 }, above: true };
    case 'underline':
      return { at: { x: (a.from.x + a.to.x) / 2, y: a.from.y + 22 }, above: false };
    case 'arrow':
      return { at: { x: a.from.x, y: a.from.y - 14 }, above: true };
  }
}

export class AnnotationLayer {
  private items: Item[] = [];
  private seed = 1;

  get count(): number {
    return this.items.length;
  }

  add(ann: Annotation, now: number): void {
    const seed = this.seed++;
    this.items.push({ ann, path: buildPath(ann, seed), born: now, fadeAt: null, seed });
  }

  fadeAll(now: number): void {
    for (const it of this.items) if (it.fadeAt === null) it.fadeAt = now;
  }

  clear(): void {
    this.items = [];
  }

  draw(ctx: CanvasRenderingContext2D, now: number, viewport: { width: number; height: number }): void {
    this.items = this.items.filter((it) => it.fadeAt === null || now - it.fadeAt < FADE_MS);
    for (const it of this.items) {
      const progress = Math.min(1, (now - it.born) / DRAW_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const alpha = it.fadeAt === null ? 1 : Math.max(0, 1 - (now - it.fadeAt) / FADE_MS);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (it.ann.kind === 'point') drawPoint(ctx, it.ann.at, now - it.born);
      else drawStroke(ctx, it.path, eased, it.ann.kind === 'arrow');
      if (it.ann.label && progress >= 1) {
        const labelAlpha = Math.min(1, (now - it.born - DRAW_MS) / 220);
        ctx.globalAlpha = alpha * labelAlpha;
        drawLabel(ctx, it.ann.label, labelAnchor(it.ann), viewport);
      }
      ctx.restore();
    }
  }
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.stroke();
}

function drawStroke(ctx: CanvasRenderingContext2D, path: Pt[], progress: number, arrowHead: boolean): void {
  if (path.length < 2) return;
  const n = Math.max(2, Math.ceil(path.length * progress));
  const pts = path.slice(0, n);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // soft marker underlay
  ctx.strokeStyle = STROKE_SOFT;
  ctx.lineWidth = 11;
  strokePolyline(ctx, pts);
  // crisp glowing ink
  ctx.shadowColor = GLOW;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 3.6;
  strokePolyline(ctx, pts);
  if (arrowHead && progress > 0.92) {
    const tip = path[path.length - 1]!;
    const back = path[Math.max(0, path.length - 5)]!;
    const a = Math.atan2(tip.y - back.y, tip.x - back.x);
    const size = 16;
    ctx.beginPath();
    ctx.moveTo(tip.x - Math.cos(a - 0.5) * size, tip.y - Math.sin(a - 0.5) * size);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(tip.x - Math.cos(a + 0.5) * size, tip.y - Math.sin(a + 0.5) * size);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawPoint(ctx: CanvasRenderingContext2D, at: Pt, age: number): void {
  // two expanding ripples that keep pulsing gently
  for (let i = 0; i < 2; i++) {
    const phase = ((age / 1300 + i * 0.5) % 1 + 1) % 1;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 6 + phase * 26, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(59,130,246,${0.75 * (1 - phase)})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(at.x, at.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = STROKE;
  ctx.shadowColor = GLOW;
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  anchor: { at: Pt; above: boolean },
  viewport: { width: number; height: number },
): void {
  const label = text.length > 40 ? text.slice(0, 39) + '…' : text;
  ctx.font = '600 12.5px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  const w = ctx.measureText(label).width + 20;
  const h = 24;
  let x = anchor.at.x - w / 2;
  let y = anchor.above ? anchor.at.y - h : anchor.at.y;
  x = Math.max(6, Math.min(viewport.width - w - 6, x));
  y = Math.max(6, Math.min(viewport.height - h - 6, y));
  ctx.shadowColor = 'rgba(15,23,42,0.35)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 12);
  ctx.fillStyle = '#2563EB';
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 10, y + h / 2 + 0.5);
}
