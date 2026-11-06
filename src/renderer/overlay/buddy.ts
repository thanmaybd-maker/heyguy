// The buddy: a glowing blue cursor-shaped character drawn on Canvas 2D.
// Its origin (0,0) is the triangle's tip, so "pointing at" a spot means
// placing the origin exactly there.
import type { BuddyState, Pt } from '../../shared/types';

const FOLLOW_OFFSET = { x: 16, y: 18 };
const SIZE = 1.4;
// Triangle (tip at origin), rounded with arcTo when drawn.
const SHAPE: Pt[] = [
  { x: 0, y: 0 },
  { x: 6, y: 22 },
  { x: 20, y: 13 },
];
const CENTROID = { x: (0 + 6 + 20) / 3, y: (0 + 22 + 13) / 3 };
/** Direction the tip points in its resting pose (up-left). */
const REST_DIR = Math.atan2(-CENTROID.y, -CENTROID.x);

const COLORS = {
  light: '#8CC8FF',
  base: '#2F7BFF',
  deep: '#1D4ED8',
  glow: 'rgba(59,130,246,0.95)',
  listen: '#22D3EE',
  error: '#FF5A6E',
};

interface Flight {
  from: Pt;
  ctrl: Pt;
  to: Pt;
  start: number;
  dur: number;
  onArrive: () => void;
}

