import type * as THREE from 'three';
import type { Pose } from './pose';
import type { Rng } from './rng';

export interface SceneBuildContext {
  seed: number;
  rng: Rng;
}

/** A built scenario. The shared core owns the camera, water and particles. */
export interface BuiltScene {
  root: THREE.Object3D;
  /** Default turbidity (0..1) for this site. */
  turbidity: number;
  /** World y of the water surface, used to compute depth-dependent ambient light. */
  surfaceHeight: number;
  spawn: Pose;
  /** Seabed height (world y) used to keep the camera above ground. */
  groundHeight(x: number, z: number): number;
  /** Animation hook driven by simulation time (never wall-clock time). */
  update?(time: number, dt: number): void;
  dispose(): void;
}

export interface SceneModule {
  id: string;
  label: string;
  build(ctx: SceneBuildContext): BuiltScene;
}
