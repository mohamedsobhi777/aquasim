import type * as THREE from 'three';
import type { Rng } from './rng';
import type { SemanticClass } from './semantics';
import type { Trajectory, Pose } from './trajectory';
import type { WaterSettings } from './waterModel';

export interface SceneBuildContext {
  seed: number;
  rng: Rng;
}

/** A built scenario. The shared core owns the camera, lamps, water, particles and capture. */
export interface BuiltScene {
  root: THREE.Object3D;
  classes: readonly SemanticClass[];
  /** Default water conditions; depth is derived each frame from the camera height. */
  water: Omit<WaterSettings, 'depth'>;
  /** World y of the water surface, used to compute depth-dependent ambient light. */
  surfaceHeight: number;
  spawn: Pose;
  /** Seabed height (world y) used to keep the robot above ground. */
  groundHeight(x: number, z: number): number;
  /** Named, seeded camera paths for repeatable dataset capture. */
  trajectories: readonly Trajectory[];
  /** Animation hook driven by simulation time (never wall-clock time). */
  update?(time: number, dt: number): void;
  dispose(): void;
}

export interface SceneModule {
  id: string;
  label: string;
  build(ctx: SceneBuildContext): BuiltScene;
}
