// Maps coordinates from screenshot-pixel space (what the model saw) to
// overlay-local DIP space (what we draw on).
import type { Annotation, Pt, RawAnnotation } from './types';

export interface Size {
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function makeMapper(image: Size, overlay: Size) {
  const sx = overlay.width / image.width;
  const sy = overlay.height / image.height;
  const pt = (x: number, y: number): Pt => ({
    x: clamp(x, 0, image.width) * sx,
    y: clamp(y, 0, image.height) * sy,
  });
  return { pt, scale: (v: number) => v * Math.min(sx, sy) };
}

export function mapAnnotation(raw: RawAnnotation, image: Size, overlay: Size): Annotation {
  const m = makeMapper(image, overlay);
  switch (raw.kind) {
    case 'point':
      return { kind: 'point', at: m.pt(raw.x, raw.y), label: raw.label };
    case 'circle':
      return { kind: 'circle', center: m.pt(raw.x, raw.y), radius: Math.max(14, m.scale(raw.r)), label: raw.label };
    case 'box': {
      const a = m.pt(Math.min(raw.x1, raw.x2), Math.min(raw.y1, raw.y2));
      const b = m.pt(Math.max(raw.x1, raw.x2), Math.max(raw.y1, raw.y2));
      return { kind: 'box', from: a, to: b, label: raw.label };
    }
    case 'arrow':
      return { kind: 'arrow', from: m.pt(raw.x1, raw.y1), to: m.pt(raw.x2, raw.y2), label: raw.label };
    case 'underline':
      return { kind: 'underline', from: m.pt(Math.min(raw.x1, raw.x2), raw.y), to: m.pt(Math.max(raw.x1, raw.x2), raw.y), label: raw.label };
  }
}

/** The single spot the buddy should fly to for an annotation. */
export function focusPoint(a: Annotation): Pt {
  switch (a.kind) {
    case 'point':
      return a.at;
    case 'circle':
      return { x: a.center.x + a.radius * 0.7, y: a.center.y + a.radius * 0.7 };
    case 'box':
      return { x: a.to.x, y: a.to.y };
    case 'arrow':
      return a.from;
    case 'underline':
      return { x: a.to.x, y: a.to.y };
  }
}

/** Fit a long-side limit while keeping aspect ratio (used to downscale screenshots). */
export function fitWithin(size: Size, maxLongSide: number): Size {
  const long = Math.max(size.width, size.height);
  if (long <= maxLongSide) return { width: Math.round(size.width), height: Math.round(size.height) };
  const k = maxLongSide / long;
  return { width: Math.round(size.width * k), height: Math.round(size.height * k) };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen area an annotation (plus its label) occupies, so the bubble can stay out of the way. */
export function annotationBounds(a: Annotation): Rect {
  let x1: number, y1: number, x2: number, y2: number;
  switch (a.kind) {
    case 'point':
      [x1, y1, x2, y2] = [a.at.x - 36, a.at.y - 36, a.at.x + 110, a.at.y + 70];
      break;
    case 'circle':
      [x1, y1, x2, y2] = [a.center.x - a.radius * 1.2, a.center.y - a.radius * 1.2 - 40, a.center.x + a.radius * 1.2, a.center.y + a.radius * 1.2];
      break;
    case 'box':
      [x1, y1, x2, y2] = [a.from.x - 8, a.from.y - 44, a.to.x + 8, a.to.y + 8];
      break;
    case 'underline':
      [x1, y1, x2, y2] = [a.from.x, a.from.y - 24, a.to.x, a.to.y + 48];
      break;
    case 'arrow':
      [x1, y1, x2, y2] = [Math.min(a.from.x, a.to.x) - 20, Math.min(a.from.y, a.to.y) - 40, Math.max(a.from.x, a.to.x) + 20, Math.max(a.from.y, a.to.y) + 20];
      break;
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
