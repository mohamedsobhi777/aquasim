/** Everything the UI can change. */
export interface SimSettings {
  sceneId: string;
  seed: number;
  water: { turbidity: number; enabled: boolean; daylight: number };
  particles: { count: number; currentSpeed: number };
}

export const DEFAULT_SETTINGS: SimSettings = {
  sceneId: 'infrastructure',
  seed: 7,
  water: { turbidity: 0.08, enabled: true, daylight: 6 },
  particles: { count: 6000, currentSpeed: 0.12 },
};
