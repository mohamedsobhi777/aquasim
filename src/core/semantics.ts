import type * as THREE from 'three';

/** A label class. `id` 0 is reserved for water / no surface. */
export interface SemanticClass {
  id: number;
  name: string;
  /** Visualisation colour (0-255 sRGB), not used in the exported id mask. */
  color: readonly [number, number, number];
}

export const WATER_CLASS: SemanticClass = { id: 0, name: 'water', color: [0, 0, 0] };

/** Largest instance id that fits the 16-bit G/B encoding of the id mask. */
export const MAX_INSTANCE_ID = 0xffff;

interface LabelUserData {
  semanticId?: number;
  excludeFromLabels?: boolean;
}

/** Tags an object (and untagged descendants) with a semantic class. */
export function tagSemantic(object: THREE.Object3D, classId: number): void {
  object.traverse((child) => {
    const data = child.userData as LabelUserData;
    if (data.semanticId === undefined || child === object) data.semanticId = classId;
  });
}

/** Marks an object as visual-only (particles, backdrop): hidden in depth and mask passes. */
export function excludeFromLabels(object: THREE.Object3D): void {
  (object.userData as LabelUserData).excludeFromLabels = true;
}

export function semanticIdOf(object: THREE.Object3D): number | undefined {
  return (object.userData as LabelUserData).semanticId;
}

export function isExcludedFromLabels(object: THREE.Object3D): boolean {
  return (object.userData as LabelUserData).excludeFromLabels === true;
}

/** Id mask pixel layout: R = class id, G = instance id high byte, B = instance id low byte. */
export function encodeLabel(classId: number, instanceId: number): [number, number, number] {
  if (classId < 0 || classId > 255) throw new Error(`class id out of range: ${classId}`);
  if (instanceId < 0 || instanceId > MAX_INSTANCE_ID) throw new Error(`instance id out of range: ${instanceId}`);
  return [classId, instanceId >> 8, instanceId & 0xff];
}

export function decodeLabel(r: number, g: number, b: number): { classId: number; instanceId: number } {
  return { classId: r, instanceId: (g << 8) | b };
}

export function validateClasses(classes: readonly SemanticClass[]): void {
  const seen = new Set<number>();
  for (const c of classes) {
    if (!Number.isInteger(c.id) || c.id < 1 || c.id > 255) {
      throw new Error(`Semantic class "${c.name}" has invalid id ${c.id} (expected 1-255)`);
    }
    if (seen.has(c.id)) throw new Error(`Duplicate semantic class id ${c.id}`);
    seen.add(c.id);
  }
}
