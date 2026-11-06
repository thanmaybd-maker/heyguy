// The scene panel: a draggable, resizable card that hosts a 2D diagram or a
// 3D model, plays its explanation steps, and tracks what the user selected
// so the next question can be about that exact part.
import type { Scene } from '../../shared/scene';
import type { SceneSelection } from '../../shared/types';
import type { Rect } from '../../shared/geometry';
import { Scene2DRenderer } from './scene2d';
import { Scene3DRenderer, webglAvailable } from './scene3d';
import { SceneUIRenderer } from './scene-ui';
import type { PickedItem, SceneRenderer } from './scene-types';

const STEP_MS = 4200;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from overlay HTML`);
  return el as T;
}

/** Turn a 3D scene into a grid diagram when WebGL isn't available. */
function as2DFallback(scene: Scene): Scene {
  if (scene.kind === '2d' || scene.kind === 'ui') return scene;
  return {
    kind: '2d',
    id: scene.id,
    title: `${scene.title} (3D unavailable — parts view)`,
    layout: 'grid',
    nodes: scene.parts.filter((p) => !p.mirrored).map((p) => ({ id: p.id, label: p.label, detail: p.detail, shape: 'box', tone: 'default' })),
    edges: [],
    steps: scene.steps,
  };
}

export class ScenePanel {
  private readonly root = byId('scene-panel');
  private readonly body = byId('scene-body');
  private readonly title = byId('scene-title');
  private readonly caption = byId('scene-caption');
  private readonly detail = byId('scene-detail');
  private readonly detailLabel = byId('scene-detail-label');
  private readonly detailText = byId('scene-detail-text');
  private readonly status = byId('scene-status');
  private readonly btnPrev = byId<HTMLButtonElement>('scene-prev');
  private readonly btnNext = byId<HTMLButtonElement>('scene-next');
  private readonly btnPlay = byId<HTMLButtonElement>('scene-play');
  private readonly btnExplode = byId<HTMLButtonElement>('scene-explode');
  private readonly btnLabels = byId<HTMLButtonElement>('scene-labels');
  private renderer: SceneRenderer | null = null;
  private scene: Scene | null = null;
  private step = -1;
  private stepTimer = 0;
  private picked: PickedItem | null = null;
  private placed = false;
  private exploded = false;
  private labelsOn = false;
  private readonly resizeObs: ResizeObserver;

  constructor(
    private readonly handlers: {
      onClose: () => void;
      onSelectionChange: (s: SceneSelection | null) => void;
      askHint: () => string;
    },
  ) {
    byId('scene-close').addEventListener('click', () => this.close());
    byId('scene-clear').addEventListener('click', () => this.setPicked(null, true));
    this.btnPrev.addEventListener('click', () => this.goto(this.step - 1, false));
    this.btnNext.addEventListener('click', () => this.goto(this.step + 1, false));
    this.btnPlay.addEventListener('click', () => this.play());
    this.btnExplode.addEventListener('click', () => {
      this.exploded = !this.exploded;
      this.btnExplode.setAttribute('aria-pressed', String(this.exploded));
      if (this.renderer instanceof Scene3DRenderer) this.renderer.setExploded(this.exploded);
    });
    this.btnLabels.addEventListener('click', () => {
      this.labelsOn = !this.labelsOn;
      this.btnLabels.setAttribute('aria-pressed', String(this.labelsOn));
      if (this.renderer instanceof Scene3DRenderer) this.renderer.setLabels(this.labelsOn);
    });
    this.setupDrag(byId('scene-head'));
    this.resizeObs = new ResizeObserver(() => this.renderer?.resize());
    this.resizeObs.observe(this.body);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  get selection(): SceneSelection | null {
    if (!this.scene || !this.picked) return null;
    return { sceneId: this.scene.id, sceneTitle: this.scene.title, ...this.picked };
  }

  rect(): Rect | null {
    if (!this.visible) return null;
    const r = this.root.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  private place(kind: Scene['kind']): void {
    if (this.placed) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = Math.min(kind === '3d' ? 600 : kind === 'ui' ? 680 : 640, W - 48);
    const h = Math.min(kind === '3d' ? 520 : kind === 'ui' ? 560 : 460, H - 48);
    this.root.style.width = `${w}px`;
    this.root.style.height = `${h}px`;
    this.root.style.left = `${Math.max(24, W - w - 40)}px`;
    this.root.style.top = `${Math.max(24, (H - h) / 2)}px`;
    this.placed = true;
  }

  /** Placeholder while the model is still writing the scene. */
  showDrawing(): void {
    this.place(this.scene?.kind ?? '2d');
    this.root.classList.remove('hidden');
    this.root.dataset.busy = 'true';
    this.status.textContent = this.scene ? 'Updating…' : 'Drawing…';
  }

  showError(message: string): void {
    delete this.root.dataset.busy;
    if (!this.scene) {
      this.root.classList.add('hidden');
      return;
    }
    this.status.textContent = message;
  }

  show(scene: Scene): void {
    const shown = scene.kind === '3d' && !webglAvailable() ? as2DFallback(scene) : scene;
    const kind = shown.kind;
    this.place(kind);
    this.root.classList.remove('hidden');
    delete this.root.dataset.busy;
    this.root.dataset.kind = kind;
    this.status.textContent = '';
    this.title.textContent = shown.title;
    const sameScene = this.renderer && this.scene && this.scene.id === shown.id && this.scene.kind === shown.kind;
    if (sameScene) {
      this.renderer!.update(shown);
    } else {
      this.renderer?.destroy();
      this.exploded = false;
      this.btnExplode.setAttribute('aria-pressed', 'false');
      const select = (item: PickedItem | null) => this.setPicked(item, false);
      this.renderer =
        kind === '3d'
          ? new Scene3DRenderer(this.body, shown as Extract<Scene, { kind: '3d' }>, select)
          : kind === 'ui'
            ? new SceneUIRenderer(this.body, shown as Extract<Scene, { kind: 'ui' }>, select)
            : new Scene2DRenderer(this.body, shown as Extract<Scene, { kind: '2d' }>, select);
      if (this.renderer instanceof Scene3DRenderer) this.renderer.setLabels(this.labelsOn);
    }
    this.scene = shown;
    // keep a selection if that item still exists, otherwise clear it
    const ids =
      shown.kind === '2d'
        ? shown.nodes.map((n) => n.id)
        : shown.kind === '3d'
          ? shown.parts.map((p) => p.id)
          : shown.widgets.map((w) => w.id);
    if (this.picked && !ids.includes(this.picked.itemId)) this.setPicked(null, false);
    else if (this.picked) this.renderer!.select(this.picked.itemId);
    const hasSteps = shown.steps.length > 0;
    this.root.dataset.steps = String(hasSteps);
    this.step = -1;
    this.caption.textContent = hasSteps ? 'Press ▶ to walk through it, or click any part.' : 'Click any part to learn about it.';
    if (hasSteps) this.play();
    else this.renderer!.highlight([]);
  }

  /** Auto-advance through the steps once. */
  play(): void {
    if (!this.scene?.steps.length) return;
    this.goto(0, true);
  }

  /** Synchronize active step with spoken sentence index. */
  syncStep(i: number): void {
    if (!this.scene?.steps.length || this.picked) return;
    if (i >= 0 && i < this.scene.steps.length) {
      this.goto(i, false);
    }
  }

  private goto(i: number, auto: boolean): void {
    const steps = this.scene?.steps ?? [];
    clearTimeout(this.stepTimer);
    if (!steps.length) return;
    if (i >= steps.length) {
      // finished: clear focus so the whole model is visible again
      this.step = -1;
      this.renderer?.highlight([]);
      this.caption.textContent = 'Click any part to ask about it.';
      this.updateStepButtons();
      return;
    }
    this.step = Math.max(0, i);
    const s = steps[this.step]!;
    this.renderer?.highlight(s.focus);
    this.caption.textContent = `${this.step + 1}/${steps.length} · ${s.caption}`;
    this.updateStepButtons();
    if (auto) this.stepTimer = window.setTimeout(() => this.goto(this.step + 1, true), STEP_MS);
  }

  private updateStepButtons(): void {
    const n = this.scene?.steps.length ?? 0;
    this.btnPrev.disabled = this.step <= 0;
    this.btnNext.disabled = n === 0;
  }

  private setPicked(item: PickedItem | null, fromClear: boolean): void {
    this.picked = item;
    if (fromClear) this.renderer?.select(null);
    this.detail.classList.toggle('hidden', !item);
    if (item) {
      // picking a part ends the walkthrough so the whole model is visible again
      clearTimeout(this.stepTimer);
      this.step = -1;
      this.renderer?.highlight([]);
      this.caption.textContent = this.scene?.steps.length ? 'Press ▶ to replay the walkthrough.' : '';
      this.updateStepButtons();
      this.detailLabel.textContent = item.label;
      this.detailText.textContent = item.detail || 'No description.';
      byId('scene-ask-hint').textContent = `Press ${this.handlers.askHint()} to ask about it.`;
    }
    this.handlers.onSelectionChange(this.selection);
  }

  close(): void {
    clearTimeout(this.stepTimer);
    this.renderer?.destroy();
    this.renderer = null;
    this.scene = null;
    this.setPicked(null, false);
    this.root.classList.add('hidden');
    delete this.root.dataset.busy;
    this.handlers.onClose();
  }

  private setupDrag(handle: HTMLElement): void {
    let start: { x: number; y: number; left: number; top: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button')) return;
      const r = this.root.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      handle.setPointerCapture(e.pointerId);
      this.root.classList.add('dragging');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const r = this.root.getBoundingClientRect();
      const left = Math.min(window.innerWidth - 80, Math.max(-r.width + 80, start.left + e.clientX - start.x));
      const top = Math.min(window.innerHeight - 40, Math.max(0, start.top + e.clientY - start.y));
      this.root.style.left = `${left}px`;
      this.root.style.top = `${top}px`;
    });
    const end = (e: PointerEvent) => {
      if (!start) return;
      start = null;
      handle.releasePointerCapture(e.pointerId);
      this.root.classList.remove('dragging');
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
}
