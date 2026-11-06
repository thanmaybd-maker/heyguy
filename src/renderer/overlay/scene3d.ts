// Three.js renderer for 3D scenes: parts built from vetted primitives (never
// model-supplied code), orbit controls, click-to-select via raycasting, hover
// highlight, labels, exploded view, simple mechanism animation and step focus.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Scene, Scene3D, ScenePart, SceneAnimation } from '../../shared/scene';
import type { SceneRenderer, SelectHandler } from './scene-types';

const DEG = Math.PI / 180;
const SELECT_COLOR = new THREE.Color('#3B82F6');

interface PartView {
  part: ScenePart;
  /** carries the base position/rotation (and explode offset) */
  pivot: THREE.Group;
  /** animated in the part's own frame */
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  label: CSS2DObject;
  basePos: THREE.Vector3;
  explodeDir: THREE.Vector3;
}

function geometryFor(p: ScenePart): THREE.BufferGeometry {
  const s = p.size;
  switch (p.shape) {
    case 'box':
      return new THREE.BoxGeometry(s[0], s[1], s[2]);
    case 'sphere':
      return new THREE.SphereGeometry(s[0], 40, 28);
    case 'cylinder':
      return new THREE.CylinderGeometry(s[0], s[1], s[2], 48);
    case 'cone':
      return new THREE.CylinderGeometry(s[0], s[1], s[2], 48);
    case 'torus':
      return new THREE.TorusGeometry(s[0], s[1], 24, 64);
    case 'capsule':
      return new THREE.CapsuleGeometry(s[0], s[1], 8, 24);
    case 'ring':
      return new THREE.RingGeometry(s[0], s[1], 48);
    case 'prism':
      return new THREE.CylinderGeometry(s[0], s[0], s[1], Math.round(s[2] ?? 6));
    case 'wedge': {
      // right-angle ramp: [width (x), height (y), depth (z)], high edge at the back
      const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(s[2]!, 0), new THREE.Vector2(0, s[1]!)]);
      const g = new THREE.ExtrudeGeometry(shape, { depth: s[0]!, bevelEnabled: false });
      g.rotateY(-Math.PI / 2);
      g.center();
      return g;
    }
    case 'tube': {
      // hollow cylinder [innerRadius, outerRadius, height]
      const [rIn, rOut, h] = [s[0]!, s[1]!, s[2]!];
      const profile = [new THREE.Vector2(rIn, -h / 2), new THREE.Vector2(rOut, -h / 2), new THREE.Vector2(rOut, h / 2), new THREE.Vector2(rIn, h / 2), new THREE.Vector2(rIn, -h / 2)];
      return new THREE.LatheGeometry(profile, 48);
    }
    case 'ellipsoid': {
      const g = new THREE.SphereGeometry(1, 48, 32);
      g.scale(s[0]!, s[1]!, s[2]!);
      return g;
    }
    case 'extrude': {
      // outline drawn in the top view as [x, z]; extruded upward (+y) by the thickness
      const pts = (p.points ?? []).map(([x, z]) => new THREE.Vector2(x, -z));
      const bevel = s[1] ?? 0;
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
        depth: s[0]!,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 2,
        curveSegments: 4,
      });
      g.rotateX(-Math.PI / 2); // shape plane XY -> XZ, extrusion along +y
      g.translate(0, -s[0]! / 2, 0);
      return g;
    }
    case 'lathe': {
      const pts = (p.points ?? []).map(([r, y]) => new THREE.Vector2(r, y));
      return new THREE.LatheGeometry(pts, 56);
    }
  }
}

/** Mirror a geometry across the x plane, keeping faces outward (winding is reversed by the flip). */
function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.index ? g.toNonIndexed() : g;
  if (m !== g) g.dispose();
  m.scale(-1, 1, 1);
  for (const name of Object.keys(m.attributes)) {
    const attr = m.getAttribute(name) as THREE.BufferAttribute;
    const n = attr.itemSize;
    const arr = attr.array as Float32Array;
    for (let t = 0; t < attr.count; t += 3) {
      // swap vertex 1 and 2 of each triangle
      for (let k = 0; k < n; k++) {
        const a = (t + 1) * n + k;
        const b = (t + 2) * n + k;
        const tmp = arr[a]!;
        arr[a] = arr[b]!;
        arr[b] = tmp;
      }
    }
    attr.needsUpdate = true;
  }
  return m;
}

/** Parts that mirror each other share one identity for selection and focus. */
const groupId = (p: ScenePart) => p.mirrorOf ?? p.id;

/** True if WebGL can be used at all (otherwise we fall back to a 2D view). */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Visual-harness mode (overlay loaded with ?still=1 by HEYGUY_FIXTURES): no auto-rotate, animation
 * clock frozen at t=0 and no damping, so the same scene renders the same pixels every run. Render
 * statistics are published on window.__heyguy3d for the harness report. Never set in normal use.
 */
