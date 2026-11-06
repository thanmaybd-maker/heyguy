import type { Scene } from '../../shared/scene';

export interface PickedItem {
  itemId: string;
  label: string;
  detail: string;
}

export type SelectHandler = (item: PickedItem | null) => void;

/** Common surface of the 2D (SVG) and 3D (Three.js) scene renderers. */
export interface SceneRenderer {
  /** Apply a new version of the same scene (same id), keeping view/camera where possible. */
  update(scene: Scene): void;
  /** Emphasise these ids (step focus); [] clears. */
  highlight(ids: string[]): void;
  select(id: string | null): void;
  resize(): void;
  destroy(): void;
}