type Mode = 'follow' | 'fly' | 'perch';

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function angleLerp(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Buddy {
  pos: Pt = { x: -100, y: -100 };
  private vel: Pt = { x: 0, y: 0 };
  private cursor: Pt = { x: -100, y: -100 };
  private mode: Mode = 'follow';
  private flight: Flight | null = null;
  private perchAt: Pt = { x: 0, y: 0 };
  private angle = 0;
  private stretch = 0;
  private placed = false;
  state: BuddyState = 'idle';
  level = 0;
  private speakPulse = 0;
  private errorFlash = 0;
  private blinkAt = 2000;
  private blink = 0;

  setCursor(p: Pt): void {
    this.cursor = p;
    if (!this.placed) {
      this.placed = true;
      this.pos = { x: p.x + FOLLOW_OFFSET.x, y: p.y + FOLLOW_OFFSET.y };
    }
  }

  get isHome(): boolean {
    return this.mode === 'follow';
  }

  pulse(): void {
    this.speakPulse = 1;
  }

  flashError(): void {
    this.errorFlash = 1;
  }

  /** Fly the tip to `to` along a gentle arc. */
  flyTo(to: Pt, now: number, onArrive: () => void): void {
    const from = { ...this.pos };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const bend = Math.min(160, dist * 0.25);
    // perpendicular offset for a natural swoop
    const ctrl = { x: (from.x + to.x) / 2 - (dy / (dist || 1)) * bend, y: (from.y + to.y) / 2 + (dx / (dist || 1)) * bend };
    this.flight = { from, ctrl, to, start: now, dur: Math.min(950, 380 + dist * 0.45), onArrive };
    this.mode = 'fly';
  }

  home(): void {
    this.mode = 'follow';
    this.flight = null;
  }

  update(dt: number, now: number): void {
    dt = Math.min(dt, 1 / 30);
    this.speakPulse = Math.max(0, this.speakPulse - dt * 3.2);
    this.errorFlash = Math.max(0, this.errorFlash - dt * 1.2);
    this.blinkAt -= dt * 1000;
    if (this.blinkAt <= 0) {
      this.blink = 1;
      this.blinkAt = 2400 + Math.random() * 3200;
    }
    this.blink = Math.max(0, this.blink - dt * 7);

    let targetAngle = 0;
    if (this.mode === 'fly' && this.flight) {
      const f = this.flight;
      const t = Math.min(1, (now - f.start) / f.dur);
      const e = easeInOut(t);
      const prev = this.pos;
      const u = 1 - e;
      this.pos = {
        x: u * u * f.from.x + 2 * u * e * f.ctrl.x + e * e * f.to.x,
        y: u * u * f.from.y + 2 * u * e * f.ctrl.y + e * e * f.to.y,
      };
      const vx = (this.pos.x - prev.x) / dt;
      const vy = (this.pos.y - prev.y) / dt;
      const speed = Math.hypot(vx, vy);
      this.vel = { x: vx, y: vy };
      if (speed > 40) targetAngle = Math.atan2(vy, vx) - REST_DIR;
      this.stretch = lerp(this.stretch, Math.min(0.35, speed / 4000), 0.3);
      if (t >= 1) {
        this.mode = 'perch';
        this.perchAt = { ...f.to };
        this.vel = { x: 0, y: 0 };
        const cb = f.onArrive;
        this.flight = null;
        cb();
      }
    } else {
      const target =
        this.mode === 'follow'
          ? { x: this.cursor.x + FOLLOW_OFFSET.x, y: this.cursor.y + FOLLOW_OFFSET.y }
          : { x: this.perchAt.x, y: this.perchAt.y + Math.sin(now / 420) * 1.5 };
      // slightly under-damped spring: lively but not wobbly
      const k = this.mode === 'follow' ? 260 : 400;
      const c = 2 * Math.sqrt(k) * 0.82;
      this.vel.x += ((target.x - this.pos.x) * k - this.vel.x * c) * dt;
      this.vel.y += ((target.y - this.pos.y) * k - this.vel.y * c) * dt;
      this.pos.x += this.vel.x * dt;
      this.pos.y += this.vel.y * dt;
      targetAngle = Math.max(-0.35, Math.min(0.35, this.vel.x * 0.0009));
      this.stretch = lerp(this.stretch, Math.min(0.2, Math.hypot(this.vel.x, this.vel.y) / 6000), 0.2);
    }
    this.angle = angleLerp(this.angle, targetAngle, Math.min(1, dt * 14));
  }

  draw(ctx: CanvasRenderingContext2D, now: number): void {
    const { x, y } = this.pos;
    const breathe = 1 + Math.sin(now / 900) * 0.025;
    const s = SIZE * breathe * (1 + this.speakPulse * 0.08);
    const cx = x + CENTROID.x * s;
    const cy = y + CENTROID.y * s;

    // listening: rings that grow with mic level
    if (this.state === 'listening') {
      for (let i = 0; i < 2; i++) {
        const phase = ((now / 900 + i * 0.5) % 1 + 1) % 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 16 + phase * 22 + this.level * 18, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(34,211,238,${(1 - phase) * (0.35 + this.level * 0.6)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // thinking / transcribing: orbiting dots
    if (this.state === 'thinking' || this.state === 'transcribing') {
      for (let i = 0; i < 3; i++) {
        const a = now / 260 + (i * Math.PI * 2) / 3;
        const r = 22 + Math.sin(now / 300 + i) * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85, 2.6 - i * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(140,200,255,${0.95 - i * 0.22})`;
        ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.angle);
    // squash & stretch along the travel direction (tip stays put)
    ctx.scale(s * (1 + this.stretch), s * (1 - this.stretch * 0.6));

    const listening = this.state === 'listening';
    const err = this.errorFlash;
    ctx.shadowColor = err > 0.05 ? `rgba(255,90,110,${0.6 + err * 0.4})` : listening ? 'rgba(34,211,238,0.95)' : COLORS.glow;
    ctx.shadowBlur = 14 + this.speakPulse * 16 + (this.state === 'speaking' ? 4 : 0);

    ctx.beginPath();
    roundedPolygon(ctx, SHAPE, 3.2);
    const g = ctx.createLinearGradient(0, 0, 20, 22);
    if (err > 0.05) {
      g.addColorStop(0, '#FFC2CB');
      g.addColorStop(1, COLORS.error);
    } else {
      g.addColorStop(0, listening ? '#A5F3FC' : COLORS.light);
      g.addColorStop(0.55, listening ? '#22B8E8' : COLORS.base);
      g.addColorStop(1, COLORS.deep);
    }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();

    // face
    const eyeH = 1.9 * (1 - this.blink * 0.9);
    ctx.fillStyle = '#FFFFFF';
    for (const ex of [{ x: 7.2, y: 11.6 }, { x: 11.4, y: 10.2 }]) {
      ctx.beginPath();
      ctx.ellipse(ex.x, ex.y, 1.45, Math.max(0.25, eyeH), -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.state === 'speaking') {
      ctx.beginPath();
      ctx.ellipse(10.2, 14.6, 1.6, 0.5 + this.speakPulse * 1.3, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function roundedPolygon(ctx: CanvasRenderingContext2D, pts: Pt[], r: number): void {
  const n = pts.length;
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(pts[n - 1]!, pts[0]!);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const next = pts[(i + 1) % n]!;
    // sharper tip so the point is precise
    ctx.arcTo(p.x, p.y, next.x, next.y, i === 0 ? 0.8 : r);
  }
  ctx.closePath();
}
