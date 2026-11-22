import type { SceneModule } from '../core/sceneModule';
import { coralScene } from './coral';
import { pipeSite } from './pipeSite';
import { infrastructureScene } from './infrastructure';

/** Scenario registry; every scenario implements SceneModule. */
export const SCENES: readonly SceneModule[] = [infrastructureScene, pipeSite, coralScene];

export function findScene(id: string): SceneModule {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`Unknown scene: ${id}`);
  return scene;
}
