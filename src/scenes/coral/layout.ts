import type { SemanticClass } from '../../core/semantics';

export const SURFACE_Y = 0;
/** A shallow fore-reef: enough daylight that colour attenuation is visible but not total. */
export const SEABED_Y = -10;
export const FIELD_SIZE = 70;

export const CLASSES = {
  fanCoral: { id: 4, name: 'fan-coral', color: [205, 82, 167] },
  plateCoral: { id: 5, name: 'plate-coral', color: [200, 105, 52] },
  sand: { id: 1, name: 'sand', color: [194, 178, 128] },
  branchingCoral: { id: 2, name: 'branching-coral', color: [255, 127, 80] },
  brainCoral: { id: 3, name: 'brain-coral', color: [154, 205, 50] },
} satisfies Record<string, SemanticClass>;

export const CLASS_LIST: readonly SemanticClass[] = Object.values(CLASSES);
