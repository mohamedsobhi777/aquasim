import type { SceneModule } from '../core/sceneModule';
import { infrastructureScene } from './infrastructure';

/** Scenario registry. The coral reef module plugs in here with the same SceneModule interface. */
export const SCENES: readonly SceneModule[] = [infrastructureScene];

export function findScene(id: string): SceneModule {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`Unknown scene: ${id}`);
  return scene;
}
