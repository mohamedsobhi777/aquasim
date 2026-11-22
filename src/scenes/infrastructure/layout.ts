import * as THREE from 'three';
import type { SemanticClass } from '../../core/semantics';

export const SURFACE_Y = 0;
export const SEABED_Y = -36;
export const FIELD_SIZE = 170;

export const JACKET = {
  center: new THREE.Vector2(28, 0),
  baseHalfWidth: 9,
  topHalfWidth: 6,
  topY: 2,
  legRadius: 0.75,
  braceRadius: 0.3,
  /** Brace levels as heights above the seabed. */
  levels: [1.5, 12, 24, 34.5],
  /** Radius of the levelled pad around the jacket. */
  padRadius: 15,
};

/** Subsea production template: protective frame over four wells and a manifold. */
export const TEMPLATE = {
  center: new THREE.Vector2(-30, 30),
  halfX: 7,
  halfZ: 6,
  height: 5.5,
  padRadius: 13,
  /** The pipeline passes this far south (-z) of the template; a PLET + jumper connect them. */
  pletDistance: 15,
};

/** Levelled seabed pads around installed structures. */
export const PADS: readonly { center: THREE.Vector2; radius: number }[] = [
  { center: JACKET.center, radius: JACKET.padRadius },
  { center: TEMPLATE.center, radius: TEMPLATE.padRadius },
];

export const PIPE = {
  radius: 0.42,
  /** Standard line-pipe joint length, metres. */
  jointSpacing: 12.2,
  anodeEveryJoints: 4,
  /** Free-span height above which a support is placed. */
  supportGap: 0.3,
  supportSpacing: 5,
};

export const CLASSES = {
  seabed: { id: 1, name: 'seabed', color: [194, 178, 128] },
  pipeline: { id: 2, name: 'pipeline', color: [70, 130, 180] },
  fieldJoint: { id: 3, name: 'field-joint', color: [255, 165, 0] },
  anode: { id: 4, name: 'anode', color: [230, 230, 60] },
  pipeSupport: { id: 5, name: 'pipe-support', color: [160, 82, 45] },
  jacketLeg: { id: 6, name: 'jacket-leg', color: [178, 34, 34] },
  jacketBrace: { id: 7, name: 'jacket-brace', color: [255, 99, 71] },
  riser: { id: 8, name: 'riser', color: [148, 0, 211] },
  riserClamp: { id: 9, name: 'riser-clamp', color: [238, 130, 238] },
  mudmat: { id: 10, name: 'mudmat', color: [128, 128, 0] },
  rock: { id: 11, name: 'rock', color: [112, 128, 144] },
  debris: { id: 12, name: 'debris', color: [0, 206, 209] },
  templateFrame: { id: 13, name: 'template-frame', color: [255, 215, 0] },
  xmasTree: { id: 14, name: 'xmas-tree', color: [50, 205, 50] },
  manifold: { id: 15, name: 'manifold', color: [0, 128, 128] },
  valve: { id: 16, name: 'valve', color: [255, 20, 147] },
  rovPanel: { id: 17, name: 'rov-panel', color: [255, 255, 255] },
  jumper: { id: 18, name: 'jumper', color: [30, 144, 255] },
  plet: { id: 19, name: 'plet', color: [139, 69, 19] },
  umbilical: { id: 20, name: 'umbilical', color: [255, 140, 0] },
  mattress: { id: 21, name: 'mattress', color: [189, 183, 107] },
  uta: { id: 22, name: 'uta', color: [218, 112, 214] },
} as const satisfies Record<string, SemanticClass>;

export const CLASS_LIST: readonly SemanticClass[] = Object.values(CLASSES);
