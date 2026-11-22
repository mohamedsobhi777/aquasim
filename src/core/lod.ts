import * as THREE from 'three';

/**
 * Level-of-detail support shared by scenes. Objects register an updater that
 * picks their detail for the camera about to render; the app runs every
 * updater right before each render (live view, label passes and captures
 * alike), so RGB, depth and masks always see the same geometry.
 */
export interface LodView {
  camera: THREE.Camera;
  /** Image height / (2 tan(fov / 2)): metres at 1 m distance -> pixels. */
  pixelScale: number;
  /** False forces full detail everywhere (for A/B evaluation). */
  enabled: boolean;
}

export interface LodStats {
  /** Triangles in the geometry selected for this view (before frustum culling by three). */
  triangles: number;
  /** Objects or instances drawn at each level, finest first. */
  perLevel: number[];
}

type LodUpdater = (view: LodView) => LodStats;

interface LodUserData {
  lodUpdate?: LodUpdater;
  /** Meshes that share one block of label instance ids (all LOD levels of one object). */
  labelSlot?: LabelSlot;
}

export interface LabelSlot {
  /** Identity of the slot; every mesh with the same key gets the same instance base. */
  key: object;
  count: number;
  name: string;
}

export function registerLod(object: THREE.Object3D, update: LodUpdater): void {
  (object.userData as LodUserData).lodUpdate = update;
}

export function lodUpdaters(root: THREE.Object3D): LodUpdater[] {
  const found: LodUpdater[] = [];
  root.traverse((object) => {
    const update = (object.userData as LodUserData).lodUpdate;
    if (update) found.push(update);
  });
  return found;
}

export function setLabelSlot(mesh: THREE.Object3D, slot: LabelSlot): void {
  (mesh.userData as LodUserData).labelSlot = slot;
}

export function labelSlotOf(mesh: THREE.Object3D): LabelSlot | undefined {
  return (mesh.userData as LodUserData).labelSlot;
}

export function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

export interface InstancedLodLevel {
  geometry: THREE.BufferGeometry;
  /** Use this level while an instance's projected bounding radius is at least this many pixels. */
  minPixels: number;
}

const frustum = new THREE.Frustum();
const viewProjection = new THREE.Matrix4();
const sphere = new THREE.Sphere();
const cameraPosition = new THREE.Vector3();

/**
 * Many copies of one object drawn at a few detail levels. Each frame every
 * instance is frustum-culled and assigned the coarsest level whose
 * `minPixels` its projected size still reaches; instances smaller than the
 * last level's threshold are skipped. A per-instance `labelIndex` attribute
 * keeps instance ids stable whichever level draws an instance.
 */
export class InstancedLod {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[];
  private readonly matrices: THREE.Matrix4[];
  private readonly bounds: THREE.Sphere[];
  private readonly labelIndices: THREE.InstancedBufferAttribute[];
  /** Extra culling margin, metres, so off-screen instances near the view still cast shadows into it. */
  private readonly frustumMargin: number;

  constructor(
    name: string,
    levels: readonly InstancedLodLevel[],
    material: THREE.Material,
    matrices: readonly THREE.Matrix4[],
    frustumMargin = 2,
  ) {
    if (levels.length === 0) throw new Error(`${name}: needs at least one level`);
    levels.forEach((level, i) => {
      if (i > 0 && level.minPixels > levels[i - 1].minPixels)
        throw new Error(`${name}: levels must go from fine to coarse`);
    });
    this.group.name = name;
    this.matrices = matrices.map((m) => m.clone());
    this.frustumMargin = frustumMargin;
    const local =
      levels[0].geometry.boundingSphere ??
      (levels[0].geometry.computeBoundingSphere(), levels[0].geometry.boundingSphere!);
    this.bounds = this.matrices.map((m) => local.clone().applyMatrix4(m));

    const slot: LabelSlot = { key: this.group, count: matrices.length, name };
    this.labelIndices = [];
    this.meshes = levels.map((level, i) => {
      const capacity = Math.max(1, matrices.length);
      const geometry = level.geometry.clone();
      const labelIndex = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(
        THREE.DynamicDrawUsage,
      );
      geometry.setAttribute('labelIndex', labelIndex);
      this.labelIndices.push(labelIndex);
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = `${name}-lod${i}`;
      mesh.userData.minPixels = level.minPixels;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Culling happens per instance in update().
      mesh.frustumCulled = false;
      setLabelSlot(mesh, slot);
      this.group.add(mesh);
      return mesh;
    });
    registerLod(this.group, (view) => this.update(view));
    this.update(null);
  }

  /** Assigns instances to levels for `view`; null shows every instance at full detail. */
  update(view: LodView | null): LodStats {
    const counts = this.meshes.map(() => 0);
    const useLod = view !== null && view.enabled;
    if (view) {
      view.camera.updateMatrixWorld();
      viewProjection.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      view.camera.getWorldPosition(cameraPosition);
    }
    for (let i = 0; i < this.matrices.length; i++) {
      let level = 0;
      if (useLod) {
        sphere.copy(this.bounds[i]);
        sphere.radius += this.frustumMargin;
        if (!frustum.intersectsSphere(sphere)) continue;
        const distance = Math.max(1e-3, this.bounds[i].center.distanceTo(cameraPosition) - this.bounds[i].radius);
        const pixels = (this.bounds[i].radius * view.pixelScale) / distance;
        level = this.meshes.findIndex((mesh) => pixels >= (mesh.userData.minPixels as number));
        if (level < 0) continue;
      }
      const slot = counts[level]++;
      this.meshes[level].setMatrixAt(slot, this.matrices[i]);
      this.labelIndices[level].setX(slot, i);
    }
    let triangles = 0;
    this.meshes.forEach((mesh, level) => {
      mesh.count = counts[level];
      mesh.visible = counts[level] > 0;
      mesh.instanceMatrix.needsUpdate = true;
      this.labelIndices[level].needsUpdate = true;
      triangles += counts[level] * triangleCount(mesh.geometry);
    });
    return { triangles, perLevel: counts };
  }

  dispose(): void {
    this.meshes.forEach((mesh) => mesh.geometry.dispose());
  }
}
