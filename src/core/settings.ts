export type ViewMode = 'rgb' | 'depth' | 'semantic';
/** `robot`: the robot's own camera (what gets captured). `world`: an orbit camera following the robot. */
export type CameraMode = 'robot' | 'world';

/** Everything the UI can change. Plain data so it can be stored in dataset.json. */
export interface SimSettings {
  sceneId: string;
  seed: number;
  water: { presetId: string; turbidity: number; enabled: boolean; daylight: number };
  lamps: { on: boolean; intensity: number; angleDeg: number; spacing: number; scatter: number; shadows: boolean; beamShadows: boolean };
  particles: { count: number; currentSpeed: number; wake: boolean };
  /** Sediment lifted by the thrusters when flying low; strength 0 turns it off. */
  sediment: { enabled: boolean; strength: number };
  camera: { fov: number };
  render: { exposure: number; view: ViewMode; camera: CameraMode; lod: boolean };
  capture: { width: number; height: number; frames: number };
  /** Effect-by-effect evaluation: poses per path and timed renders per pose. Uses the capture resolution. */
  evaluation: { frames: number; repeats: number };
}

export const DEFAULT_SETTINGS: SimSettings = {
  sceneId: 'infrastructure',
  seed: 7,
  water: { presetId: 'clear-ocean', turbidity: 0.08, enabled: true, daylight: 6 },
  lamps: { on: true, intensity: 60, angleDeg: 30, spacing: 1.6, scatter: 1, shadows: true, beamShadows: true },
  particles: { count: 6000, currentSpeed: 0.12, wake: true },
  sediment: { enabled: true, strength: 1 },
  camera: { fov: 60 },
  render: { exposure: 1.1, view: 'rgb', camera: 'robot', lod: true },
  capture: { width: 640, height: 480, frames: 60 },
  evaluation: { frames: 24, repeats: 3 },
};
