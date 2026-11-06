// SVG renderer for 2D scenes: laid-out nodes, curved edges with arrowheads,
// animated "flow" dots, pan/zoom, click/keyboard selection and step focus.
import type { Scene, Scene2D } from '../../shared/scene';
import { layoutScene2D, type Layout } from '../../shared/layout2d';
import type { SceneRenderer, SelectHandler } from './scene-types';

const SVG = 'http://www.w3.org/2000/svg';
const FONT = '600 13px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

const measureCtx = document.createElement('canvas').getContext('2d')!;
measureCtx.font = FONT;
const measure = (t: string) => measureCtx.measureText(t).width;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function shapePath(shape: Scene2D['nodes'][number]['shape'], w: number, h: number): SVGElement {
  switch (shape) {
    case 'circle':
      return el('ellipse', { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 });
    case 'diamond':
      return el('polygon', { points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}` });
    case 'pill':
      return el('rect', { width: w, height: h, rx: h / 2 });
    case 'note':
      return el('path', { d: `M0,0 H${w - 14} L${w},14 V${h} H0 Z` });
    case 'box':
      return el('rect', { width: w, height: h, rx: 10 });
  }
}

export class Scene2DRenderer implements SceneRenderer {
  private readonly svg: SVGSVGElement;
  private scene: Scene2D;
  private layout!: Layout;
  private view = { x: 0, y: 0, w: 100, h: 100 };
  private selected: string | null = null;
  private readonly cleanup: (() => void)[] = [];
  private uid = Math.random().toString(36).slice(2, 7);

  constructor(
    private readonly host: HTMLElement,
    scene: Scene2D,
    private readonly onSelect: SelectHandler,
  ) {
    this.scene = scene;
    this.svg = el('svg', { class: 'scene2d', role: 'img', 'aria-label': scene.title });
    host.append(this.svg);
    this.enablePanZoom();
    this.render(true);
  }

  update(scene: Scene): void {
    if (scene.kind !== '2d') return;
    this.scene = scene;
    if (this.selected && !scene.nodes.some((n) => n.id === this.selected)) this.selected = null;
    this.render(false);
  }

  private render(animate: boolean): void {
    const s = this.scene;
    const r = this.host.getBoundingClientRect();
    // wrap long flows to the panel's shape so text stays readable
    const maxMain = s.layout === 'flow-down' ? Math.max(360, r.height * 1.25) : Math.max(480, r.width * 1.25);
    this.lastHostSize = { w: r.width, h: r.height };
    this.layout = layoutScene2D(s, measure, { maxMain });
    this.svg.replaceChildren();
    this.svg.classList.toggle('enter', animate);

    const defs = el('defs');
    const marker = el('marker', {
      id: `arrow-${this.uid}`,
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: 'auto-start-reverse',
    });
    marker.append(el('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrowhead' }));
    defs.append(marker);
    this.svg.append(defs);

    const edgesG = el('g', { class: 'edges' });
    const nodesG = el('g', { class: 'nodes' });
    this.svg.append(edgesG, nodesG);

    s.edges.forEach((e, i) => {
      const p = this.layout.edges.find((x) => x.id === e.id)!;
      const g = el('g', { class: `edge${e.dashed ? ' dashed' : ''}`, 'data-id': e.id });
      g.style.setProperty('--i', String(i));
      const pathId = `p-${this.uid}-${e.id}`;
      const path = el('path', { id: pathId, d: p.d, 'marker-end': `url(#arrow-${this.uid})`, pathLength: 1 });
      g.append(path);
      if (e.flow) {
        for (let k = 0; k < 2; k++) {
          const dot = el('circle', { r: 3.2, class: 'flow-dot' });
          const anim = el('animateMotion', { dur: '2.2s', repeatCount: 'indefinite', begin: `${k * 1.1}s` });
          const mpath = el('mpath');
          mpath.setAttribute('href', `#${pathId}`);
          anim.append(mpath);
          dot.append(anim);
          g.append(dot);
        }
      }
      if (e.label) {
        const w = measure(e.label) * 0.92 + 12;
        const lg = el('g', { class: 'edge-label', transform: `translate(${p.mid.x - w / 2},${p.mid.y - 10})` });
        lg.append(el('rect', { width: w, height: 20, rx: 6 }), Object.assign(el('text', { x: w / 2, y: 14 }), { textContent: e.label }));
        g.append(lg);
      }
      edgesG.append(g);
    });

    s.nodes.forEach((n, i) => {
      const b = this.layout.boxes.get(n.id)!;
      const g = el('g', {
        class: `node tone-${n.tone} shape-${n.shape}`,
        'data-id': n.id,
        transform: `translate(${b.x},${b.y})`,
        tabindex: 0,
        role: 'button',
        'aria-label': n.detail ? `${n.label}: ${n.detail}` : n.label,
      });
      g.style.setProperty('--i', String(i));
      const inner = el('g', { class: 'node-inner' });
      inner.style.transformOrigin = `${b.w / 2}px ${b.h / 2}px`;
      inner.append(shapePath(n.shape, b.w, b.h));
      const text = el('text', { x: b.w / 2, y: b.h / 2 - ((b.lines.length - 1) * 18) / 2 + 5 });
      b.lines.forEach((line, li) => {
        const t = el('tspan', { x: b.w / 2, dy: li === 0 ? 0 : 18 });
        t.textContent = line;
        text.append(t);
      });
      inner.append(text);
      g.append(inner);
      const choose = () => this.choose(n.id);
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        choose();
      });
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          choose();
        }
      });
      nodesG.append(g);
    });
    this.applySelection();
    this.fit();
  }

  private choose(id: string): void {
    this.selected = this.selected === id ? null : id;
    this.applySelection();
    const n = this.scene.nodes.find((x) => x.id === this.selected);
    this.onSelect(n ? { itemId: n.id, label: n.label, detail: n.detail } : null);
  }

  select(id: string | null): void {
    this.selected = id;
    this.applySelection();
  }

  private applySelection(): void {
    this.svg.querySelectorAll<SVGGElement>('.node').forEach((g) => g.classList.toggle('selected', g.dataset.id === this.selected));
  }

  highlight(ids: string[]): void {
    const set = new Set(ids);
    const on = set.size > 0;
    this.svg.classList.toggle('focusing', on);
    this.svg.querySelectorAll<SVGGElement>('.node, .edge').forEach((g) => {
      const id = g.dataset.id ?? '';
      let lit = set.has(id);
      if (g.classList.contains('edge')) {
        const e = this.scene.edges.find((x) => x.id === id);
        lit = lit || (!!e && set.has(e.from) && set.has(e.to));
      }
      g.classList.toggle('lit', lit);
    });
  }

  /** Fit the whole diagram in the panel with a little margin. */
  fit(): void {
    const { width, height } = this.layout;
    const r = this.host.getBoundingClientRect();
    const aspect = r.width > 0 && r.height > 0 ? r.width / r.height : width / height;
    let w = width;
    let h = height;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    this.view = { x: (width - w) / 2, y: (height - h) / 2, w, h };
    this.applyView();
  }

  private applyView(): void {
    const v = this.view;
    this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }

  private enablePanZoom(): void {
    let drag: { x: number; y: number; vx: number; vy: number } | null = null;
    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest('.node')) return;
      drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      this.svg.setPointerCapture(e.pointerId);
      this.svg.classList.add('panning');
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const r = this.svg.getBoundingClientRect();
      const k = this.view.w / r.width;
      this.view.x = drag.vx - (e.clientX - drag.x) * k;
      this.view.y = drag.vy - (e.clientY - drag.y) * k;
      this.applyView();
    };
    const up = (e: PointerEvent) => {
      if (!drag) return;
      drag = null;
      this.svg.releasePointerCapture(e.pointerId);
      this.svg.classList.remove('panning');
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = this.svg.getBoundingClientRect();
      const k = Math.exp(e.deltaY * 0.0015);
      const mx = this.view.x + ((e.clientX - r.left) / r.width) * this.view.w;
      const my = this.view.y + ((e.clientY - r.top) / r.height) * this.view.h;
      const w = Math.min(Math.max(this.view.w * k, this.layout.width * 0.25), this.layout.width * 4);
      const s = w / this.view.w;
      this.view = { x: mx - (mx - this.view.x) * s, y: my - (my - this.view.y) * s, w, h: this.view.h * s };
      this.applyView();
    };
    const dbl = () => this.fit();
    this.svg.addEventListener('pointerdown', down);
    this.svg.addEventListener('pointermove', move);
    this.svg.addEventListener('pointerup', up);
    this.svg.addEventListener('pointercancel', up);
    this.svg.addEventListener('wheel', wheel, { passive: false });
    this.svg.addEventListener('dblclick', dbl);
    this.cleanup.push(() => {
      this.svg.removeEventListener('wheel', wheel);
      this.svg.removeEventListener('dblclick', dbl);
    });
  }

  private lastHostSize = { w: 0, h: 0 };

  resize(): void {
    const r = this.host.getBoundingClientRect();
    // re-wrap when the panel changes shape a lot, otherwise just refit
    if (Math.abs(r.width - this.lastHostSize.w) > 80 || Math.abs(r.height - this.lastHostSize.h) > 80) this.render(false);
    else this.fit();
  }

  destroy(): void {
    this.cleanup.forEach((f) => f());
    this.svg.remove();
  }
}