const STILL = new URLSearchParams(location.search).has('still');

export interface Render3DStats {
  triangles: number;
  drawCalls: number;
  geometries: number;
  textures: number;
  parts: number;
  /** frames rendered during the last full second */
  fps: number;
}

export class Scene3DRenderer implements SceneRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labels: CSS2DRenderer;
  private readonly scene3 = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
  private readonly controls: OrbitControls;
  private readonly root = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private views: PartView[] = [];
  private animations: SceneAnimation[] = [];
  private scene: Scene3D;
  private selected: string | null = null;
  private hovered: string | null = null;
  private focus = new Set<string>();
  private explode = 0;
  private explodeTarget = 0;
  private showAllLabels = false;
  private playing = !STILL;
  private frame = 0;
  private readonly clock = new THREE.Clock();
  private readonly cleanup: (() => void)[] = [];
  private framedOnce = false;

  constructor(
    private readonly host: HTMLElement,
    scene: Scene3D,
    private readonly onSelect: SelectHandler,
  ) {
    this.scene = scene;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'scene3d';
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'scene3d-labels';
    host.append(this.renderer.domElement, this.labels.domElement);

    this.scene3.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 5);
    const rim = new THREE.DirectionalLight(0x93c5fd, 0.7);
    rim.position.set(-5, 3, -4);
    this.scene3.add(key, rim, this.root);
    const grid = new THREE.GridHelper(8, 16, 0x334155, 0x1e293b);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.name = 'grid';
    this.scene3.add(grid);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !STILL;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = !STILL;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.addEventListener('start', () => (this.controls.autoRotate = false));

    this.bindPointer();
    this.build();
    this.resize();
    this.loop();
  }

  // -------------------------------------------------------------- building

  private build(): void {
    for (const v of this.views) {
      v.mesh.geometry.dispose();
      v.material.dispose();
      v.label.element.remove();
    }
    this.root.clear();
    this.views = [];
    this.animations = this.scene.animations;

    for (const part of this.scene.parts) {
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color),
        roughness: 0.42,
        metalness: 0.18,
        transparent: part.opacity < 1,
        opacity: part.opacity,
        depthWrite: part.opacity >= 1,
      });
      const geometry = part.mirrored ? mirrorX(geometryFor(part)) : geometryFor(part);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.partId = groupId(part);
      const pivot = new THREE.Group();
      pivot.position.set(...part.position);
      // mirroring across x negates the y and z rotations
      const sign = part.mirrored ? -1 : 1;
      pivot.rotation.set(part.rotation[0] * DEG, sign * part.rotation[1] * DEG, sign * part.rotation[2] * DEG);
      pivot.add(mesh);
      const tag = document.createElement('div');
      tag.className = 'part-label';
      tag.textContent = part.label;
      const label = new CSS2DObject(tag);
      label.position.set(0, 0, 0);
      mesh.add(label);
      this.root.add(pivot);
      this.views.push({ part, pivot, mesh, material, label, basePos: pivot.position.clone(), explodeDir: new THREE.Vector3() });
    }
    // explode direction: away from the model centre
    const box = new THREE.Box3().setFromObject(this.root);
    const center = box.getCenter(new THREE.Vector3());
    for (const v of this.views) {
      const d = v.basePos.clone().sub(center);
      if (d.lengthSq() < 1e-4) d.set(0, 1, 0);
      v.explodeDir.copy(d.normalize());
    }
    // ground the grid under the model
    const grid = this.scene3.getObjectByName('grid');
    if (grid) grid.position.y = box.min.y - 0.02;
    if (!this.framedOnce) {
      this.frameCamera(box);
      this.framedOnce = true;
    }
    this.refreshLook();
  }

  private frameCamera(box: THREE.Box3): void {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.5);
    const dist = radius / Math.sin((this.camera.fov * DEG) / 2);
    this.camera.position.copy(center).add(new THREE.Vector3(0.9, 0.55, 1).normalize().multiplyScalar(dist * 1.05));
    this.camera.near = dist / 100;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  update(scene: Scene): void {
    if (scene.kind !== '3d') return;
    this.scene = scene;
    if (this.selected && !scene.parts.some((p) => p.id === this.selected)) this.selected = null;
    this.build(); // camera is kept (framedOnce)
  }

  // -------------------------------------------------------------- interaction

  private pick(e: PointerEvent): string | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = this.views.map((v) => v.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    // prefer opaque parts over see-through housings
    const hit = hits.find((h) => ((h.object as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity >= 0.6) ?? hits[0];
    return (hit?.object.userData.partId as string | undefined) ?? null;
  }

  private bindPointer(): void {
    const canvas = this.renderer.domElement;
    let downAt: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
    const up = (e: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved > 5) return; // that was an orbit drag
      const id = this.pick(e);
      this.choose(id && id === this.selected ? null : id);
    };
    const move = (e: PointerEvent) => {
      if (downAt) return;
      const id = this.pick(e);
      if (id !== this.hovered) {
        this.hovered = id;
        canvas.style.cursor = id ? 'pointer' : 'grab';
        this.refreshLook();
      }
    };
    const leave = () => {
      this.hovered = null;
      this.refreshLook();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    this.cleanup.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
    });
  }

  private choose(id: string | null): void {
    this.selected = id;
    this.refreshLook();
    const p = this.scene.parts.find((x) => x.id === id);
    this.onSelect(p ? { itemId: p.id, label: p.label, detail: p.detail } : null);
  }

  select(id: string | null): void {
    this.selected = id;
    this.refreshLook();
  }

  highlight(ids: string[]): void {
    this.focus = new Set(ids);
    this.refreshLook();
  }

  setExploded(on: boolean): void {
    this.explodeTarget = on ? 1 : 0;
  }

  setLabels(all: boolean): void {
    this.showAllLabels = all;
    this.refreshLook();
  }

  setPlaying(on: boolean): void {
    this.playing = on;
  }

  /** Colours, emphasis and label visibility from selection/hover/focus state. */
  private refreshLook(): void {
    const focusing = this.focus.size > 0;
    for (const v of this.views) {
      const id = v.part.id;
      const sel = id === this.selected;
      const lit = sel || id === this.hovered || this.focus.has(id);
      v.material.emissive.copy(sel ? SELECT_COLOR : lit ? new THREE.Color('#1E3A8A') : new THREE.Color(0x000000));
      v.material.emissiveIntensity = sel ? 0.65 : lit ? 0.5 : 0;
      const dim = focusing && !lit;
      v.material.opacity = dim ? Math.min(v.part.opacity, 0.22) : v.part.opacity;
      v.material.transparent = v.material.opacity < 1;
      v.material.depthWrite = !v.material.transparent;
      v.material.needsUpdate = true;
      v.label.element.classList.toggle('on', this.showAllLabels || lit);
      v.label.element.classList.toggle('selected', sel);
    }
  }

  // -------------------------------------------------------------- loop

  private animate(t: number): void {
    for (const v of this.views) {
      v.mesh.position.set(0, 0, 0);
      v.mesh.rotation.set(0, 0, 0);
    }
    if (this.playing) {
      for (const a of this.animations) {
        const wave = Math.sin(2 * Math.PI * (a.speed * t + a.phase));
        for (const v of this.views) {
          if (groupId(v.part) !== a.part) continue;
          // mirrored twins move as mirror images (x slides flip, y/z rotations flip)
          const m = v.part.mirrored ? -1 : 1;
          const rotSign = m === -1 && a.axis !== 'x' ? -1 : 1;
          if (a.kind === 'spin') v.mesh.rotation[a.axis] += rotSign * 2 * Math.PI * a.amount * t;
          else if (a.kind === 'slide') v.mesh.position[a.axis] += (a.axis === 'x' ? m : 1) * wave * a.amount;
          else v.mesh.rotation[a.axis] += rotSign * wave * a.amount * DEG;
        }
      }
    }
    this.explode += (this.explodeTarget - this.explode) * 0.12;
    for (const v of this.views) v.pivot.position.copy(v.basePos).addScaledVector(v.explodeDir, this.explode * 0.9);
  }

  private elapsed = 0;
  private fpsWindowStart = performance.now();
  private fpsFrames = 0;

  private publishStats(): void {
    this.fpsFrames++;
    const now = performance.now();
    if (now - this.fpsWindowStart < 1000) return;
    const info = this.renderer.info;
    const stats: Render3DStats = {
      triangles: info.render.triangles,
      drawCalls: info.render.calls,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      parts: this.views.length,
      fps: Math.round((this.fpsFrames * 1000) / (now - this.fpsWindowStart)),
    };
    (window as unknown as { __heyguy3d?: Render3DStats }).__heyguy3d = stats;
    this.fpsWindowStart = now;
    this.fpsFrames = 0;
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.playing) this.elapsed += dt;
    this.animate(this.elapsed);
    this.controls.update();
    this.renderer.render(this.scene3, this.camera);
    this.labels.render(this.scene3, this.camera);
    if (STILL) this.publishStats();
  };

  resize(): void {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(50, Math.floor(r.width));
    const h = Math.max(50, Math.floor(r.height));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.cleanup.forEach((f) => f());
    this.controls.dispose();
    for (const v of this.views) {
      v.mesh.geometry.dispose();
      v.material.dispose();
    }
    this.scene3.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.LineSegments).isLineSegments) {
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        (Array.isArray(mat) ? mat : [mat]).forEach((x) => x?.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
